// FB_EVENTOS — lot_waitlist table (Phase 2, Plan 02-01).
//
// FIFO waitlist for lots. When a reservation expires or is released,
// the top 3 vendors on the waitlist are notified via email with a
// single-use JWT token (tokenJti, minted at notify time).
//
// Analog: src/db/schema/vendors.ts::vendorApplications (event-driven
// queue with per-vendor event-lot pairing).
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md D-11 (lot waitlist FIFO + JWT single-use)
//   - 02-PATTERNS.md §Group B line 32 (vendorApplications analog — exact)

import { sql } from 'drizzle-orm'
import { index, pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { events } from './events'
import { lots } from './lots'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'
import { vendors } from './vendors'

export const lotWaitlist = pgTable(
  'lot_waitlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id),
    /** Denormalized for fast notify scoping (pg_notify channel = event_id). */
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    /** Set when the vendor is notified that the lot is available again. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    /**
     * PII: not by itself; but ties vendor to lot release notification.
     * Minted at notify time for single-use JWT enforcement (FORN-15).
     * Null until the vendor is notified.
     */
    tokenJti: uuid('token_jti'),
  },
  (table) => [
    index('lot_waitlist_tenant_id_idx').on(table.tenantId),
    // Composite index for RANK computations (FIFO ordering by lot + join time).
    index('lot_waitlist_lot_id_joined_at_idx').on(table.lotId, table.joinedAt),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
