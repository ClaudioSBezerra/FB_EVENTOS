"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.lots = exports.lotCategories = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const events_1 = require("./events");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.lotCategories = (0, pg_core_1.pgTable)('lot_categories', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    eventId: (0, pg_core_1.uuid)('event_id')
        .notNull()
        .references(() => events_1.events.id),
    name: (0, pg_core_1.text)('name').notNull(),
    // Aditivo pricing — ADR-0003. base_fixed + area × per_sqm_rate.
    // Either can be 0 (only fixed OR only per-sqm still works).
    baseFixed: (0, pg_core_1.numeric)('base_fixed', { precision: 12, scale: 2 }).notNull().default('0'),
    perSqmRate: (0, pg_core_1.numeric)('per_sqm_rate', { precision: 10, scale: 4 }).notNull().default('0'),
    // Hex color used by dashboard tinting + Konva read-only render
    color: (0, pg_core_1.text)('color'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('lot_categories_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('lot_categories_event_id_idx').on(table.eventId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
exports.lots = (0, pg_core_1.pgTable)('lots', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    eventId: (0, pg_core_1.uuid)('event_id')
        .notNull()
        .references(() => events_1.events.id),
    categoryId: (0, pg_core_1.uuid)('category_id')
        .notNull()
        .references(() => exports.lotCategories.id),
    /** Organizadora-visible lot code, e.g. "A-12". Unique per event. */
    code: (0, pg_core_1.text)('code').notNull(),
    /** Area in m² — used for aditivo pricing (lot.price = base + area × rate). */
    areaM2: (0, pg_core_1.numeric)('area_m2', { precision: 10, scale: 2 }).notNull(),
    /**
     * Versioned geometry jsonb (D-10):
     *   { "version": 1, "type": "polygon2d", "points": [[x,y]...], "z_index": N }
     * v2/v3 will introduce `version: 2, type: "extrude3d"` coexisting with v1.
     * The migration adds a CHECK enforcing version=1 / type='polygon2d' for now.
     */
    geometry: (0, pg_core_1.jsonb)('geometry').notNull(),
    // FSM: available → reserved → sold (Phase 2 will add reserved with TTL +
    // advisory locks; Phase 1 only flips available → sold via manual assign).
    status: (0, pg_core_1.text)('status').notNull().default('available'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('lots_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('lots_event_id_idx').on(table.eventId),
    (0, pg_core_1.index)('lots_category_id_idx').on(table.categoryId),
    (0, pg_core_1.index)('lots_status_idx').on(table.status),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
