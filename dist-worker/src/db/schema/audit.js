"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLog = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.auditLog = (0, pg_core_1.pgTable)('audit_log', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    // user_id is NOT a FK reference — audit rows must outlive soft-deleted
    // users (LGPD-05) and even the anonymize-after-retention Graphile-Worker
    // job (Phase 4). Keeping it as a plain uuid avoids cascade deletes that
    // would destroy the evidence trail.
    userId: (0, pg_core_1.uuid)('user_id').notNull(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    action: (0, pg_core_1.text)('action').notNull(),
    entity: (0, pg_core_1.text)('entity').notNull(),
    entityId: (0, pg_core_1.uuid)('entity_id'),
    payload: (0, pg_core_1.jsonb)('payload'),
    ipAddress: (0, pg_core_1.text)('ip_address'),
    userAgent: (0, pg_core_1.text)('user_agent'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('audit_log_tenant_idx').on(table.tenantId),
    (0, pg_core_1.index)('audit_log_user_idx').on(table.userId),
    (0, pg_core_1.index)('audit_log_created_idx').on(table.createdAt),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
