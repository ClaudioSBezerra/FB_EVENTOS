// FB_EVENTOS — lot_reservations table (Phase 2, Plan 02-01).
//
// TTL-based reservation that locks a lot for a vendor for 15 minutes
// while they complete checkout. The partial UNIQUE index enforces
// "one active reservation per lot" at the catalog layer.
//
// Analog: src/db/schema/vendors.ts::lotAssignments (UNIQUE-active pattern).
//
// PARTIAL UNIQUE (not emitted by drizzle-kit — hand-authored in migration 0018):
//   CREATE UNIQUE INDEX lot_reservations_lot_id_active_unique
//     ON lot_reservations (lot_id)
//     WHERE released_at IS NULL AND expires_at > now()
//
// Advisory lock pattern lives in src/lib/actions/reservations.ts.
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md FORN-04, FORN-05 (TTL reservation + concurrent race)
//   - 02-PATTERNS.md §Group B line 31 (lotAssignments analog — exact)

import { sql } from 'drizzle-orm'
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { events } from './events'
import { lots } from './lots'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'
import { vendors } from './vendors'

export const lotReservations = pgTable(
  'lot_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    /** Denormalized for advisory-lock key + SSE channel scoping. */
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).defaultNow().notNull(),
    /** TTL expiry — default 15 minutes from reserve time (set by action). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Set when reservation is cancelled, expired, or converted to sold. */
    releasedAt: timestamp('released_at', { withTimezone: true }),
    /**
     * Payment method chosen at checkout commit. Nullable until the vendor
     * completes checkout — so the reservation can be created before the
     * payment form is shown.
     * Values: 'pix' | 'credit_card'
     */
    paymentMethod: text('payment_method'),
  },
  (table) => [
    index('lot_reservations_tenant_id_idx').on(table.tenantId),
    index('lot_reservations_vendor_id_idx').on(table.vendorId),
    index('lot_reservations_lot_id_idx').on(table.lotId),
    // Scanned by the reservation.expire scheduled task every minute.
    index('lot_reservations_expires_at_idx').on(table.expiresAt),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
