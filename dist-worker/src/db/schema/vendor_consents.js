"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.vendorConsents = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
const vendors_1 = require("./vendors");
exports.vendorConsents = (0, pg_core_1.pgTable)('vendor_consents', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => vendors_1.vendors.id),
    /**
     * Consent category. Values constrained by CHECK in migration 0018:
     * 'marketing' | 'analytics' | 'payment_data'
     */
    consentType: (0, pg_core_1.text)('consent_type').notNull(),
    grantedAt: (0, pg_core_1.timestamp)('granted_at', { withTimezone: true }).defaultNow().notNull(),
    /** Set when vendor revokes consent. Row is never deleted. */
    revokedAt: (0, pg_core_1.timestamp)('revoked_at', { withTimezone: true }),
    /**
     * PII: client IP at consent time (low-sensitivity but inventoried for LGPD-03).
     * Tagged with COMMENT ON COLUMN 'PII:' in migration 0018.
     */
    ipAddress: (0, pg_core_1.text)('ip_address'),
    /** Snapshot of the consent wording the vendor agreed to (LGPD Art. 8). */
    consentText: (0, pg_core_1.text)('consent_text'),
    consentVersion: (0, pg_core_1.text)('consent_version').notNull(),
}, (table) => [
    (0, pg_core_1.index)('vendor_consents_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('vendor_consents_vendor_id_idx').on(table.vendorId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
