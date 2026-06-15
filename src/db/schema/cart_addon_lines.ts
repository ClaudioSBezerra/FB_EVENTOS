// FB_EVENTOS — cart_addon_lines table (Phase 2, Plan 02-01).
//
// Join table between lot_reservations and event_addons. Captures the
// add-ons a vendor selected during checkout alongside their snapshot
// price (price at reserve-time, preserved even if the add-on price
// changes later).
//
// Analog: src/db/schema/lots.ts::lots (role-match — bridge/join table
// with FK to parent + snapshot columns).
//
// CASCADE DELETE: when a reservation is released/deleted, its cart
// addon lines are automatically removed (ON DELETE CASCADE on reservationId).
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md D-01 (cart add-ons)
//   - 02-PATTERNS.md §Group B line 30 (lots analog — role-match)

import { sql } from 'drizzle-orm'
import { index, integer, pgPolicy, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { eventAddons } from './event_addons'
import { lotReservations } from './lot_reservations'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const cartAddonLines = pgTable(
  'cart_addon_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => lotReservations.id, { onDelete: 'cascade' }),
    addonId: uuid('addon_id')
      .notNull()
      .references(() => eventAddons.id),
    quantity: integer('quantity').notNull().default(1),
    /**
     * Price snapshot at reserve-time in centavos.
     * Locked in so that subsequent add-on price changes don't affect
     * in-flight reservations.
     */
    priceBrlCentsSnapshot: integer('price_brl_cents_snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('cart_addon_lines_tenant_id_idx').on(table.tenantId),
    index('cart_addon_lines_reservation_id_idx').on(table.reservationId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
