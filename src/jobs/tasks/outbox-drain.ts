// FB_EVENTOS — Outbox drain scheduled task (Phase 2, Plan 02-06 — AM-03).
//
// Scans `outbox_events` cross-tenant for pending rows and dispatches them
// to the per-event-type Graphile-Worker handlers. The drain itself runs as
// the migrator role (BYPASSRLS) because it needs to see every tenant; each
// handler enters withTenant(payload.tenant_id) on its own to read business
// data RLS-scoped (Pitfall 8).
//
// CONTRACT (02-PATTERNS.md lines 941-985 + Pitfall 11):
//   SELECT ... FOR UPDATE SKIP LOCKED LIMIT BATCH  — concurrent drains
//   never pick the same row; the partial index outbox_events_unprocessed
//   speeds up the scan.
//   processing_status='failed' rows are SKIPPED (no infinite retry).
//   attempt_count overflow ≥ MAX_DRAIN_ATTEMPTS → flag as failed.
//
// SCHEDULING: graphile-worker's crontab parser rejects task names with
// dots (regex `[_a-zA-Z][_a-zA-Z0-9-]*`). Instead of renaming the task,
// runner.ts schedules outbox.drain via setInterval(enqueueJob, 60_000).
// See src/jobs/runner.ts for the boot-side wiring.

import type { Task } from 'graphile-worker'
import { migratorPool } from '@/db/migrator-pool'
import { enqueueJob } from '@/jobs/enqueue'
import { handlerForEventType } from '@/jobs/outbox/handlers'
import { logger } from '@/lib/logger'

export const OUTBOX_DRAIN_TASK = 'outbox.drain'

const BATCH_SIZE = Number(process.env.OUTBOX_DRAIN_BATCH ?? 100)
const MAX_DRAIN_ATTEMPTS = Number(process.env.OUTBOX_DRAIN_MAX_ATTEMPTS ?? 5)

interface OutboxRow {
  id: string
  tenant_id: string
  event_type: string
  aggregate_id: string
  payload: Record<string, unknown>
  attempt_count: number
}

export const outboxDrain: Task = async (_rawPayload, helpers) => {
  const log = logger.child({
    task: OUTBOX_DRAIN_TASK,
    jobId: String(helpers.job.id),
  })

  let picked = 0
  let dispatched = 0
  let failed = 0

  await migratorPool.begin(async (tx) => {
    const rows = await tx<OutboxRow[]>`
      SELECT id, tenant_id, event_type, aggregate_id, payload, attempt_count
        FROM outbox_events
       WHERE processed_at IS NULL AND processing_status <> 'failed'
       ORDER BY created_at
       LIMIT ${BATCH_SIZE}
       FOR UPDATE SKIP LOCKED
    `
    picked = rows.length

    for (const row of rows) {
      const taskName = handlerForEventType(row.event_type)

      if (!taskName) {
        // Unknown event type — mark as failed so it doesn't loop forever.
        await tx`
          UPDATE outbox_events
             SET processing_status = 'failed',
                 attempt_count = attempt_count + 1
           WHERE id = ${row.id}
        `
        log.warn({ outboxId: row.id, eventType: row.event_type }, 'no handler — marked failed')
        failed++
        continue
      }

      try {
        await enqueueJob(tx, taskName, {
          tenant_id: row.tenant_id,
          outbox_id: row.id,
          aggregate_id: row.aggregate_id,
          payload: row.payload,
        })
        await tx`
          UPDATE outbox_events
             SET processed_at = now(),
                 processing_status = 'processed',
                 attempt_count = attempt_count + 1
           WHERE id = ${row.id}
        `
        dispatched++
      } catch (err) {
        // Enqueue failed (rare — pg connection blip, syntax error). Bump
        // attempt_count; flag failed once over the threshold.
        const nextCount = row.attempt_count + 1
        if (nextCount >= MAX_DRAIN_ATTEMPTS) {
          await tx`
            UPDATE outbox_events
               SET processing_status = 'failed',
                   attempt_count = ${nextCount}
             WHERE id = ${row.id}
          `
          log.error(
            {
              outboxId: row.id,
              eventType: row.event_type,
              attempts: nextCount,
              err: err instanceof Error ? err.message : String(err),
            },
            'enqueue failed N times — marked permafailed',
          )
          failed++
        } else {
          await tx`
            UPDATE outbox_events
               SET attempt_count = ${nextCount}
             WHERE id = ${row.id}
          `
          log.warn(
            {
              outboxId: row.id,
              eventType: row.event_type,
              attempts: nextCount,
              err: err instanceof Error ? err.message : String(err),
            },
            'enqueue failed — will retry next tick',
          )
        }
      }
    }
  })

  log.info({ picked, dispatched, failed }, 'outbox drain tick completed')
}
