// FB_EVENTOS — Outbox event-type → handler task name registry
// (Phase 2, Plan 02-06).
//
// The outbox.drain task scans `outbox_events` and uses this map to decide
// which Graphile-Worker task to enqueue per row. Keeping the mapping in
// one place lets us add new event types without touching the drain body.
//
// Tasks referenced here must be registered in src/jobs/tasks/index.ts —
// the drain enqueues by NAME (string), and graphile-worker dispatches via
// taskList lookup. A typo here surfaces as a poison row (handler missing →
// drain marks processing_status='failed' + alert).

import type { OutboxEventType } from '@/lib/outbox/emit'

import { OUTBOX_LOT_RELEASED_TASK, outboxLotReleased } from './lot-released'
import { OUTBOX_LOT_STATUS_CHANGED_TASK, outboxLotStatusChanged } from './lot-status-changed'
import { OUTBOX_PAYMENT_FAILED_TASK, outboxPaymentFailed } from './payment-failed'
import { OUTBOX_PAYMENT_PAID_TASK, outboxPaymentPaid } from './payment-paid'

/**
 * Maps an outbox event_type to the Graphile-Worker task identifier that
 * processes it. Returns `null` when no handler is registered — the drain
 * marks such rows as `processing_status='failed'`.
 */
export function handlerForEventType(eventType: string): string | null {
  switch (eventType as OutboxEventType) {
    case 'payment.paid':
      return OUTBOX_PAYMENT_PAID_TASK
    case 'payment.failed':
      return OUTBOX_PAYMENT_FAILED_TASK
    case 'payment.created':
      // No business reaction for created — Phase 2 SSE consumers see it via
      // lot.status_changed (reservation hold visual). Map to status-changed
      // delegation; drain will enqueue lot-notify-channel.
      return OUTBOX_LOT_STATUS_CHANGED_TASK
    case 'lot.reserved':
    case 'lot.sold':
    case 'lot.status_changed':
      return OUTBOX_LOT_STATUS_CHANGED_TASK
    case 'lot.released':
      return OUTBOX_LOT_RELEASED_TASK
    case 'refund.created':
      // Plan 02-07 ships outbox-refund-created. For now treat as poison so
      // it gets surfaced rather than silently lost.
      return null
    default:
      return null
  }
}

/**
 * Task functions exposed for registration in src/jobs/tasks/index.ts.
 * Each key is the Graphile-Worker task identifier (matches the strings
 * returned by handlerForEventType).
 */
export const OUTBOX_HANDLER_TASKS = {
  [OUTBOX_PAYMENT_PAID_TASK]: outboxPaymentPaid,
  [OUTBOX_PAYMENT_FAILED_TASK]: outboxPaymentFailed,
  [OUTBOX_LOT_RELEASED_TASK]: outboxLotReleased,
  [OUTBOX_LOT_STATUS_CHANGED_TASK]: outboxLotStatusChanged,
} as const
