// FB_EVENTOS — vendor_consents table (Phase 2, Plan 02-01).
//
// LGPD-grade consent records for vendor-specific consent types
// (marketing, analytics, payment data). Separate from the
// general `consent_records` table (which covers user-auth consent).
//
// Analog: src/db/schema/consent.ts::consentRecords (Phase 0 LGPD baseline).
//
// CONSENT TYPES (CHECK constraint in migration 0018):
//   'marketing' | 'analytics' | 'payment_data'
//
// PII COLUMNS (COMMENT ON COLUMN 'PII:' in migration 0018):
//   ip_address — client IP at consent time (low-sensitivity but inventoried)
//
// Revocation: set revokedAt. Do NOT delete rows — audit trail is permanent.
//
// RLS SHAPE (per Phase 0 Pattern 1): tenant_isolation on every row.
//
// REFERENCES:
//   - 02-CONTEXT.md D-24 (vendor LGPD consent)
//   - 02-PATTERNS.md §Group B line 35 (consentRecords analog — exact)

import { sql } from 'drizzle-orm'
import { index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'
import { vendors } from './vendors'

export const vendorConsents = pgTable(
  'vendor_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    /**
     * Consent category. Values constrained by CHECK in migration 0018:
     * 'marketing' | 'analytics' | 'payment_data'
     */
    consentType: text('consent_type').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    /** Set when vendor revokes consent. Row is never deleted. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * PII: client IP at consent time (low-sensitivity but inventoried for LGPD-03).
     * Tagged with COMMENT ON COLUMN 'PII:' in migration 0018.
     */
    ipAddress: text('ip_address'),
    /** Snapshot of the consent wording the vendor agreed to (LGPD Art. 8). */
    consentText: text('consent_text'),
    consentVersion: text('consent_version').notNull(),
  },
  (table) => [
    index('vendor_consents_tenant_id_idx').on(table.tenantId),
    index('vendor_consents_vendor_id_idx').on(table.vendorId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
