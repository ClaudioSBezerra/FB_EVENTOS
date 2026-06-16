"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventAddons = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const events_1 = require("./events");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.eventAddons = (0, pg_core_1.pgTable)('event_addons', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    eventId: (0, pg_core_1.uuid)('event_id')
        .notNull()
        .references(() => events_1.events.id),
    name: (0, pg_core_1.text)('name').notNull(),
    /** Add-on price in centavos (R$ × 100). */
    priceBrlCents: (0, pg_core_1.integer)('price_brl_cents').notNull(),
    /** Maximum quantity a vendor may attach to one reservation. */
    maxQty: (0, pg_core_1.integer)('max_qty').notNull().default(1),
    /** Organizadora can deactivate without deleting — inactive add-ons are hidden from new reservations. */
    active: (0, pg_core_1.boolean)('active').notNull().default(true),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('event_addons_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('event_addons_event_id_idx').on(table.eventId),
    (0, pg_core_1.index)('event_addons_active_idx').on(table.active),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
