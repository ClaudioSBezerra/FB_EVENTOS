"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotReservations = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const events_1 = require("./events");
const lots_1 = require("./lots");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
const vendors_1 = require("./vendors");
exports.lotReservations = (0, pg_core_1.pgTable)('lot_reservations', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    lotId: (0, pg_core_1.uuid)('lot_id')
        .notNull()
        .references(() => lots_1.lots.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => vendors_1.vendors.id),
    /** Denormalized for advisory-lock key + SSE channel scoping. */
    eventId: (0, pg_core_1.uuid)('event_id')
        .notNull()
        .references(() => events_1.events.id),
    reservedAt: (0, pg_core_1.timestamp)('reserved_at', { withTimezone: true }).defaultNow().notNull(),
    /** TTL expiry — default 15 minutes from reserve time (set by action). */
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    /** Set when reservation is cancelled, expired, or converted to sold. */
    releasedAt: (0, pg_core_1.timestamp)('released_at', { withTimezone: true }),
    /**
     * Payment method chosen at checkout commit. Nullable until the vendor
     * completes checkout — so the reservation can be created before the
     * payment form is shown.
     * Values: 'pix' | 'credit_card'
     */
    paymentMethod: (0, pg_core_1.text)('payment_method'),
}, (table) => [
    (0, pg_core_1.index)('lot_reservations_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('lot_reservations_vendor_id_idx').on(table.vendorId),
    (0, pg_core_1.index)('lot_reservations_lot_id_idx').on(table.lotId),
    // Scanned by the reservation.expire scheduled task every minute.
    (0, pg_core_1.index)('lot_reservations_expires_at_idx').on(table.expiresAt),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
