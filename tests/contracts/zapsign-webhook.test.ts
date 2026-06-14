// FB_EVENTOS — ZapSign webhook handler tests (Phase 1, Plan 01-05 Task 3).
//
// Six load-bearing cases:
//
//   1. Bad/missing Basic Auth → 401 (no transition).
//   2. Valid Basic Auth + API re-fetch shows pending+org-signed → contracts.status
//      transitions draft|awaiting_org → awaiting_fornecedor + audit row written.
//   3. Valid Basic Auth + API re-fetch shows status=signed → contracts.status='signed'
//      + signed PDF downloaded to MinIO + email job enqueued (contrato_assinado).
//   4. Spoofed payload (event_type='signed') but ZapSign API re-fetch returns
//      status='refused' → contracts.status='cancelled' (re-fetch wins).
//   5. Duplicate webhook delivery on terminal-signed state → idempotent
//      (no double audit row, no double email job enqueue).
//   6. ZapSign API re-fetch fails (5xx) → handler returns 400 (so ZapSign
//      retries) and contracts.status is NOT updated.

import { eq } from 'drizzle-orm'
import { run } from 'graphile-worker'
import { HttpResponse, http } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { POST as zapsignWebhookPost } from '@/app/api/webhooks/zapsign/route'
import { pool } from '@/db'
import { contracts } from '@/db/schema/contracts'
import { withTenant } from '@/db/with-tenant'
import { PDF_GENERATE_CONTRACT_TASK } from '@/jobs/tasks/pdf-generate-contract'
import {
  EMAIL_STATUS_UPDATE_TASK,
  ZAPSIGN_SEND_CONTRACT_TASK,
} from '@/jobs/tasks/zapsign-send-contract'
import { getTenantBucket, resetMinIOClient, setMinIOClientForTests } from '@/lib/storage/minio'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { setupExternalMocks, ZAPSIGN_CREATE_DOC_RESPONSE } from '@/test/external-mocks'
import { makeContract } from '@/test/factories/contract-factory'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'
import { getMockMinIO, resetMockMinIO } from '@/test/minio-test'

const mocks = setupExternalMocks()

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────────

const WEBHOOK_USER = 'zs_webhook_user'
const WEBHOOK_PASS = 'zs_webhook_pass_test'
const BASIC = `Basic ${Buffer.from(`${WEBHOOK_USER}:${WEBHOOK_PASS}`).toString('base64')}`

beforeAll(async () => {
  process.env.ZAPSIGN_TOKEN = 'test-token-abc'
  process.env.ZAPSIGN_ENV = 'sandbox'
  process.env.ZAPSIGN_WEBHOOK_USER = WEBHOOK_USER
  process.env.ZAPSIGN_WEBHOOK_PASS = WEBHOOK_PASS
  mocks.listen()

  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) throw new Error('DATABASE_MIGRATOR_URL is required')
  const r = await run({
    connectionString: migratorUrl,
    taskList: {
      [PDF_GENERATE_CONTRACT_TASK]: async () => {},
      [ZAPSIGN_SEND_CONTRACT_TASK]: async () => {},
      [EMAIL_STATUS_UPDATE_TASK]: async () => {},
    },
    concurrency: 1,
    logger: undefined,
  })
  await r.stop()
})

beforeEach(async () => {
  mocks.resetHandlers()
  resetMockMinIO()
  setMinIOClientForTests(getMockMinIO())
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks
      WHERE identifier IN (
        ${PDF_GENERATE_CONTRACT_TASK},
        ${ZAPSIGN_SEND_CONTRACT_TASK},
        ${EMAIL_STATUS_UPDATE_TASK}
      )
    )
  `
})

afterAll(async () => {
  mocks.close()
  resetMinIOClient()
  resetMockMinIO()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Fixture: tenant + contract + zapsign_documents row (mimics post-Task-2 state)
// ────────────────────────────────────────────────────────────────────────────

interface FixtureCtx {
  tenantId: string
  tenantSlug: string
  contractId: string
  zapsignId: string
  vendorId: string
  userId: string
}

async function setupFixture(
  prefix: string,
  opts?: {
    contractStatus?: string
  },
): Promise<FixtureCtx> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Test Tenant ${prefix}`)
  const userId = await insertUser(`u-${stamp}@example.test`, `User ${prefix}`)
  await insertOrganization(tenantId, `${stamp}-org`, `Org ${prefix}`)
  const ev = await makeEvent(tenantId)
  const cat = await makeLotCategory(tenantId, ev.id)
  const lot = await makeLot(tenantId, ev.id, cat.id)
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  const zapsignId = `zs_test_${stamp}`
  const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id, {
    pdfMinioKey: `contracts/_/contract-v1.pdf`,
    zapsignDocId: zapsignId,
    status: opts?.contractStatus ?? 'awaiting_org',
  })
  // Insert the zapsign_documents row that resolveTenantForZapsignId looks up.
  await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    await tx`
      INSERT INTO zapsign_documents (tenant_id, contract_id, zapsign_id, payload_send)
      VALUES (${tenantId}, ${contract.id}, ${zapsignId}, ${'{}'}::jsonb)
    `
  })
  return {
    tenantId,
    tenantSlug: stamp,
    contractId: contract.id,
    zapsignId,
    vendorId: vendor.id,
    userId,
  }
}

function buildRequest(opts: { body: unknown; auth?: string | null }): Request {
  const headers = new Headers()
  if (opts.auth !== null) {
    headers.set('authorization', opts.auth ?? BASIC)
  }
  headers.set('content-type', 'application/json')
  return new Request('https://eventos.fbtax.cloud/api/webhooks/zapsign', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('ZapSign webhook handler — auth + payload validation', () => {
  test('missing Basic Auth header → 401', async () => {
    const fx = await setupFixture('wh-noauth')
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a thin wrapper over Request
    const res = await zapsignWebhookPost(
      buildRequest({
        body: { event_type: 'doc_signed', token: fx.zapsignId },
        auth: null,
      }) as any,
    )
    expect(res.status).toBe(401)
  })

  test('wrong Basic Auth credentials → 401', async () => {
    const fx = await setupFixture('wh-wrongauth')
    const wrong = `Basic ${Buffer.from('intruder:nope').toString('base64')}`
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await zapsignWebhookPost(
      buildRequest({
        body: { event_type: 'doc_signed', token: fx.zapsignId },
        auth: wrong,
      }) as any,
    )
    expect(res.status).toBe(401)
  })
})

describe('ZapSign webhook handler — FSM transitions', () => {
  test('org signed (pending + order_group=1 signed) → contracts.status = awaiting_fornecedor', async () => {
    const fx = await setupFixture('wh-partial', { contractStatus: 'awaiting_org' })
    // ZapSign API re-fetch returns pending with org signer signed.
    mocks.use(
      http.get(`https://sandbox.api.zapsign.com.br/api/v1/docs/${fx.zapsignId}/`, () =>
        HttpResponse.json(
          {
            ...ZAPSIGN_CREATE_DOC_RESPONSE,
            token: fx.zapsignId,
            status: 'pending',
            signed_file: null,
            signers: [
              {
                ...ZAPSIGN_CREATE_DOC_RESPONSE.signers[0],
                status: 'signed',
                signed_at: '2026-06-14T10:00:00Z',
              },
              { ...ZAPSIGN_CREATE_DOC_RESPONSE.signers[1] },
            ],
          },
          { status: 200 },
        ),
      ),
    )

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await zapsignWebhookPost(
      buildRequest({
        body: { event_type: 'doc_signed', token: fx.zapsignId },
      }) as any,
    )
    expect(res.status).toBe(200)

    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(contracts).where(eq(contracts.id, fx.contractId)).limit(1)
      return rows[0]
    })
    expect(updated?.status).toBe('awaiting_fornecedor')

    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE action = 'contract.zapsign_webhook' AND entity_id = ${fx.contractId}
      `
    })
    expect(audits).toHaveLength(1)
  })

  test('all signers complete → status=signed + signed PDF in MinIO + email job enqueued', async () => {
    const fx = await setupFixture('wh-signed', { contractStatus: 'awaiting_fornecedor' })
    const signedUrl = 'https://sandbox.api.zapsign.com.br/files/signed.pdf'
    // Mock the API re-fetch + the signed PDF download.
    const SIGNED_PDF_BYTES = Buffer.from('%PDF-1.7\nfake signed pdf content')
    mocks.use(
      http.get(`https://sandbox.api.zapsign.com.br/api/v1/docs/${fx.zapsignId}/`, () =>
        HttpResponse.json(
          {
            ...ZAPSIGN_CREATE_DOC_RESPONSE,
            token: fx.zapsignId,
            status: 'signed',
            signed_file: signedUrl,
            signers: [
              { ...ZAPSIGN_CREATE_DOC_RESPONSE.signers[0], status: 'signed' },
              { ...ZAPSIGN_CREATE_DOC_RESPONSE.signers[1], status: 'signed' },
            ],
          },
          { status: 200 },
        ),
      ),
      http.get(signedUrl, () => new HttpResponse(SIGNED_PDF_BYTES, { status: 200 })),
    )

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await zapsignWebhookPost(
      buildRequest({
        body: { event_type: 'doc_signed', token: fx.zapsignId },
      }) as any,
    )
    expect(res.status).toBe(200)

    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(contracts).where(eq(contracts.id, fx.contractId)).limit(1)
      return rows[0]
    })
    expect(updated?.status).toBe('signed')
    expect(updated?.signedPdfMinioKey).toBe(`contracts/${fx.contractId}/signed.pdf`)

    // Signed PDF landed in MinIO.
    const mock = getMockMinIO()
    const stat = await mock.statObject(
      getTenantBucket(fx.tenantSlug),
      `contracts/${fx.contractId}/signed.pdf`,
    )
    expect(stat.size).toBeGreaterThan(10)
    expect(stat.metaData['content-type']).toBe('application/pdf')

    // Email job enqueued (contrato_assinado).
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'contract_id' = ${fx.contractId}
        AND j.payload->>'event' = 'contrato_assinado'
    `
    expect(jobs).toHaveLength(1)
  })

  test('belt-and-suspenders: webhook says signed but API re-fetch returns refused → status=cancelled', async () => {
    const fx = await setupFixture('wh-spoof', { contractStatus: 'awaiting_org' })
    // ZapSign API says refused, regardless of what the webhook claims.
    mocks.use(
      http.get(`https://sandbox.api.zapsign.com.br/api/v1/docs/${fx.zapsignId}/`, () =>
        HttpResponse.json(
          {
            ...ZAPSIGN_CREATE_DOC_RESPONSE,
            token: fx.zapsignId,
            status: 'refused',
            signed_file: null,
            signers: ZAPSIGN_CREATE_DOC_RESPONSE.signers,
          },
          { status: 200 },
        ),
      ),
    )

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await zapsignWebhookPost(
      buildRequest({
        body: { event_type: 'doc_signed', token: fx.zapsignId },
      }) as any,
    )
    expect(res.status).toBe(200)

    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(contracts).where(eq(contracts.id, fx.contractId)).limit(1)
      return rows[0]
    })
    // Re-fetch wins: contracts.status follows the API result, not the webhook.
    expect(updated?.status).toBe('cancelled')
    expect(updated?.signedPdfMinioKey).toBeNull()
  })

  test('duplicate signed webhook on a contract already at signed terminal → no double audit, no double email', async () => {
    const fx = await setupFixture('wh-idem', { contractStatus: 'signed' })
    const signedUrl = 'https://sandbox.api.zapsign.com.br/files/signed.pdf'
    mocks.use(
      http.get(`https://sandbox.api.zapsign.com.br/api/v1/docs/${fx.zapsignId}/`, () =>
        HttpResponse.json(
          {
            ...ZAPSIGN_CREATE_DOC_RESPONSE,
            token: fx.zapsignId,
            status: 'signed',
            signed_file: signedUrl,
            signers: [
              { ...ZAPSIGN_CREATE_DOC_RESPONSE.signers[0], status: 'signed' },
              { ...ZAPSIGN_CREATE_DOC_RESPONSE.signers[1], status: 'signed' },
            ],
          },
          { status: 200 },
        ),
      ),
      http.get(
        signedUrl,
        () => new HttpResponse(Buffer.from('%PDF-1.7\nsecond delivery'), { status: 200 }),
      ),
    )

    // First delivery — terminal already, expect no transition + no audit.
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res1 = await zapsignWebhookPost(
      buildRequest({ body: { event_type: 'doc_signed', token: fx.zapsignId } }) as any,
    )
    expect(res1.status).toBe(200)

    // Second delivery — same, no double effects.
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res2 = await zapsignWebhookPost(
      buildRequest({ body: { event_type: 'doc_signed', token: fx.zapsignId } }) as any,
    )
    expect(res2.status).toBe(200)

    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE action = 'contract.zapsign_webhook' AND entity_id = ${fx.contractId}
      `
    })
    // Zero audits — both deliveries dropped at the terminal-state guard.
    expect(audits).toHaveLength(0)

    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'contract_id' = ${fx.contractId}
    `
    expect(jobs).toHaveLength(0)
  })

  test('ZapSign API re-fetch fails (5xx) → 400 (ZapSign retries) + contract status unchanged', async () => {
    const fx = await setupFixture('wh-refetch-fail', { contractStatus: 'awaiting_org' })
    mocks.use(
      http.get(
        `https://sandbox.api.zapsign.com.br/api/v1/docs/${fx.zapsignId}/`,
        () => new HttpResponse('upstream timeout', { status: 503 }),
      ),
    )

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await zapsignWebhookPost(
      buildRequest({
        body: { event_type: 'doc_signed', token: fx.zapsignId },
      }) as any,
    )
    expect(res.status).toBe(400)

    // Contract status unchanged.
    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(contracts).where(eq(contracts.id, fx.contractId)).limit(1)
      return rows[0]
    })
    expect(updated?.status).toBe('awaiting_org')
  })
})
