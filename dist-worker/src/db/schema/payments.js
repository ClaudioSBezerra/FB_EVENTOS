"use strict";
// FB_EVENTOS — Payments + Pagar.me orders schema (Phase 1, Plan 01-01).
//
// Phase 1 keeps the payments surface minimal: one charge per contract,
// PIX or credit card, NO split (Phase 2 adds split via Pagar.me Recipients).
//
// `pagarme_orders` holds the request/response JSON for replay + audit;
// `payments` is the durable business state.
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 + §A8 (payments + pagarme_orders + simple webhook)
//   - 01-CONTEXT.md ORG-12 (Pagar.me simple charge, no split)
Object.defineProperty(exports, "__esModule", { value: true });
exports.pagarmeOrders = exports.payments = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const contracts_1 = require("./contracts");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.payments = (0, pg_core_1.pgTable)('payments', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    contractId: (0, pg_core_1.uuid)('contract_id')
        .notNull()
        .references(() => contracts_1.contracts.id),
    gateway: (0, pg_core_1.text)('gateway').notNull().default('pagarme'),
    gatewayOrderId: (0, pg_core_1.text)('gateway_order_id'),
    gatewayChargeId: (0, pg_core_1.text)('gateway_charge_id'),
    /** Amount in centavos (R$ × 100). Use integer (32-bit fits ≤ R$ 21M). */
    amountBrlCents: (0, pg_core_1.integer)('amount_brl_cents').notNull(),
    /** 'pix' | 'credit_card' — Phase 1 supports both, no boleto yet. */
    method: (0, pg_core_1.text)('method').notNull(),
    /** FSM: pending → paid | failed | refunded. */
    status: (0, pg_core_1.text)('status').notNull().default('pending'),
    paidAt: (0, pg_core_1.timestamp)('paid_at', { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('payments_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('payments_contract_id_idx').on(table.contractId),
    (0, pg_core_1.index)('payments_status_idx').on(table.status),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
exports.pagarmeOrders = (0, pg_core_1.pgTable)('pagarme_orders', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    paymentId: (0, pg_core_1.uuid)('payment_id')
        .notNull()
        .references(() => exports.payments.id),
    /** The body we POSTed to Pagar.me /core/v5/orders. */
    requestPayload: (0, pg_core_1.jsonb)('request_payload'),
    /** The 200 body Pagar.me returned (PIX QR code + copia-cola live here). */
    responsePayload: (0, pg_core_1.jsonb)('response_payload'),
    /** UNIQUE — idempotency key for de-duplicating retries. */
    idempotencyKey: (0, pg_core_1.text)('idempotency_key').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('pagarme_orders_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('pagarme_orders_payment_id_idx').on(table.paymentId),
    (0, pg_core_1.uniqueIndex)('pagarme_orders_idempotency_key_unique').on(table.idempotencyKey),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
