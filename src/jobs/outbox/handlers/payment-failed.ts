// FB_EVENTOS — Outbox handler: payment.failed (Phase 2, Plan 02-06 — FORN-14).
//
// SAGA cancel: when payment fails, release the underlying reservation and
// emit lot.released so downstream (Plan 02-07's waitlist) can re-offer.
//
//   1. Re-check payment.status='failed' (defensive).
//   2. UPDATE lot_reservations.released_at WHERE id = reservation_id AND
//      released_at IS NULL.
//   3. Emit outbox 'lot.released' carrying { lot_id, reservation_id, reason }.
//   4. Audit.

import type { Task } from 'graphile-worker'
import { z } from 'zod'

import { withTenant } from '@/db/with-tenant'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { emitOutboxEvent } from '@/lib/outbox/emit'

export const OUTBOX_PAYMENT_FAILED_TASK = 'outbox.payment-failed'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001'

const payloadSchema = z.object({
  tenant_id: z.string().uuid(),
  outbox_id: z.string().uuid(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    payment_id: z.string().uuid().optional(),
    contract_id: z.string().uuid().optional(),
    vendor_id: z.string().uuid().optional(),
    lot_id: z.string().uuid().optional(),
    reservation_id: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
    reason: z.string().optional(),
  }),
})

export const outboxPaymentFailed: Task = async (raw, helpers) => {
  const parsed = payloadSchema.parse(raw ?? {})
  const { tenant_id, aggregate_id, payload } = parsed
  const paymentId = payload.payment_id ?? aggregate_id
  const log = logger.child({
    task: OUTBOX_PAYMENT_FAILED_TASK,
    tenantId: tenant_id,
    paymentId,
    jobId: String(helpers.job.id),
  })

  await withTenant(tenant_id, async (db) => {
    const tx = rawSqlFromTenantDb(db)

    // 1. Confirm payment is still 'failed'.
    const payRows = await tx<{ status: string }[]>`
      SELECT status FROM payments
       WHERE id = ${paymentId}::uuid AND deleted_at IS NULL
       LIMIT 1
    `
    const pay = payRows[0]
    if (!pay || pay.status !== 'failed') {
      log.warn({ status: pay?.status }, 'payment not in failed status — skipping')
      return
    }

    // 2. Release reservation (if any).
    let releasedRes: { lot_id: string; event_id: string } | undefined
    if (payload.reservation_id) {
      const rows = await tx<{ lot_id: string; event_id: string }[]>`
        UPDATE lot_reservations
           SET released_at = now()
         WHERE id = ${payload.reservation_id}::uuid AND released_at IS NULL
         RETURNING lot_id, event_id
      `
      releasedRes = rows[0]
    }

    // 3. Emit lot.released so the lot-released handler can fan out
    //    (waitlist notify + SSE re-color).
    const lotId = payload.lot_id ?? releasedRes?.lot_id
    const eventId = payload.event_id ?? releasedRes?.event_id
    if (lotId && eventId) {
      await emitOutboxEvent(db, 'lot.released', lotId, {
        lot_id: lotId,
        event_id: eventId,
        reservation_id: payload.reservation_id,
        reason: payload.reason ?? 'payment_failed',
        tenant_id,
      })
    }

    // 4. Audit.
    await recordAudit(db, {
      action: 'payment.failed.saga.released_reservation',
      entity: 'payment',
      entityId: paymentId,
      userId: SYSTEM_USER_ID,
      payload: {
        reservation_id: payload.reservation_id,
        lot_id: lotId,
        reason: payload.reason ?? 'payment_failed',
      },
    })

    log.info({ lotId, reservation: payload.reservation_id }, 'SAGA cancel completed')
  })
}

export const outboxPaymentFailedPayloadSchema = payloadSchema
