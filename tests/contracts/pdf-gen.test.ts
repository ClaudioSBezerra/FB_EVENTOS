// FB_EVENTOS — PDF generation + pdf.generate-contract task tests
// (Phase 1, Plan 01-05 Task 1).
//
// Five load-bearing cases:
//
//   1. generateContractPdf returns a non-empty Buffer for the v1 template.
//   2. The buffer's leading bytes are `%PDF-1.` (sanity — actually a PDF).
//   3. UnknownTemplateVersionError thrown for unknown template_version.
//   4. The pdf.generate-contract task: reads contract, generates PDF,
//      uploads to mock MinIO, updates pdf_minio_key, enqueues
//      zapsign.send-contract (outbox).
//   5. RLS-no-worker proof: a task body that omits withTenant() observes
//      0 rows for the contract (mirrors Plan 0-06 pattern).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { eq } from 'drizzle-orm'
import { run, type Task } from 'graphile-worker'

import { generateContractPdf, UnknownTemplateVersionError } from '@/contracts/generate-pdf'
import {
  FORNECEDOR_STAND_V1_VERSION,
  type FornecedorStandV1Params,
} from '@/contracts/templates'
import { pool } from '@/db'
import { contracts } from '@/db/schema/contracts'
import { withTenant } from '@/db/with-tenant'
import {
  pdfGenerateContract,
  PDF_GENERATE_CONTRACT_TASK,
  ZAPSIGN_SEND_CONTRACT_TASK,
} from '@/jobs/tasks/pdf-generate-contract'
import { enqueueJob } from '@/jobs/enqueue'
import {
  resetMinIOClient,
  setMinIOClientForTests,
  getTenantBucket,
} from '@/lib/storage/minio'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeVendor } from '@/test/factories/vendor-factory'
import { makeContract } from '@/test/factories/contract-factory'
import { getMockMinIO, resetMockMinIO } from '@/test/minio-test'

// ────────────────────────────────────────────────────────────────────────────
// Test-only helpers
// ────────────────────────────────────────────────────────────────────────────

const TENANT_SLUG_PREFIX = 'pdfgen'

function buildParams(): FornecedorStandV1Params {
  return {
    contractNumber: 'ABCDEF12',
    organizadora: { name: 'Festa Trindade' },
    fornecedor: {
      legalName: 'Empresa Teste LTDA',
      cnpj: '12345678000190',
      email: 'fornecedor@example.com',
    },
    evento: {
      name: 'Festa de Trindade 2026',
      placeName: 'Santuário Trindade',
      placeAddress: 'Rua Teste, 100 — Trindade/GO',
      startsAt: new Date('2026-07-01T11:00:00Z'),
      endsAt: new Date('2026-07-15T22:00:00Z'),
    },
    lote: {
      code: 'A-12',
      areaM2: 10,
      categoryName: 'Stand Padrão',
      valueBRL: 'R$ 500,00',
    },
    generatedAt: new Date('2026-06-14T10:00:00Z'),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) throw new Error('DATABASE_MIGRATOR_URL is required for pdf-gen.test')

  // Bootstrap graphile-worker schema (idempotent).
  const r = await run({
    connectionString: migratorUrl,
    taskList: { [PDF_GENERATE_CONTRACT_TASK]: async () => {} },
    concurrency: 1,
    logger: undefined,
  })
  await r.stop()
})

beforeEach(() => {
  // Fresh in-memory mock MinIO per test so deterministic.
  resetMockMinIO()
  setMinIOClientForTests(getMockMinIO())
})

afterAll(async () => {
  resetMinIOClient()
  resetMockMinIO()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// 1-3. Pure helper tests (no DB)
// ────────────────────────────────────────────────────────────────────────────

describe('generateContractPdf (pure helper)', () => {
  test('returns a non-empty Buffer for the v1 template', async () => {
    const buffer = await generateContractPdf({
      templateVersion: FORNECEDOR_STAND_V1_VERSION,
      params: buildParams(),
    })
    expect(Buffer.isBuffer(buffer)).toBe(true)
    expect(buffer.length).toBeGreaterThan(500) // sanity — a 1-page PDF is ≥ ~1KB
  })

  test('the buffer starts with %PDF-1. (PDF magic bytes)', async () => {
    const buffer = await generateContractPdf({
      templateVersion: FORNECEDOR_STAND_V1_VERSION,
      params: buildParams(),
    })
    const head = buffer.subarray(0, 7).toString('ascii')
    expect(head).toBe('%PDF-1.')
  })

  test('unknown template_version throws UnknownTemplateVersionError', async () => {
    await expect(
      generateContractPdf({
        templateVersion: 'fornecedor-stand-v999',
        params: buildParams(),
      }),
    ).rejects.toThrow(UnknownTemplateVersionError)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4-5. Task handler tests (DB + MinIO + outbox)
// ────────────────────────────────────────────────────────────────────────────

describe('pdf.generate-contract task (worker)', () => {
  test('happy path: generates PDF, uploads to MinIO, updates pdf_minio_key, enqueues zapsign.send-contract', async () => {
    const stamp = Date.now()
    const tenantId = await createTenant(`${TENANT_SLUG_PREFIX}-${stamp}`, 'PDF Gen Tenant')
    const tenantSlug = `${TENANT_SLUG_PREFIX}-${stamp}`
    const userId = await insertUser(`pdfgen-${stamp}@example.test`, 'PDF Gen Actor')
    await insertOrganization(tenantId, `pdfgen-org-${stamp}`, 'PDF Gen Org')

    const ev = await makeEvent(tenantId)
    const cat = await makeLotCategory(tenantId, ev.id, { name: 'Stand', perSqmRate: 50 })
    const lot = await makeLot(tenantId, ev.id, cat.id, { code: 'A-12', areaM2: 10 })
    const vendor = await makeVendor(tenantId, { status: 'approved' })
    const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id)

    // Clear any old test jobs.
    await migratorPool`
      DELETE FROM graphile_worker._private_jobs
      WHERE task_id IN (
        SELECT id FROM graphile_worker._private_tasks
        WHERE identifier IN (${PDF_GENERATE_CONTRACT_TASK}, ${ZAPSIGN_SEND_CONTRACT_TASK})
      )
    `

    // Execute the task directly (no runner — keeps the test focused).
    const fakeHelpers = {
      job: { id: 999, task_identifier: PDF_GENERATE_CONTRACT_TASK },
    } as unknown as Parameters<typeof pdfGenerateContract>[1]
    await pdfGenerateContract(
      {
        tenant_id: tenantId,
        tenant_slug: tenantSlug,
        contract_id: contract.id,
        user_id: userId,
      },
      fakeHelpers,
    )

    // Assert contracts.pdf_minio_key populated.
    const updated = await withTenant(tenantId, async (db) => {
      const rows = await db.select().from(contracts).where(eq(contracts.id, contract.id)).limit(1)
      return rows[0]
    })
    expect(updated?.pdfMinioKey).toBe(`contracts/${contract.id}/contract-v1.pdf`)

    // Assert MinIO object exists with expected size + content type.
    const mock = getMockMinIO()
    const stat = await mock.statObject(
      getTenantBucket(tenantSlug),
      `contracts/${contract.id}/contract-v1.pdf`,
    )
    expect(stat.size).toBeGreaterThan(500)
    expect(stat.metaData['content-type']).toBe('application/pdf')

    // Assert zapsign.send-contract job enqueued.
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${ZAPSIGN_SEND_CONTRACT_TASK}
        AND j.payload->>'contract_id' = ${contract.id}
    `
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload?.tenant_id).toBe(tenantId)
    expect(jobs[0]?.payload?.tenant_slug).toBe(tenantSlug)

    // Assert audit row written (FORCE RLS — read via appPool + SET LOCAL).
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ action: string; payload: Record<string, unknown> }>>`
        SELECT action, payload FROM audit_log
        WHERE action = 'contract.pdf_generated' AND entity_id = ${contract.id}
      `
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]?.payload?.template_version).toBe(FORNECEDOR_STAND_V1_VERSION)
    expect(audits[0]?.payload?.lot_code).toBe('A-12')

    // Cleanup job rows for this test.
    await migratorPool`
      DELETE FROM graphile_worker._private_jobs
      WHERE task_id IN (
        SELECT id FROM graphile_worker._private_tasks
        WHERE identifier = ${ZAPSIGN_SEND_CONTRACT_TASK}
      )
    `
  })

  test('RLS-no-worker proof: task that does NOT call withTenant() throws on missing contract', async () => {
    // Arrange — seed a tenant + contract via the standard fixtures.
    const stamp = Date.now() + 1
    const tenantId = await createTenant(`${TENANT_SLUG_PREFIX}-rls-${stamp}`, 'PDF Gen RLS Tenant')
    const tenantSlug = `${TENANT_SLUG_PREFIX}-rls-${stamp}`
    const userId = await insertUser(`pdfgen-rls-${stamp}@example.test`, 'PDF Gen RLS Actor')
    await insertOrganization(tenantId, `pdfgen-rls-org-${stamp}`, 'PDF Gen RLS Org')

    const ev = await makeEvent(tenantId)
    const cat = await makeLotCategory(tenantId, ev.id)
    const lot = await makeLot(tenantId, ev.id, cat.id)
    const vendor = await makeVendor(tenantId, { status: 'approved' })
    const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id)

    // Now run the task by enqueuing it + actually consuming via the runner.
    // The runner uses fb_eventos_app (NOBYPASSRLS) — so a task that
    // SKIPS withTenant() must observe 0 rows for the contract.
    // We simulate the skip by writing a stand-in task that does the JOIN
    // OUTSIDE withTenant() and stashes the count.
    const observed: { count: number | null } = { count: null }
    const taskWithout: Task = async (_payload, helpers) => {
      await helpers.withPgClient(async (client) => {
        const res = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM contracts WHERE id = $1`,
          [contract.id],
        )
        observed.count = Number.parseInt(res.rows[0]?.n ?? '0', 10)
      })
    }

    const TASK = '__test_pdfgen_no_withtenant'
    await enqueueJob(migratorPool, TASK, {
      tenant_id: tenantId,
      tenant_slug: tenantSlug,
      contract_id: contract.id,
      user_id: userId,
    })

    // Run the worker briefly against the APP role so RLS engages.
    const appUrl = process.env.DATABASE_URL
    if (!appUrl) throw new Error('DATABASE_URL required')
    let resolveDone: () => void = () => {}
    const done = new Promise<void>((res) => {
      resolveDone = res
    })
    const wrapped: Task = async (payload, helpers) => {
      try {
        await taskWithout(payload, helpers)
      } finally {
        resolveDone()
      }
    }
    const r = await run({
      connectionString: appUrl,
      taskList: { [TASK]: wrapped },
      concurrency: 1,
      logger: undefined,
    })
    await Promise.race([
      done,
      new Promise((_, rej) => setTimeout(() => rej(new Error('task did not run')), 5000)),
    ])
    await r.stop()

    // RLS default-deny — the contract is invisible without app.current_tenant_id.
    expect(observed.count).toBe(0)

    // Cleanup
    await migratorPool`
      DELETE FROM graphile_worker._private_jobs
      WHERE task_id IN (
        SELECT id FROM graphile_worker._private_tasks WHERE identifier = ${TASK}
      )
    `
  })
})
