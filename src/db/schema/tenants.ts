// FB_EVENTOS — Tenants table (Phase 0, Plan 03).
//
// `tenants` is a GLOBAL LOOKUP table — it has NO tenant_id column, NO RLS
// policy, and NO `withRLS()`. Resolving `slug → tenant_id` is the first
// query of every request (path-based tenant routing per RESEARCH Pattern 4)
// and it must succeed regardless of which tenant context is active.
//
// All OTHER application tables MUST have:
//   - `tenantId uuid not null references tenants(id)`
//   - `pgPolicy('tenant_isolation', { to: fbEventosApp, using: <tenant_id check> })`
//   - `.enableRLS()` chained on the table builder (drizzle-orm@0.45.2;
//     `withRLS()` is the post-v1.0-beta.1 rename, not yet shipped in 0.45)
//   - `ALTER TABLE <name> FORCE ROW LEVEL SECURITY` in 0002_force_rls.sql
// See RESEARCH Pattern 1 for the canonical shape.

import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /**
     * Platform commission rate applied to paid charges (0..1).
     * Default 0.0500 = 5% (Plan 01-07).
     *
     * NOT PII — operational config. The financial dashboard uses this to
     * compute `comissao = sum(paid_amount) × platform_commission_pct`.
     */
    platformCommissionPct: numeric('platform_commission_pct', { precision: 5, scale: 4 })
      .notNull()
      .default('0.0500'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // LGPD-05 soft-delete column (Plan 05 wires query helpers and the
    // anonymize-after-retention Graphile-Worker job).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('tenants_deleted_at_idx').on(table.deletedAt)],
)
