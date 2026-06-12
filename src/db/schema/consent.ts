// FB_EVENTOS — Consent records (Phase 0, Plan 03 STUB).
//
// THIS IS A STUB. The minimum-columns shape declared here is what Plan 04's
// recordConsentMetadata Server Action will INSERT into. Plan 05 LAYERS the
// full LGPD-grade hardening on top:
//   - FORCE ROW LEVEL SECURITY
//   - REVOKE UPDATE, DELETE FROM fb_eventos_app (append-only at the GRANT layer)
//   - pgPolicy('tenant_isolation', ...)
//   - Additional columns: consentText, grantedScopes (jsonb)
//   - COMMENT ON COLUMN ... IS 'PII: ...' for the LGPD-03 inventory
//
// DO NOT add policies, FORCE RLS directives, or grants in this file —
// those belong in Plan 05's migrations so the LGPD audit trail clearly
// shows which migration introduced each constraint.

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { tenants } from './tenants'

export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  consentVersion: text('consent_version').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }).defaultNow().notNull(),
  consentIp: text('consent_ip'),
  userAgent: text('user_agent'),
})
