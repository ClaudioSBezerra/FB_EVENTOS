"use strict";
// FB_EVENTOS — payment_webhooks_inbox table (Phase 2, Plan 02-01).
//
// Idempotency table for Pagar.me webhook deliveries. The PK is
// `gateway_event_id` (Pagar.me's event UUID — a TEXT field, not a
// postgres uuid, since Pagar.me uses string IDs like 'hook_abc').
// INSERT ... ON CONFLICT DO NOTHING enforces "at most once" processing.
//
// Analog: src/db/schema/contracts.ts::zapsignDocuments (gateway-id PK + jsonb payload).
//
// DENORMALIZED tenant_id: the webhook handler resolves tenant_id from
// the order_id BEFORE inserting (Open Q4). This lets the
// payment.process-webhook Graphile-Worker task enter withTenant()
// without a second cross-tenant lookup.
//
// NOTE: migration 0019 grants SELECT-only to fb_eventos_migrator so the
// cross-tenant worker can scan for pending webhook rows.
//
// FORCE RLS is applied in migration 0018 — same as all Phase 2 tables.
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md D-14 (webhook idempotency), AM-02 (HMAC auth), Open Q4
//   - 02-PATTERNS.md §Group B line 34 (zapsignDocuments analog — exact)
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentWebhooksInbox = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.paymentWebhooksInbox = (0, pg_core_1.pgTable)('payment_webhooks_inbox', {
    /**
     * Pagar.me event id (e.g. 'hook_abc123'). TEXT PRIMARY KEY — Pagar.me uses
     * string IDs, not UUIDs. The PK enforces idempotency: duplicate deliveries
     * of the same event are silently discarded via ON CONFLICT DO NOTHING.
     */
    gatewayEventId: (0, pg_core_1.text)('gateway_event_id').primaryKey(),
    /**
     * Denormalized tenant_id for worker entry via withTenant().
     * Resolved from order_id at webhook-receive time (Open Q4).
     */
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    /** Pagar.me event type (e.g. 'order.paid', 'order.payment_failed'). */
    eventType: (0, pg_core_1.text)('event_type').notNull(),
    /** Raw request body preserved for audit + replay. */
    payload: (0, pg_core_1.jsonb)('payload').notNull(),
    receivedAt: (0, pg_core_1.timestamp)('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: (0, pg_core_1.timestamp)('processed_at', { withTimezone: true }),
    /** 'pending' | 'processed' | 'failed' */
    processingStatus: (0, pg_core_1.text)('processing_status').notNull().default('pending'),
}, (table) => [
    (0, pg_core_1.index)('payment_webhooks_inbox_tenant_id_idx').on(table.tenantId),
    // Hot path: worker scans pending rows by received_at for processing.
    (0, pg_core_1.index)('payment_webhooks_inbox_status_received_idx').on(table.processingStatus, table.receivedAt),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
