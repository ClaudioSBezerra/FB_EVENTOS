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

import { sql } from 'drizzle-orm'
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const paymentWebhooksInbox = pgTable(
  'payment_webhooks_inbox',
  {
    /**
     * Pagar.me event id (e.g. 'hook_abc123'). TEXT PRIMARY KEY — Pagar.me uses
     * string IDs, not UUIDs. The PK enforces idempotency: duplicate deliveries
     * of the same event are silently discarded via ON CONFLICT DO NOTHING.
     */
    gatewayEventId: text('gateway_event_id').primaryKey(),
    /**
     * Denormalized tenant_id for worker entry via withTenant().
     * Resolved from order_id at webhook-receive time (Open Q4).
     */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Pagar.me event type (e.g. 'order.paid', 'order.payment_failed'). */
    eventType: text('event_type').notNull(),
    /** Raw request body preserved for audit + replay. */
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** 'pending' | 'processed' | 'failed' */
    processingStatus: text('processing_status').notNull().default('pending'),
  },
  (table) => [
    index('payment_webhooks_inbox_tenant_id_idx').on(table.tenantId),
    // Hot path: worker scans pending rows by received_at for processing.
    index('payment_webhooks_inbox_status_received_idx').on(
      table.processingStatus,
      table.receivedAt,
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
