// FB_EVENTOS — Outbox handler: lot.status_changed (Phase 2, Plan 02-06).
//
// Thin delegator: enqueues lot.notify-channel (Plan 02-04 ships the task
// body) which fires pg_notify on the SSE channel. Same-tx emits handled by
// emitOutboxEventAndNotify go straight to pg_notify; this handler covers
// the cases where the outbox row was emitted from a different transaction
// (e.g. payment-paid handler in another tx).

import type { Task } from 'graphile-worker'
import { z } from 'zod'

import { migratorPool } from '@/db/migrator-pool'
import { enqueueJob } from '@/jobs/enqueue'
import { logger } from '@/lib/logger'

export const OUTBOX_LOT_STATUS_CHANGED_TASK = 'outbox.lot-status-changed'

const payloadSchema = z.object({
  tenant_id: z.string().uuid(),
  outbox_id: z.string().uuid(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    event_id: z.string().uuid().optional(),
    lot_id: z.string().uuid().optional(),
    new_status: z.enum(['available', 'reserved', 'sold', 'released']).optional(),
  }),
})

export const outboxLotStatusChanged: Task = async (raw, helpers) => {
  const parsed = payloadSchema.parse(raw ?? {})
  const { tenant_id, aggregate_id, payload } = parsed
  const lotId = payload.lot_id ?? aggregate_id
  const log = logger.child({
    task: OUTBOX_LOT_STATUS_CHANGED_TASK,
    tenantId: tenant_id,
    lotId,
    jobId: String(helpers.job.id),
  })

  if (!payload.event_id || !payload.new_status) {
    log.warn('payload missing event_id or new_status — skipping')
    return
  }

  await enqueueJob(migratorPool, 'lot.notify-channel', {
    tenant_id,
    event_id: payload.event_id,
    lot_id: lotId,
    new_status: payload.new_status,
  })

  log.info('lot.notify-channel enqueued')
}

export const outboxLotStatusChangedPayloadSchema = payloadSchema
