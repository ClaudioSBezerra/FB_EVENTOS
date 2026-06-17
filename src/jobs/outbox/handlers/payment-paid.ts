// FB_EVENTOS — Outbox handler: payment.paid (Phase 2, Plan 02-06).
//
// Triggered by outbox.drain when payment.process-webhook persists a
// payment.paid event. Real business reaction:
//   1. Re-check payment.status='paid' (defensive — payload could be stale).
//   2. Advisory lock + mark lot.status='sold' (idempotent).
//   3. Release the underlying lot_reservations row.
//   4. Enqueue email.send-status-update for 'pagamento_recebido'.
//   5. Emit lot.status_changed outbox (SSE refresh).
//   6. Audit lot.sold.
//
// Pitfall 8 — withTenant is load-bearing. Without it, the handler reads
// 0 rows and silently no-ops. Test: tests/jobs/worker-without-with-tenant.
// Pitfall 6 — email only at payment.paid (not lot.reserved).
// Pitfall 8 (Plan 02-06 retake): refund-after-sold race — advisory lock
// keyed `lot:event_id:lot_id` matches the reservation lock.

import { sql } from 'drizzle-orm'
import type { Task } from 'graphile-worker'
import { z } from 'zod'

import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { emitOutboxEvent } from '@/lib/outbox/emit'

export const OUTBOX_PAYMENT_PAID_TASK = 'outbox.payment-paid'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001'

// outbox-drain wraps the raw outbox row in this envelope.
const payloadSchema = z.object({
  tenant_id: z.string().uuid(),
  outbox_id: z.string().uuid(),
  aggregate_id: z.string().uuid(), // payment_id
  payload: z.object({
    payment_id: z.string().uuid().optional(),
    contract_id: z.string().uuid().optional(),
    vendor_id: z.string().uuid().optional(),
    lot_id: z.string().uuid().optional(),
    reservation_id: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
  }),
})

export const outboxPaymentPaid: Task = async (raw, helpers) => {
  const parsed = payloadSchema.parse(raw ?? {})
  const { tenant_id, aggregate_id, payload } = parsed
  const paymentId = payload.payment_id ?? aggregate_id
  const log = logger.child({
    task: OUTBOX_PAYMENT_PAID_TASK,
    tenantId: tenant_id,
    paymentId,
    jobId: String(helpers.job.id),
  })

  await withTenant(tenant_id, async (db) => {
    const tx = rawSqlFromTenantDb(db)

    // 1. Confirm payment is still 'paid' (defensive against stale rows).
    const payRows = await tx<{ status: string; contract_id: string }[]>`
      SELECT status, contract_id FROM payments
       WHERE id = ${paymentId}::uuid AND deleted_at IS NULL
       LIMIT 1
    `
    const pay = payRows[0]
    if (!pay) {
      log.warn('payment row not found — skipping')
      return
    }
    if (pay.status !== 'paid') {
      log.warn({ status: pay.status }, 'payment not in paid status — skipping')
      return
    }

    const contractId = payload.contract_id ?? pay.contract_id

    // 2. Advisory lock + mark lot=sold (only when lot_id is provided).
    if (payload.lot_id && payload.event_id) {
      const lockKey = `lot:${payload.event_id}:${payload.lot_id}`
      await tx`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
      // Idempotent: only update if not already sold (no error if already sold).
      const updated = await tx<{ id: string }[]>`
        UPDATE lots SET status = 'sold', updated_at = now()
         WHERE id = ${payload.lot_id}::uuid AND status <> 'sold' AND deleted_at IS NULL
         RETURNING id
      `
      if (updated.length > 0) {
        log.info({ lotId: payload.lot_id }, 'lot marked as sold')
      } else {
        log.info({ lotId: payload.lot_id }, 'lot already sold or missing — idempotent skip')
      }
    }

    // 3. Release the reservation row (consumed by the successful payment).
    if (payload.reservation_id) {
      await tx`
        UPDATE lot_reservations SET released_at = now()
         WHERE id = ${payload.reservation_id}::uuid AND released_at IS NULL
      `
    }

    // 4. Enqueue email 'pagamento_recebido'. Pitfall 6: only at payment.paid.
    await enqueueJob(tx, 'email.send-status-update', {
      tenant_id,
      event: 'pagamento_recebido',
      payment_id: paymentId,
      contract_id: contractId,
      vendor_id: payload.vendor_id,
    })

    // 5. Emit lot.status_changed so SSE consumers re-color the lot.
    if (payload.lot_id && payload.event_id) {
      await emitOutboxEvent(db, 'lot.status_changed', payload.lot_id, {
        event_id: payload.event_id,
        lot_id: payload.lot_id,
        new_status: 'sold',
        tenant_id,
      })
    }

    // 6. Audit.
    await recordAudit(db, {
      action: 'lot.sold',
      entity: 'lot',
      entityId: payload.lot_id,
      userId: SYSTEM_USER_ID,
      payload: {
        payment_id: paymentId,
        contract_id: contractId,
        reservation_id: payload.reservation_id,
      },
    })
  })
}

// Schema export to ease unit tests.
export const outboxPaymentPaidPayloadSchema = payloadSchema
