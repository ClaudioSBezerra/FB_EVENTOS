"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotWaitlist = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const events_1 = require("./events");
const lots_1 = require("./lots");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
const vendors_1 = require("./vendors");
exports.lotWaitlist = (0, pg_core_1.pgTable)('lot_waitlist', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    lotId: (0, pg_core_1.uuid)('lot_id')
        .notNull()
        .references(() => lots_1.lots.id),
    /** Denormalized for fast notify scoping (pg_notify channel = event_id). */
    eventId: (0, pg_core_1.uuid)('event_id')
        .notNull()
        .references(() => events_1.events.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => vendors_1.vendors.id),
    joinedAt: (0, pg_core_1.timestamp)('joined_at', { withTimezone: true }).defaultNow().notNull(),
    /** Set when the vendor is notified that the lot is available again. */
    notifiedAt: (0, pg_core_1.timestamp)('notified_at', { withTimezone: true }),
    /**
     * PII: not by itself; but ties vendor to lot release notification.
     * Minted at notify time for single-use JWT enforcement (FORN-15).
     * Null until the vendor is notified.
     */
    tokenJti: (0, pg_core_1.uuid)('token_jti'),
}, (table) => [
    (0, pg_core_1.index)('lot_waitlist_tenant_id_idx').on(table.tenantId),
    // Composite index for RANK computations (FIFO ordering by lot + join time).
    (0, pg_core_1.index)('lot_waitlist_lot_id_joined_at_idx').on(table.lotId, table.joinedAt),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
