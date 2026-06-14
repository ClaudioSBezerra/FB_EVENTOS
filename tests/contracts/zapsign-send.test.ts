// FB_EVENTOS — zapsign.send-contract task + emitContract action tests
// (Phase 1, Plan 01-05 Task 2).
//
// Six load-bearing cases:
//
//   1. zapsign.send-contract POSTs to mocked ZapSign with:
//      - signature_order_active=true
//      - signers ordered [org (order_group=1), fornecedor (order_group=2)]
//      - external_id = contract.id
//   2. zapsign_documents row inserted with zapsign_id from response.
//   3. contracts.status transitions draft → awaiting_org +
//      contracts.zapsign_doc_id is set.
//   4. ZAPSIGN_ENV='sandbox' targets sandbox.api.zapsign.com.br (URL switch).
//   5. RLS-no-worker: task without withTenant raises (contract invisible).
//   6. emitContract Server Action helper inserts contracts row +
//      enqueues pdf.generate-contract job (chain entry point).

import { eq } from 'drizzle-orm'
import { run } from 'graphile-worker'
import { HttpResponse, http } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { contracts, zapsignDocuments } from '@/db/schema/contracts'
import { withTenant } from '@/db/with-tenant'
import { PDF_GENERATE_CONTRACT_TASK } from '@/jobs/tasks/pdf-generate-contract'
import {
  EMAIL_STATUS_UPDATE_TASK,
  ZAPSIGN_SEND_CONTRACT_TASK,
  zapsignSendContract,
} from '@/jobs/tasks/zapsign-send-contract'
import { emitContractInTenant } from '@/lib/actions/contracts'
import { assignLotToVendorInTenant } from '@/lib/actions/lot-assignments'
import { resetMinIOClient, setMinIOClientForTests } from '@/lib/storage/minio'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { setupExternalMocks, ZAPSIGN_CREATE_DOC_RESPONSE } from '@/test/external-mocks'
import { makeContract } from '@/test/factories/contract-factory'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'
import { getMockMinIO, resetMockMinIO } from '@/test/minio-test'

const mocks = setupExternalMocks()

beforeAll(async () => {
  // Set required env BEFORE first import of any module reading env.ts.
  process.env.ZAPSIGN_TOKEN = 'test-token-abc'
  process.env.ZAPSIGN_ENV = 'sandbox'
  mocks.listen()

  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) throw new Error('DATABASE_MIGRATOR_URL is required')
  const r = await run({
    connectionString: migratorUrl,
    taskList: {
      [ZAPSIGN_SEND_CONTRACT_TASK]: async () => {},
      [PDF_GENERATE_CONTRACT_TASK]: async () => {},
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
  // Clear test job rows between tests.
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
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

interface FixtureCtx {
  tenantId: string
  tenantSlug: string
  userId: string
  ownerEmail: string
  ownerName: string
  contractId: string
  vendorEmail: string
  vendorLegalName: string
}

async function setupFixture(prefix: string): Promise<FixtureCtx> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Test Tenant ${prefix}`)
  const tenantSlug = stamp
  const ownerEmail = `owner-${stamp}@example.test`
  const ownerName = `Owner ${prefix}`
  const userId = await insertUser(ownerEmail, ownerName)
  // Create an organization in the tenant + add this user as owner so
  // zapsign-send-contract resolves the organizadora signer correctly.
  const orgId = await insertOrganization(tenantId, `${stamp}-org`, `Org ${prefix}`)
  await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    await tx`
      INSERT INTO member (tenant_id, organization_id, user_id, role)
      VALUES (${tenantId}, ${orgId}, ${userId}, 'owner')
    `
  })

  const ev = await makeEvent(tenantId)
  const cat = await makeLotCategory(tenantId, ev.id, { name: 'Stand Padrão', perSqmRate: 50 })
  const lot = await makeLot(tenantId, ev.id, cat.id, { code: 'A-12', areaM2: 10 })
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id, {
    pdfMinioKey: `contracts/_/contract-v1.pdf`,
  })

  return {
    tenantId,
    tenantSlug,
    userId,
    ownerEmail,
    ownerName,
    contractId: contract.id,
    vendorEmail: vendor.email,
    vendorLegalName: vendor.legalName,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('zapsign.send-contract task — happy paths', () => {
  test('POSTs to ZapSign sandbox with signature_order_active + 2 signers in order_group 1/2', async () => {
    const fx = await setupFixture('zsend-order')

    // Capture the request body MSW sees.
    let observed: unknown = null
    let observedUrl = ''
    mocks.use(
      http.post('https://sandbox.api.zapsign.com.br/api/v1/docs/', async ({ request }) => {
        observed = await request.json()
        observedUrl = request.url
        return HttpResponse.json(
          { ...ZAPSIGN_CREATE_DOC_RESPONSE, token: 'zs_test_token_send_1' },
          { status: 201 },
        )
      }),
    )

    await zapsignSendContract(
      {
        tenant_id: fx.tenantId,
        tenant_slug: fx.tenantSlug,
        contract_id: fx.contractId,
        user_id: fx.userId,
      },
      // biome-ignore lint/suspicious/noExplicitAny: test stub for the helpers param
      { job: { id: 'test' } } as any,
    )

    const body = observed as {
      name: string
      signature_order_active: boolean
      signers: Array<{ name: string; email: string; order_group: number }>
      external_id: string
      lang: string
    }
    expect(observedUrl).toBe('https://sandbox.api.zapsign.com.br/api/v1/docs/')
    expect(body.signature_order_active).toBe(true)
    expect(body.lang).toBe('pt-br')
    expect(body.external_id).toBe(fx.contractId)
    expect(body.signers).toHaveLength(2)
    expect(body.signers[0]?.order_group).toBe(1)
    expect(body.signers[1]?.order_group).toBe(2)
    expect(body.signers[0]?.email).toBe(fx.ownerEmail)
    expect(body.signers[1]?.email).toBe(fx.vendorEmail)
    expect(body.signers[1]?.name).toBe(fx.vendorLegalName)
  })

  test('inserts zapsign_documents row + transitions contracts.status to awaiting_org + zapsign_doc_id set', async () => {
    const fx = await setupFixture('zsend-state')

    mocks.use(
      http.post('https://sandbox.api.zapsign.com.br/api/v1/docs/', async () =>
        HttpResponse.json(
          { ...ZAPSIGN_CREATE_DOC_RESPONSE, token: 'zs_test_token_state_1' },
          { status: 201 },
        ),
      ),
    )

    await zapsignSendContract(
      {
        tenant_id: fx.tenantId,
        tenant_slug: fx.tenantSlug,
        contract_id: fx.contractId,
        user_id: fx.userId,
      },
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      { job: { id: 'test' } } as any,
    )

    // contracts.status transitioned + zapsign_doc_id set.
    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(contracts).where(eq(contracts.id, fx.contractId)).limit(1)
      return rows[0]
    })
    expect(updated?.status).toBe('awaiting_org')
    expect(updated?.zapsignDocId).toBe('zs_test_token_state_1')

    // zapsign_documents row inserted.
    const zsRows = await withTenant(fx.tenantId, async (db) =>
      db
        .select()
        .from(zapsignDocuments)
        .where(eq(zapsignDocuments.contractId, fx.contractId))
        .limit(1),
    )
    expect(zsRows[0]?.zapsignId).toBe('zs_test_token_state_1')
    expect(zsRows[0]?.payloadSend).toBeTruthy()

    // Audit row.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE action = 'contract.zapsign_sent' AND entity_id = ${fx.contractId}
      `
    })
    expect(audits).toHaveLength(1)

    // email.send-status-update job enqueued with contrato_emitido event.
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'contract_id' = ${fx.contractId}
    `
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload?.event).toBe('contrato_emitido')
  })

  test('ZAPSIGN_ENV=sandbox uses sandbox.api.zapsign.com.br URL switch', async () => {
    const fx = await setupFixture('zsend-env')

    // The MSW handler registered only for sandbox URL; if production URL
    // were hit instead, no handler would match and the test would fail.
    let hitSandbox = false
    let hitProduction = false
    mocks.use(
      http.post('https://sandbox.api.zapsign.com.br/api/v1/docs/', async () => {
        hitSandbox = true
        return HttpResponse.json(
          { ...ZAPSIGN_CREATE_DOC_RESPONSE, token: 'zs_test_sandbox' },
          { status: 201 },
        )
      }),
      http.post('https://api.zapsign.com.br/api/v1/docs/', async () => {
        hitProduction = true
        return HttpResponse.json(
          { ...ZAPSIGN_CREATE_DOC_RESPONSE, token: 'zs_test_production' },
          { status: 201 },
        )
      }),
    )

    expect(process.env.ZAPSIGN_ENV).toBe('sandbox')
    await zapsignSendContract(
      {
        tenant_id: fx.tenantId,
        tenant_slug: fx.tenantSlug,
        contract_id: fx.contractId,
        user_id: fx.userId,
      },
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      { job: { id: 'test' } } as any,
    )
    expect(hitSandbox).toBe(true)
    expect(hitProduction).toBe(false)
  })
})

describe('zapsign.send-contract — guards', () => {
  test('contract missing pdf_minio_key throws (pipeline-order guard)', async () => {
    const stamp = `zsend-nopdf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const tenantId = await createTenant(stamp, 'No PDF Tenant')
    const userId = await insertUser(`u-${stamp}@example.test`, 'NoPDF User')
    await insertOrganization(tenantId, `${stamp}-org`, 'NoPDF Org')

    const ev = await makeEvent(tenantId)
    const cat = await makeLotCategory(tenantId, ev.id)
    const lot = await makeLot(tenantId, ev.id, cat.id)
    const vendor = await makeVendor(tenantId, { status: 'approved' })
    const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id /* no pdfMinioKey */)

    await expect(
      zapsignSendContract(
        {
          tenant_id: tenantId,
          tenant_slug: stamp,
          contract_id: contract.id,
          user_id: userId,
        },
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { job: { id: 'test' } } as any,
      ),
    ).rejects.toThrow(/no pdf_minio_key/i)
  })

  test('RLS-no-worker: contract from a different tenant is invisible (task throws)', async () => {
    const fx = await setupFixture('zsend-rls-a')
    const otherStamp = `zsend-rls-b-${Date.now()}`
    const otherTenantId = await createTenant(otherStamp, 'Other RLS Tenant')

    // Call the task with the WRONG tenant_id for the contract — RLS hides
    // the row and the task throws (not silently no-op).
    await expect(
      zapsignSendContract(
        {
          tenant_id: otherTenantId,
          tenant_slug: otherStamp,
          contract_id: fx.contractId,
          user_id: fx.userId,
        },
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        { job: { id: 'test' } } as any,
      ),
    ).rejects.toThrow(/not found in tenant.*RLS scope/i)
  })
})

describe('emitContract Server Action helper', () => {
  test('inserts contract row + enqueues pdf.generate-contract job', async () => {
    const stamp = `emit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const tenantId = await createTenant(stamp, 'Emit Tenant')
    const tenantSlug = stamp
    const userId = await insertUser(`u-${stamp}@example.test`, 'Emit User')
    await insertOrganization(tenantId, `${stamp}-org`, 'Emit Org')

    const ev = await makeEvent(tenantId)
    const cat = await makeLotCategory(tenantId, ev.id)
    const lot = await makeLot(tenantId, ev.id, cat.id, { code: 'B-1', areaM2: 5 })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    const assignment = await withTenant(tenantId, async (db) =>
      assignLotToVendorInTenant(db, tenantId, { lotId: lot.id, vendorId: vendor.id }, userId),
    )

    const contract = await withTenant(tenantId, async (db) =>
      emitContractInTenant(db, tenantId, { lotAssignmentId: assignment.id }, userId),
    )
    expect(contract.status).toBe('draft')
    expect(contract.templateVersion).toBe('fornecedor-stand-v1')
    expect(contract.lotId).toBe(lot.id)
    expect(contract.vendorId).toBe(vendor.id)

    // pdf.generate-contract job enqueued with contract_id + tenant_slug.
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${PDF_GENERATE_CONTRACT_TASK}
        AND j.payload->>'contract_id' = ${contract.id}
    `
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload?.tenant_id).toBe(tenantId)
    expect(jobs[0]?.payload?.tenant_slug).toBe(tenantSlug)

    // Audit row written.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ action: string; payload: Record<string, unknown> }>>`
        SELECT action, payload FROM audit_log
        WHERE action = 'contract.emitted' AND entity_id = ${contract.id}
      `
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]?.payload?.lot_code).toBe('B-1')
  })
})
