// FB_EVENTOS — event_addons table (Phase 2, Plan 02-01).
//
// Optional add-ons that a vendor can attach to a lot reservation
// (e.g. electricity hookup, extra tables, internet bandwidth).
//
// Analog: src/db/schema/lots.ts::lotCategories (tenant-scoped catalog
// with event_id FK + price/qty columns).
//
// D-01: priceBrlCents (integer cents), maxQty (per-reservation cap),
//       active flag for organizadora to disable without deleting.
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md D-01 (event add-ons)
//   - 02-PATTERNS.md §Group B line 29 (lotCategories analog — exact)

import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { events } from './events'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const eventAddons = pgTable(
  'event_addons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    /** Add-on price in centavos (R$ × 100). */
    priceBrlCents: integer('price_brl_cents').notNull(),
    /** Maximum quantity a vendor may attach to one reservation. */
    maxQty: integer('max_qty').notNull().default(1),
    /** Organizadora can deactivate without deleting — inactive add-ons are hidden from new reservations. */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('event_addons_tenant_id_idx').on(table.tenantId),
    index('event_addons_event_id_idx').on(table.eventId),
    index('event_addons_active_idx').on(table.active),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
