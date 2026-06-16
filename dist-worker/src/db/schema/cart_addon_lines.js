"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartAddonLines = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const event_addons_1 = require("./event_addons");
const lot_reservations_1 = require("./lot_reservations");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.cartAddonLines = (0, pg_core_1.pgTable)('cart_addon_lines', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    reservationId: (0, pg_core_1.uuid)('reservation_id')
        .notNull()
        .references(() => lot_reservations_1.lotReservations.id, { onDelete: 'cascade' }),
    addonId: (0, pg_core_1.uuid)('addon_id')
        .notNull()
        .references(() => event_addons_1.eventAddons.id),
    quantity: (0, pg_core_1.integer)('quantity').notNull().default(1),
    /**
     * Price snapshot at reserve-time in centavos.
     * Locked in so that subsequent add-on price changes don't affect
     * in-flight reservations.
     */
    priceBrlCentsSnapshot: (0, pg_core_1.integer)('price_brl_cents_snapshot').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('cart_addon_lines_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('cart_addon_lines_reservation_id_idx').on(table.reservationId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
