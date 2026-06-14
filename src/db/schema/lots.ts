// FB_EVENTOS — Lot categories + lots schema (Phase 1, Plan 01-01).
//
// `lot_categories` — pricing buckets (ADR-0003 aditivo model:
// `lot.price = base_fixed + area_m² × per_sqm_rate`).
// `lots` — individual polygon-shaped spaces an event sells to vendors.
//   geometry persists as versioned jsonb (D-10): `{"version":1,
//   "type":"polygon2d","points":[[x,y]...],"z_index":N}` so the v2/v3
//   3D upgrade can land without ALTER TABLE.
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (schema highlights, geometry shape)
//   - 01-CONTEXT.md D-09 (aditivo pricing), D-10 (geometry jsonb)

import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { events } from './events'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const lotCategories = pgTable(
  'lot_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    // Aditivo pricing — ADR-0003. base_fixed + area × per_sqm_rate.
    // Either can be 0 (only fixed OR only per-sqm still works).
    baseFixed: numeric('base_fixed', { precision: 12, scale: 2 }).notNull().default('0'),
    perSqmRate: numeric('per_sqm_rate', { precision: 10, scale: 4 }).notNull().default('0'),
    // Hex color used by dashboard tinting + Konva read-only render
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('lot_categories_tenant_id_idx').on(table.tenantId),
    index('lot_categories_event_id_idx').on(table.eventId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

export const lots = pgTable(
  'lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => lotCategories.id),
    /** Organizadora-visible lot code, e.g. "A-12". Unique per event. */
    code: text('code').notNull(),
    /** Area in m² — used for aditivo pricing (lot.price = base + area × rate). */
    areaM2: numeric('area_m2', { precision: 10, scale: 2 }).notNull(),
    /**
     * Versioned geometry jsonb (D-10):
     *   { "version": 1, "type": "polygon2d", "points": [[x,y]...], "z_index": N }
     * v2/v3 will introduce `version: 2, type: "extrude3d"` coexisting with v1.
     * The migration adds a CHECK enforcing version=1 / type='polygon2d' for now.
     */
    geometry: jsonb('geometry').notNull(),
    // FSM: available → reserved → sold (Phase 2 will add reserved with TTL +
    // advisory locks; Phase 1 only flips available → sold via manual assign).
    status: text('status').notNull().default('available'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('lots_tenant_id_idx').on(table.tenantId),
    index('lots_event_id_idx').on(table.eventId),
    index('lots_category_id_idx').on(table.categoryId),
    index('lots_status_idx').on(table.status),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
