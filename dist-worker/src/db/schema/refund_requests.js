"use strict";
// FB_EVENTOS — refund_requests table (Phase 2, Plan 02-01).
//
// FSM table tracking refund requests from vendors. Refund percentage
// follows the 4-tier policy in src/lib/refund/policy.ts (or tenant's
// custom refund_policy_json if set).
//
// Analog: src/db/schema/payments.ts::payments (gateway + status FSM).
//
// REFUND STATUS FSM (CHECK constraint in migration 0018):
//   pending → processing → completed | failed
//
// PII COLUMNS (COMMENT ON COLUMN 'PII:' in migration 0018):
//   reason — free-text; may contain CNPJ/email
//
// Pagar.me DELETE /core/v5/charges/{id} endpoint is used for refunds
// (NOT POST /charges/{id}/refunds — per AM-04 RESEARCH A10 verification).
// The pagarmeRefundId stores the charge id from the DELETE response.
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md D-07/D-08 (refund policy), AM-04 (DELETE endpoint)
//   - 02-PATTERNS.md §Group B line 36 (payments analog — exact)
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundRequests = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const payments_1 = require("./payments");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
const vendors_1 = require("./vendors");
exports.refundRequests = (0, pg_core_1.pgTable)('refund_requests', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    paymentId: (0, pg_core_1.uuid)('payment_id')
        .notNull()
        .references(() => payments_1.payments.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => vendors_1.vendors.id),
    requestedAt: (0, pg_core_1.timestamp)('requested_at', { withTimezone: true }).defaultNow().notNull(),
    /** Refund percentage (0.00–100.00) determined by the 4-tier policy. */
    refundPct: (0, pg_core_1.numeric)('refund_pct', { precision: 5, scale: 2 }).notNull(),
    /** Calculated refund amount in centavos. */
    refundAmountBrlCents: (0, pg_core_1.integer)('refund_amount_brl_cents').notNull(),
    /**
     * PII: free-text refund reason — may contain CNPJ/email.
     * Tagged with COMMENT ON COLUMN 'PII:' in migration 0018.
     */
    reason: (0, pg_core_1.text)('reason'),
    /**
     * FSM: pending → processing → completed | failed
     * Values constrained by CHECK in migration 0018.
     */
    status: (0, pg_core_1.text)('status').notNull().default('pending'),
    /**
     * Pagar.me charge id returned from DELETE /core/v5/charges/{id}.
     * Null until the refund is processed (per AM-04 RESEARCH A10).
     */
    pagarmeRefundId: (0, pg_core_1.text)('pagarme_refund_id'),
    completedAt: (0, pg_core_1.timestamp)('completed_at', { withTimezone: true }),
    /** Error message if the Pagar.me refund call fails. */
    failureReason: (0, pg_core_1.text)('failure_reason'),
}, (table) => [
    (0, pg_core_1.index)('refund_requests_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('refund_requests_payment_id_idx').on(table.paymentId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
