"use strict";
// FB_EVENTOS — outbox_events table (Phase 2, Plan 02-01).
//
// Single-table discriminated event log for the transactional outbox pattern
// (D-16 + AM-03). Business writes + outbox row land in the SAME transaction;
// the outbox.drain cron task processes pending rows and dispatches them to
// Graphile-Worker handlers.
//
// Analog: src/db/schema/audit.ts::auditLog (append-only pattern) —
// but with FORCE RLS and a processing FSM.
//
// EVENT TYPES (CHECK constraint in migration 0018):
//   payment.created | payment.paid | payment.failed
//   lot.reserved | lot.sold | lot.released | lot.status_changed | refund.created
//
// PROCESSING STATUS (CHECK constraint in migration 0018):
//   pending | processed | failed
//
// NOTE: The outbox.drain cron task uses migratorPool for cross-tenant
// scans; migration 0019 grants SELECT + UPDATE on the drain columns to
// fb_eventos_migrator.
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md D-16 (transactional outbox), AM-03 (drain frequency)
//   - 02-PATTERNS.md §Group B line 33 (auditLog analog — role-match)
Object.defineProperty(exports, "__esModule", { value: true });
exports.outboxEvents = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.outboxEvents = (0, pg_core_1.pgTable)('outbox_events', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    /**
     * Discriminator for the event type. Values constrained by CHECK in migration 0018:
     * 'payment.created' | 'payment.paid' | 'payment.failed' |
     * 'lot.reserved' | 'lot.sold' | 'lot.released' | 'lot.status_changed' | 'refund.created'
     */
    eventType: (0, pg_core_1.text)('event_type').notNull(),
    /** lot_id OR payment_id depending on eventType. */
    aggregateId: (0, pg_core_1.uuid)('aggregate_id').notNull(),
    payload: (0, pg_core_1.jsonb)('payload').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Set by the outbox.drain task when processing completes. */
    processedAt: (0, pg_core_1.timestamp)('processed_at', { withTimezone: true }),
    /**
     * FSM status. Values constrained by CHECK in migration 0018:
     * 'pending' | 'processed' | 'failed'
     */
    processingStatus: (0, pg_core_1.text)('processing_status').notNull().default('pending'),
    /** Incremented on each drain attempt — guards against infinite retry. */
    attemptCount: (0, pg_core_1.integer)('attempt_count').notNull().default(0),
}, (table) => [
    (0, pg_core_1.index)('outbox_events_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('outbox_events_event_type_idx').on(table.eventType),
    // Hot path: the drain task scans for unprocessed rows by creation time.
    // Partial index excludes already-processed and permanently-failed rows.
    (0, pg_core_1.index)('outbox_events_unprocessed_idx')
        .on(table.createdAt)
        .where((0, drizzle_orm_1.sql) `processed_at IS NULL AND processing_status != 'failed'`),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
