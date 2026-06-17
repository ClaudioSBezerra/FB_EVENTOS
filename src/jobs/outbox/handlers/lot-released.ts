// FB_EVENTOS — Outbox handler: lot.released (Phase 2, Plan 02-06).
//
// Reacts to a freed lot:
//   1. Emit lot.status_changed so SSE consumers re-color (green/available).
//   2. Enqueue waitlist.notify-next (Plan 02-07 implements the task body;
//      this handler enqueues the name so the chain is in place — if 02-07
//      hasn't shipped yet, the worker logs the missing-task and retries
//      with backoff; we accept that as TODO until 02-07).
//   3. Audit.

import type { Task } from 'graphile-worker'
import { z } from 'zod'

import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { emitOutboxEvent } from '@/lib/outbox/emit'

export const OUTBOX_LOT_RELEASED_TASK = 'outbox.lot-released'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001'

const payloadSchema = z.object({
  tenant_id: z.string().uuid(),
  outbox_id: z.string().uuid(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    lot_id: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
    reservation_id: z.string().uuid().optional(),
    reason: z.string().optional(),
  }),
})

export const outboxLotReleased: Task = async (raw, helpers) => {
  const parsed = payloadSchema.parse(raw ?? {})
  const { tenant_id, aggregate_id, payload } = parsed
  const lotId = payload.lot_id ?? aggregate_id
  const eventId = payload.event_id
  const log = logger.child({
    task: OUTBOX_LOT_RELEASED_TASK,
    tenantId: tenant_id,
    lotId,
    jobId: String(helpers.job.id),
  })

  if (!eventId) {
    log.warn('event_id missing — skipping fan-out')
    return
  }

  await withTenant(tenant_id, async (db) => {
    // 1. SSE refresh.
    await emitOutboxEvent(db, 'lot.status_changed', lotId, {
      event_id: eventId,
      lot_id: lotId,
      new_status: 'available',
      tenant_id,
    })

    // 2. Notify next waitlisted vendor (Plan 02-07 ships the consumer).
    const tx = rawSqlFromTenantDb(db)
    await enqueueJob(tx, 'waitlist.notify-next', {
      tenant_id,
      lot_id: lotId,
      event_id: eventId,
    })

    // 3. Audit.
    await recordAudit(db, {
      action: 'lot.released.notified_waitlist',
      entity: 'lot',
      entityId: lotId,
      userId: SYSTEM_USER_ID,
      payload: { event_id: eventId, reason: payload.reason },
    })
  })

  log.info('lot.released fan-out completed')
}

export const outboxLotReleasedPayloadSchema = payloadSchema
