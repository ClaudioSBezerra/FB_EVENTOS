"use strict";
// FB_EVENTOS — Graphile-Worker task: lot.notify-channel (Plan 02-04).
//
// This task is the "fallback" fan-out path for lot status changes that were
// NOT committed via emitOutboxEventAndNotify (which fires pg_notify in the
// same transaction). Use cases:
//
//   - payment.paid handler marks lot as 'sold' asynchronously: it emits a
//     lot.status_changed outbox event, which the outbox.drain cron picks up
//     and enqueues this task. SSE clients receive the status change within
//     the drain cycle (~1 min) instead of the same-tx ≤500 ms path.
//
//   - Reservation expiry: reservation.expire marks lots as 'available' and
//     may emit a lot.status_changed event for downstream consumers.
//
// Pattern per 02-PATTERNS.md lines 1066-1085 + 02-CONTEXT.md AM-03.
//
// IDEMPOTENCY: pg_notify is fire-and-forget. Replaying this task is harmless
// (the client might flicker briefly if it fetches the current status on
// receipt — but the fetched value is the authoritative DB state, so it
// self-corrects). No idempotency key is needed.
//
// PITFALL 3: payload ≤ 8000 bytes — send IDs only, never full row data.
//
// SECURITY: No withTenant needed — pg_notify is global and the channel name
// already contains event_id. The payload contains tenant_id for downstream
// logging; RLS is irrelevant for this task (no row read/write).
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotNotifyChannel = exports.LOT_NOTIFY_CHANNEL_TASK = void 0;
const zod_1 = require("zod");
const migrator_pool_1 = require("@/db/migrator-pool");
const logger_1 = require("@/lib/logger");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
exports.LOT_NOTIFY_CHANNEL_TASK = 'lot.notify-channel';
// ---------------------------------------------------------------------------
// Payload schema (Zod 4)
// ---------------------------------------------------------------------------
const lotNotifyChannelSchema = zod_1.z.object({
    tenant_id: zod_1.z.string().uuid(),
    event_id: zod_1.z.string().uuid(),
    lot_id: zod_1.z.string().uuid(),
    new_status: zod_1.z.enum(['available', 'reserved', 'sold', 'released']),
});
// ---------------------------------------------------------------------------
// Task handler
// ---------------------------------------------------------------------------
const log = logger_1.logger.child({ task: exports.LOT_NOTIFY_CHANNEL_TASK });
/**
 * Outbox-drain handler: fires pg_notify on the lot's SSE channel.
 *
 * Channel: `event:${event_id}:lots`
 * Payload: `{ lot_id, new_status, event_id }` — IDs only (Pitfall 3).
 */
const lotNotifyChannel = async (rawPayload, _helpers) => {
    const parsed = lotNotifyChannelSchema.parse(rawPayload);
    const { tenant_id, event_id, lot_id, new_status } = parsed;
    const channel = `event:${event_id}:lots`;
    // Pitfall 3: IDs only, never full row. Keep well under 8000 bytes.
    const payloadJson = JSON.stringify({ lot_id, new_status, event_id });
    await (0, migrator_pool_1.migratorPool) `SELECT pg_notify(${channel}, ${payloadJson})`;
    log.info({ tenant_id, event_id, lot_id, new_status, channel }, 'lot.notify-channel fired');
};
exports.lotNotifyChannel = lotNotifyChannel;
