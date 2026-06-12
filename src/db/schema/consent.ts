// FB_EVENTOS — Consent records (Phase 0, Plan 05 — extends Plan 03 STUB).
//
// HISTORY:
//   - Plan 03 created the STUB shape (id, user_id, tenant_id NOT NULL,
//     consent_version, consent_at, consent_ip, user_agent).
//   - Plan 04 wired recordConsentMetadata Server Action to INSERT into it.
//   - Plan 05 (THIS PLAN) layers the full LGPD-grade hardening:
//       (a) tenant_id RELAXED to nullable so future pre-signup marketing-
//           page consent capture (Phase 2+) can persist a row before the
//           user has joined an organization. Plan 04's existing
//           recordConsentMetadata always provides a tenantId, so its flow
//           continues to work — verified by Plan 04 tests still passing.
//       (b) New column consent_text (the wording snapshot the user agreed
//           to — preserves evidence under LGPD Art. 8 "specific consent
//           for specific purposes" even if the wording changes later).
//       (c) New column granted_scopes (jsonb — for future granular consent
//           flows like {analytics:true,marketing:false}).
//       (d) Column rename: consent_ip → ip_address (aligns with audit_log,
//           which uses the LGPD-standard "ip_address" name).
//       (e) RLS policy tenant_isolation — permits reads/writes when
//           tenant_id matches the current setting OR is NULL (pre-signup).
//       (f) FORCE RLS + PII COMMENT ON COLUMN + (intentionally NO REVOKE
//           UPDATE/DELETE — consent records are versioned by INSERTing new
//           rows; UPDATE is permitted at the GRANT layer because future
//           workflows may need to mark rows as superseded).
//
// All DB-level enforcement (FORCE RLS + PII comments) lives in migration
// 0007_pii_comments_and_audit_grants.sql so that the LGPD audit trail
// clearly shows which migration introduced each constraint.

import { sql } from 'drizzle-orm'
import { jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Nullable: pre-signup marketing-page consent flows (Phase 2+) need to
    // persist a row before the user joins an organization. Plan 04's
    // recordConsentMetadata always provides a tenantId, so existing behavior
    // is unchanged. The RLS policy below explicitly permits NULL tenant_id
    // reads via `tenant_id IS NULL OR matches`.
    tenantId: uuid('tenant_id').references(() => tenants.id),
    consentVersion: text('consent_version').notNull(),
    // consentText: snapshot of the exact wording the user agreed to.
    // Required so that if the wording changes later, the audit trail still
    // shows what THIS row's user actually saw (LGPD Art. 8 "specific
    // consent for specific purposes"). Plan 05 adds the column with a
    // default so existing Plan 04 rows (which don't set this) remain valid.
    consentText: text('consent_text').notNull().default(''),
    // Granular scopes for future workflows. Phase 0 emits the same
    // {essential:true,...} object as the LGPD-02 cookie banner so the
    // schema is wire-compatible with the banner from day 1.
    grantedScopes: jsonb('granted_scopes'),
    consentAt: timestamp('consent_at', { withTimezone: true }).defaultNow().notNull(),
    // Renamed from consent_ip → ip_address for LGPD-standard naming and
    // alignment with audit_log.ip_address. The migration handles the
    // ALTER TABLE RENAME COLUMN.
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      // Permit access when tenant_id is NULL (pre-signup) OR matches the
      // current setting (post-signup). FORCE RLS in migration 0007 closes
      // the table-owner bypass.
      using: sql`${table.tenantId} IS NULL OR ${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} IS NULL OR ${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
