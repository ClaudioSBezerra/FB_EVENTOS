// FB_EVENTOS — audit_log table (Phase 0, Plan 05).
//
// LGPD-04 append-only audit trail for sensitive operations. Every Server
// Action / job that mutates user-visible data SHOULD emit a row here via
// src/lib/audit.ts:recordAudit(db, opts) inside the caller's withTenant()
// transaction.
//
// SECURITY MODEL (defense in depth):
//   1. RLS policy: tenant_isolation — reads/writes only when
//      current_setting('app.current_tenant_id') matches tenant_id.
//   2. FORCE ROW LEVEL SECURITY — applies the policy to the table OWNER
//      too (set in migration 0007_pii_comments_and_audit_grants.sql).
//   3. GRANT layer: fb_eventos_app has INSERT only — NO UPDATE, NO DELETE
//      (REVOKE in migration 0007). The append-only contract is enforced
//      at the catalog, not just by convention.
//
// MISUSE DETECTION (load-bearing for tests/lgpd/audit-log-append-only.test.ts
// case "singleton db rejected"):
//   - Calling recordAudit(<singleton db>, opts) WITHOUT being inside a
//     withTenant() block causes the policy's withCheck to fail (because
//     current_setting('app.current_tenant_id', true) returns ''), which
//     triggers a 22P02 CAST error or a "new row violates row-level
//     security policy" error. Either is a loud-fail signal — never silent.
//
// PII INVENTORY:
//   - user_id, ip_address, user_agent, payload all carry PII or PII
//     references. The COMMENT ON COLUMN statements in migration 0007 tag
//     these for LGPD-03 inventory queries via information_schema +
//     pg_description.

import { sql } from 'drizzle-orm'
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // user_id is NOT a FK reference — audit rows must outlive soft-deleted
    // users (LGPD-05) and even the anonymize-after-retention Graphile-Worker
    // job (Phase 4). Keeping it as a plain uuid avoids cascade deletes that
    // would destroy the evidence trail.
    userId: uuid('user_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    payload: jsonb('payload'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_tenant_idx').on(table.tenantId),
    index('audit_log_user_idx').on(table.userId),
    index('audit_log_created_idx').on(table.createdAt),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
