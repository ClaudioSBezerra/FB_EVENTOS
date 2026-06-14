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

import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { contracts } from './contracts'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    gateway: text('gateway').notNull().default('pagarme'),
    gatewayOrderId: text('gateway_order_id'),
    gatewayChargeId: text('gateway_charge_id'),
    /** Amount in centavos (R$ × 100). Use integer (32-bit fits ≤ R$ 21M). */
    amountBrlCents: integer('amount_brl_cents').notNull(),
    /** 'pix' | 'credit_card' — Phase 1 supports both, no boleto yet. */
    method: text('method').notNull(),
    /** FSM: pending → paid | failed | refunded. */
    status: text('status').notNull().default('pending'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('payments_tenant_id_idx').on(table.tenantId),
    index('payments_contract_id_idx').on(table.contractId),
    index('payments_status_idx').on(table.status),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

export const pagarmeOrders = pgTable(
  'pagarme_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    /** The body we POSTed to Pagar.me /core/v5/orders. */
    requestPayload: jsonb('request_payload'),
    /** The 200 body Pagar.me returned (PIX QR code + copia-cola live here). */
    responsePayload: jsonb('response_payload'),
    /** UNIQUE — idempotency key for de-duplicating retries. */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('pagarme_orders_tenant_id_idx').on(table.tenantId),
    index('pagarme_orders_payment_id_idx').on(table.paymentId),
    uniqueIndex('pagarme_orders_idempotency_key_unique').on(table.idempotencyKey),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
