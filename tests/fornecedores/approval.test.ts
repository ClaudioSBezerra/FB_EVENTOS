// FB_EVENTOS — Vendor approval FSM tests (Phase 1, Plan 01-04 — Task 2).
//
// Six load-bearing cases (ORG-08 / ORG-16):
//
//   1. Approve pending → status=approved + audit row.
//   2. Approving already-approved vendor → throws.
//   3. Reject without reason rejected by Zod (vendorApprovalSchema refine).
//   4. Reject pending with reason → status=rejected + reason stored + audit.
//   5. Each transition enqueues a `email.send-status-update` job with the
//      right event payload (signup / aprovacao / rejecao).
//   6. RLS: tenant B cannot approve tenant A's vendor.

import { run } from 'graphile-worker'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import { approveVendorInTenant, rejectVendorInTenant } from '@/lib/actions/fornecedores'
import { EMAIL_STATUS_UPDATE_TASK } from '@/lib/actions/fornecedores.shared'
import { vendorApprovalSchema } from '@/lib/validators/vendor'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'
import { makeVendor } from '@/test/factories/vendor-factory'

let tenantAId = ''
let tenantBId = ''
let userId = ''

// Ensure graphile-worker schema is installed so add_job() works.
beforeAll(async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) {
    throw new Error('DATABASE_MIGRATOR_URL is required for approval.test')
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
  const stamp = Date.now()
  tenantAId = await createTenant(`vapr-a-${stamp}`, 'Vendor-Approval Tenant A')
  tenantBId = await createTenant(`vapr-b-${stamp}`, 'Vendor-Approval Tenant B')
  userId = await insertUser(`vapr-actor-${stamp}@example.test`, 'Vendor Apr Actor')

  // Clear any test jobs left over so the per-test counts are deterministic.
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks WHERE identifier = ${EMAIL_STATUS_UPDATE_TASK}
    )
  `
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

describe('vendor approval FSM — happy paths (Plan 01-04 Task 2)', () => {
  test('approve pending → status=approved + audit row + email job enqueued', async () => {
    const vendor = await makeVendor(tenantAId, { status: 'pending' })

    const approved = await withTenant(tenantAId, async (db) =>
      approveVendorInTenant(db, tenantAId, { vendorId: vendor.id, action: 'approve' }, userId),
    )
    expect(approved.status).toBe('approved')

    // Audit_log row written (FORCE RLS — read via appPool with SET LOCAL).
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ action: string; entity_id: string }>>`
        SELECT action, entity_id FROM audit_log
        WHERE action = 'vendor.approved' AND entity_id = ${vendor.id}
      `
    })
    expect(audits).toHaveLength(1)

    // Email job enqueued with the right payload. The public
    // graphile_worker.jobs VIEW omits `payload`; join through _private_jobs
    // + _private_tasks to read it back.
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'vendor_id' = ${vendor.id}
        AND j.payload->>'event' = 'aprovacao_fornecedor'
    `
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload?.tenant_id).toBe(tenantAId)
  })

  test('reject pending with reason → status=rejected + reason stored + email job', async () => {
    const vendor = await makeVendor(tenantAId, { status: 'pending' })

    const rejected = await withTenant(tenantAId, async (db) =>
      rejectVendorInTenant(
        db,
        tenantAId,
        { vendorId: vendor.id, action: 'reject', reason: 'Documentos faltantes' },
        userId,
      ),
    )
    expect(rejected.status).toBe('rejected')
    expect(rejected.approvalReason).toBe('Documentos faltantes')

    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE action = 'vendor.rejected' AND entity_id = ${vendor.id}
      `
    })
    expect(audits).toHaveLength(1)

    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'vendor_id' = ${vendor.id}
        AND j.payload->>'event' = 'rejecao_fornecedor'
    `
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload?.reason).toBe('Documentos faltantes')
  })
})

describe('vendor approval FSM — guards (Plan 01-04 Task 2)', () => {
  test('approving an already-approved vendor throws (idempotency error)', async () => {
    const vendor = await makeVendor(tenantAId, { status: 'approved' })

    await expect(
      withTenant(tenantAId, async (db) =>
        approveVendorInTenant(db, tenantAId, { vendorId: vendor.id, action: 'approve' }, userId),
      ),
    ).rejects.toThrow(/(já está|requer status "pending")/i)
  })

  test('vendorApprovalSchema rejects reject-without-reason payload (Zod)', () => {
    const parsed = vendorApprovalSchema.safeParse({
      vendorId: '00000000-0000-0000-0000-000000000001',
      action: 'reject',
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /motivo/i.test(i.message))).toBe(true)
    }
  })

  test('reject helper rejects empty-reason payload defensively', async () => {
    const vendor = await makeVendor(tenantAId, { status: 'pending' })

    await expect(
      withTenant(tenantAId, async (db) =>
        rejectVendorInTenant(
          db,
          tenantAId,
          { vendorId: vendor.id, action: 'reject', reason: '   ' },
          userId,
        ),
      ),
    ).rejects.toThrow(/motivo é obrigatório/i)
  })

  test('cross-tenant: tenant B cannot approve tenant A vendor (RLS hides the row)', async () => {
    const vendorA = await makeVendor(tenantAId, { status: 'pending' })

    await expect(
      withTenant(tenantBId, async (db) =>
        approveVendorInTenant(db, tenantBId, { vendorId: vendorA.id, action: 'approve' }, userId),
      ),
    ).rejects.toThrow(/não encontrado|inacessível/i)

    // Confirm: tenant A vendor still pending (no leak). vendors has FORCE RLS
    // and the policy targets fb_eventos_app only — read via appPool with
    // SET LOCAL app.current_tenant_id to land inside the tenant A scope.
    const stillPending = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ status: string }>>`
        SELECT status FROM vendors WHERE id = ${vendorA.id}
      `
    })
    expect(stillPending[0]?.status).toBe('pending')
  })
})
