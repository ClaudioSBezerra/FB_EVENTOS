"use strict";
// FB_EVENTOS — Graphile-Worker task: reservation.expire (Phase 2, Plan 02-03).
//
// Scheduled every minute via crontab (AM-03 — 1 minute is graphile-worker min).
// Cross-tenant batch scan: finds lot_reservations rows where:
//   - expires_at < now()  (TTL has elapsed)
//   - released_at IS NULL (not yet released)
// For each row, enters withTenant() and:
//   1. UPDATEs released_at = now()
//   2. Emits 'lot.released' outbox event
//   3. Emits 'lot.status_changed' pg_notify for SSE-tier latency (AM-03)
//
// PROCESSING SHAPE:
//   LIMIT 500 + FOR UPDATE SKIP LOCKED — concurrent-safe batch; the next cron
//   tick picks up the remaining rows. Prevents the task from blocking a
//   single invocation on high-volume expiry bursts (e.g. all lots at Trindade
//   expire simultaneously at T+15min if checkout flow opens all at once).
//
// REFERENCES:
//   - 02-PATTERNS.md lines 1022-1046 (canonical body)
//   - 02-CONTEXT.md FORN-06 (scheduled expiry requirement)
//   - src/db/migrator-pool.ts (BYPASSRLS cross-tenant scan pool)
//   - src/db/with-tenant.ts (tenant-scoped UPDATE + outbox emit)
Object.defineProperty(exports, "__esModule", { value: true });
exports.reservationExpire = exports.RESERVATION_EXPIRE_TASK = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const migrator_pool_1 = require("@/db/migrator-pool");
const with_tenant_1 = require("@/db/with-tenant");
const logger_1 = require("@/lib/logger");
const emit_1 = require("@/lib/outbox/emit");
// ────────────────────────────────────────────────────────────────────────────
// Task identifier — must match the crontab entry in runner.ts
// ────────────────────────────────────────────────────────────────────────────
exports.RESERVATION_EXPIRE_TASK = 'reservation.expire';
// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────
const reservationExpire = async (_payload, _helpers) => {
    const log = logger_1.logger.child({ component: exports.RESERVATION_EXPIRE_TASK });
    // Cross-tenant scan via BYPASSRLS pool (migratorPool).
    // FOR UPDATE SKIP LOCKED: skip rows locked by a concurrent invocation —
    // prevents duplicate processing if two cron ticks overlap (Pitfall 11).
    const rows = await (0, migrator_pool_1.migratorPool) `
    SELECT id, tenant_id, lot_id, event_id
    FROM lot_reservations
    WHERE expires_at < now()
      AND released_at IS NULL
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  `;
    if (rows.length === 0) {
        log.debug({ count: 0 }, 'reservation.expire: nothing to release');
        return;
    }
    log.info({ count: rows.length }, 'reservation.expire: releasing expired reservations');
    for (const row of rows) {
        try {
            await (0, with_tenant_1.withTenant)(row.tenant_id, async (db) => {
                // UPDATE released_at only if still null (extra idempotency guard
                // in case two concurrent tasks race past SKIP LOCKED)
                await db.execute((0, drizzle_orm_1.sql) `
          UPDATE lot_reservations
          SET released_at = now()
          WHERE id = ${row.id}::uuid
            AND released_at IS NULL
        `);
                // Emit lot.released outbox event
                await (0, emit_1.emitOutboxEvent)(db, 'lot.released', row.lot_id, {
                    reservation_id: row.id,
                    event_id: row.event_id,
                    reason: 'ttl_expired',
                });
                // Emit lot.status_changed + pg_notify for SSE-tier latency (AM-03)
                await (0, emit_1.emitOutboxEventAndNotify)(db, 'lot.status_changed', {
                    event_id: row.event_id,
                    lot_id: row.lot_id,
                    new_status: 'available',
                });
            });
        }
        catch (err) {
            // Log per-row errors but do not abort the batch — process remaining rows
            log.error({ reservationId: row.id, tenantId: row.tenant_id, error: err }, 'reservation.expire: failed to release reservation row');
        }
    }
    log.info({ released: rows.length }, 'reservation.expire: batch complete');
};
exports.reservationExpire = reservationExpire;
