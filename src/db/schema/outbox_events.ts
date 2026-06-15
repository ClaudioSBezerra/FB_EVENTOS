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

import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /**
     * Discriminator for the event type. Values constrained by CHECK in migration 0018:
     * 'payment.created' | 'payment.paid' | 'payment.failed' |
     * 'lot.reserved' | 'lot.sold' | 'lot.released' | 'lot.status_changed' | 'refund.created'
     */
    eventType: text('event_type').notNull(),
    /** lot_id OR payment_id depending on eventType. */
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Set by the outbox.drain task when processing completes. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /**
     * FSM status. Values constrained by CHECK in migration 0018:
     * 'pending' | 'processed' | 'failed'
     */
    processingStatus: text('processing_status').notNull().default('pending'),
    /** Incremented on each drain attempt — guards against infinite retry. */
    attemptCount: integer('attempt_count').notNull().default(0),
  },
  (table) => [
    index('outbox_events_tenant_id_idx').on(table.tenantId),
    index('outbox_events_event_type_idx').on(table.eventType),
    // Hot path: the drain task scans for unprocessed rows by creation time.
    // Partial index excludes already-processed and permanently-failed rows.
    index('outbox_events_unprocessed_idx')
      .on(table.createdAt)
      .where(sql`processed_at IS NULL AND processing_status != 'failed'`),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
