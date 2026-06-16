"use strict";
// FB_EVENTOS — Transactional outbox event emitter (Phase 2, Plan 02-03).
//
// Two exports:
//
//   emitOutboxEvent          — INSERT into outbox_events inside the caller's
//                              withTenant transaction. The tenant_id column is
//                              populated from current_setting so no explicit
//                              tenantId argument is needed — the RLS policy's
//                              WITH CHECK verifies the value automatically.
//
//   emitOutboxEventAndNotify — Like emitOutboxEvent + a same-tx pg_notify for
//                              SSE-tier latency on lot.status_changed events
//                              (AM-03: direct notify beats the outbox.drain
//                              cron by up to 1 minute).
//
// PATTERN from 02-PATTERNS.md lines 840-870 + 02-RESEARCH §Pattern 2.
//
// Payload SIZE: pg_notify channel payload is limited to 8000 bytes (Pitfall 3
// in 02-RESEARCH.md). emitOutboxEventAndNotify sends IDs only — never full
// payload — to stay safely below that limit.
//
// REFERENCES:
//   - 02-CONTEXT.md D-16 (transactional outbox), D-19 (SSE same-tx notify)
//   - 02-PATTERNS.md lines 840-870 (emitOutboxEvent canonical body)
//   - src/db/schema/outbox_events.ts (table definition + CHECK constraints)
//   - src/jobs/raw-sql-from-tenant-db.ts (rawSqlFromTenantDb for pg_notify)
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitOutboxEvent = emitOutboxEvent;
exports.emitOutboxEventAndNotify = emitOutboxEventAndNotify;
const drizzle_orm_1 = require("drizzle-orm");
const raw_sql_from_tenant_db_1 = require("@/jobs/raw-sql-from-tenant-db");
// ────────────────────────────────────────────────────────────────────────────
// emitOutboxEvent — INSERT inside the current withTenant transaction
// ────────────────────────────────────────────────────────────────────────────
/**
 * Insert an outbox_events row inside the caller's withTenant transaction.
 *
 * tenant_id is populated from `current_setting('app.current_tenant_id', true)::uuid`
 * — same as the RLS policy, so the row is automatically scoped to the active
 * tenant without an explicit parameter.
 *
 * @param db          TenantDb (Drizzle transaction handle from withTenant).
 * @param eventType   One of the OutboxEventType values (CHECK-constrained in DB).
 * @param aggregateId The primary entity this event refers to (e.g. lot_id,
 *                    payment_id). Used by the drain task for idempotency.
 * @param payload     JSON payload — keep under ~7.5 KB per Pitfall 3.
 */
async function emitOutboxEvent(db, eventType, aggregateId, payload) {
    await db.execute((0, drizzle_orm_1.sql) `
    INSERT INTO outbox_events (tenant_id, event_type, aggregate_id, payload)
    VALUES (
      current_setting('app.current_tenant_id', true)::uuid,
      ${eventType},
      ${aggregateId}::uuid,
      ${JSON.stringify(payload)}::jsonb
    )
  `);
}
/**
 * Insert a lot.status_changed outbox row AND issue a same-tx pg_notify so
 * the SSE handler (Plan 02-04) receives the update in ≤500 ms instead of
 * waiting for the next outbox.drain cron tick.
 *
 * Channel name: `event:${event_id}:lots`
 * Channel payload: `{ lot_id, new_status, event_id }` — IDs only (≤8 KB
 * per pg_notify limit, Pitfall 3).
 *
 * @param db      TenantDb (must be inside a withTenant transaction).
 * @param payload Slim payload with the changed lot's event_id, lot_id, new_status.
 */
async function emitOutboxEventAndNotify(db, _eventType, payload) {
    // 1. Insert the outbox row (persisted, drain-safe)
    await emitOutboxEvent(db, 'lot.status_changed', payload.lot_id, {
        event_id: payload.event_id,
        lot_id: payload.lot_id,
        new_status: payload.new_status,
    });
    // 2. pg_notify inside the SAME transaction for SSE-tier latency.
    //    rawSqlFromTenantDb extracts the underlying postgres.js TransactionSql
    //    tag so the notification is atomically tied to the business write.
    const channel = `event:${payload.event_id}:lots`;
    const notifyPayload = JSON.stringify({
        lot_id: payload.lot_id,
        new_status: payload.new_status,
        event_id: payload.event_id,
    });
    const tx = (0, raw_sql_from_tenant_db_1.rawSqlFromTenantDb)(db);
    await tx `SELECT pg_notify(${channel}, ${notifyPayload})`;
}
