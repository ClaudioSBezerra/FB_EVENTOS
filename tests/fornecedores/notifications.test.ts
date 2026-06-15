// FB_EVENTOS — Vendor notification enqueue stub tests
// (Phase 1, Plan 01-04 — Task 3 — stub for ORG-17).
//
// The actual email send + Resend templates land in Plan 01-08; this file
// asserts the enqueue contract that 01-08 will consume:
//
//   1. createVendor enqueues `email.send-status-update` with
//      event='signup_fornecedor'.
//   2. approveVendor enqueues with event='aprovacao_fornecedor'.
//   3. rejectVendor enqueues with event='rejecao_fornecedor' + reason field.
//   4. Every enqueued job carries vendor_id + tenant_id + legal_name in
//      payload (sufficient for the 01-08 handler to fetch vendor + render
//      template without re-loading the vendor row).
//
// Without these guarantees, 01-08's handler would receive jobs with
// inconsistent payload shapes and fail at runtime — this test pins the
// shape now so 01-08 ships confidently.

import { run } from 'graphile-worker'
import { HttpResponse, http } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import {
  approveVendorInTenant,
  createVendorInTenant,
  rejectVendorInTenant,
} from '@/lib/actions/fornecedores'
import { EMAIL_STATUS_UPDATE_TASK } from '@/lib/actions/fornecedores.shared'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'
import { setupExternalMocks } from '@/test/external-mocks'
import { makeVendor } from '@/test/factories/vendor-factory'

const mocks = setupExternalMocks()

let tenantAId = ''
let userId = ''

beforeAll(async () => {
  mocks.listen()
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) {
    throw new Error('DATABASE_MIGRATOR_URL is required for notifications.test')
  }
  const r = await run({
    connectionString: migratorUrl,
    taskList: { [EMAIL_STATUS_UPDATE_TASK]: async () => {} },
    concurrency: 1,
    logger: undefined,
  })
  await r.stop()
})

beforeEach(async () => {
  mocks.resetHandlers()
  const stamp = Date.now()
  tenantAId = await createTenant(`vnotif-a-${stamp}`, 'Vendor-Notif Tenant A')
  userId = await insertUser(`vnotif-actor-${stamp}@example.test`, 'Vendor Notif Actor')

  // Clear any test jobs from prior tests so per-test counts are deterministic.
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks WHERE identifier = ${EMAIL_STATUS_UPDATE_TASK}
    )
  `
})

afterAll(async () => {
  mocks.close()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

async function readJobs(filter: {
  vendorId: string
  event: string
}): Promise<Array<{ payload: Record<string, unknown> }>> {
  return migratorPool<Array<{ payload: Record<string, unknown> }>>`
    SELECT j.payload
    FROM graphile_worker._private_jobs j
    JOIN graphile_worker._private_tasks t ON t.id = j.task_id
    WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
      AND j.payload->>'vendor_id' = ${filter.vendorId}
      AND j.payload->>'event' = ${filter.event}
  `
}

describe('vendor notifications — enqueue contract (Plan 01-04 Task 3 stub for ORG-17)', () => {
  test('createVendor enqueues signup_fornecedor with tenant_id + vendor_id + legal_name', async () => {
    // BrasilAPI ACTIVE response keyed to the CNPJ used here.
    const ACTIVE_CNPJ = '12345678000195'
    mocks.use(
      http.get('https://brasilapi.com.br/api/cnpj/v1/:cnpj', () =>
        HttpResponse.json(
          {
            cnpj: ACTIVE_CNPJ,
            razao_social: 'NOTIF TEST LTDA',
            situacao_cadastral: 2,
            descricao_situacao_cadastral: 'ATIVA',
          },
          { status: 200 },
        ),
      ),
    )

    const created = await withTenant(tenantAId, async (db) =>
      createVendorInTenant(
        db,
        tenantAId,
        {
          legalName: 'Notif Empresa LTDA',
          tradeName: 'Notif Stand',
          cnpj: ACTIVE_CNPJ,
          email: 'notif@example.test',
          phone: '+5562999990000',
          address: 'Rua Teste, 100',
        },
        userId,
      ),
    )

    const jobs = await readJobs({ vendorId: created.id, event: 'signup_fornecedor' })
    expect(jobs).toHaveLength(1)
    const payload = jobs[0]?.payload
    expect(payload?.tenant_id).toBe(tenantAId)
    expect(payload?.vendor_id).toBe(created.id)
    expect(payload?.event).toBe('signup_fornecedor')
    expect(payload?.legal_name).toBe('Notif Empresa LTDA')
    expect(payload?.email).toBe('notif@example.test')
  })

  test('approveVendor enqueues aprovacao_fornecedor with vendor identity', async () => {
    const vendor = await makeVendor(tenantAId, {
      legalName: 'Aprovar Notif LTDA',
      email: 'aprovar@example.test',
      status: 'pending',
    })

    await withTenant(tenantAId, async (db) =>
      approveVendorInTenant(db, tenantAId, { vendorId: vendor.id, action: 'approve' }, userId),
    )

    const jobs = await readJobs({ vendorId: vendor.id, event: 'aprovacao_fornecedor' })
    expect(jobs).toHaveLength(1)
    const payload = jobs[0]?.payload
    expect(payload?.tenant_id).toBe(tenantAId)
    expect(payload?.vendor_id).toBe(vendor.id)
    expect(payload?.event).toBe('aprovacao_fornecedor')
    expect(payload?.legal_name).toBe('Aprovar Notif LTDA')
    expect(payload?.email).toBe('aprovar@example.test')
  })

  test('rejectVendor enqueues rejecao_fornecedor with the rejection reason', async () => {
    const vendor = await makeVendor(tenantAId, {
      legalName: 'Rejeitar Notif LTDA',
      email: 'rejeitar@example.test',
      status: 'pending',
    })

    await withTenant(tenantAId, async (db) =>
      rejectVendorInTenant(
        db,
        tenantAId,
        { vendorId: vendor.id, action: 'reject', reason: 'CNPJ baixado' },
        userId,
      ),
    )

    const jobs = await readJobs({ vendorId: vendor.id, event: 'rejecao_fornecedor' })
    expect(jobs).toHaveLength(1)
    const payload = jobs[0]?.payload
    expect(payload?.tenant_id).toBe(tenantAId)
    expect(payload?.vendor_id).toBe(vendor.id)
    expect(payload?.event).toBe('rejecao_fornecedor')
    expect(payload?.legal_name).toBe('Rejeitar Notif LTDA')
    expect(payload?.reason).toBe('CNPJ baixado')
  })

  test('all enqueued jobs uniformly carry tenant_id + vendor_id (no payload drift)', async () => {
    const vendor = await makeVendor(tenantAId, {
      legalName: 'Uniform Payload LTDA',
      email: 'uniform@example.test',
      status: 'pending',
    })
    await withTenant(tenantAId, async (db) =>
      approveVendorInTenant(db, tenantAId, { vendorId: vendor.id, action: 'approve' }, userId),
    )

    // Inspect every email job enqueued for this vendor — all share the
    // canonical envelope (tenant_id + vendor_id + event).
    const all = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'vendor_id' = ${vendor.id}
    `
    expect(all.length).toBeGreaterThan(0)
    for (const job of all) {
      expect(job.payload).toMatchObject({
        tenant_id: tenantAId,
        vendor_id: vendor.id,
      })
      expect(typeof job.payload.event).toBe('string')
    }
  })
})
