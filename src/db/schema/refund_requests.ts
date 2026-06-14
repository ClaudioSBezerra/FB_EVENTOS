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

import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { payments } from './payments'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'
import { vendors } from './vendors'

export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    /** Refund percentage (0.00–100.00) determined by the 4-tier policy. */
    refundPct: numeric('refund_pct', { precision: 5, scale: 2 }).notNull(),
    /** Calculated refund amount in centavos. */
    refundAmountBrlCents: integer('refund_amount_brl_cents').notNull(),
    /**
     * PII: free-text refund reason — may contain CNPJ/email.
     * Tagged with COMMENT ON COLUMN 'PII:' in migration 0018.
     */
    reason: text('reason'),
    /**
     * FSM: pending → processing → completed | failed
     * Values constrained by CHECK in migration 0018.
     */
    status: text('status').notNull().default('pending'),
    /**
     * Pagar.me charge id returned from DELETE /core/v5/charges/{id}.
     * Null until the refund is processed (per AM-04 RESEARCH A10).
     */
    pagarmeRefundId: text('pagarme_refund_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Error message if the Pagar.me refund call fails. */
    failureReason: text('failure_reason'),
  },
  (table) => [
    index('refund_requests_tenant_id_idx').on(table.tenantId),
    index('refund_requests_payment_id_idx').on(table.paymentId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
