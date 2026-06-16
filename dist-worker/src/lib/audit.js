"use strict";
// FB_EVENTOS — Audit log helper (Phase 0, Plan 05).
//
// LGPD-04 append-only audit trail. Callers MUST pass a withTenant-scoped
// Drizzle handle. Calling recordAudit with the singleton db (outside any
// withTenant block) is a defined misuse signal:
//
//   - The audit_log row carries `tenant_id = current_setting('app.current_tenant_id')`,
//     so when the caller is not inside withTenant the setting is empty,
//     the CAST fails with Postgres 22P02, OR the RLS policy's withCheck
//     evaluates to false (`'' = ''::uuid` → 22P02). Either outcome rejects
//     the INSERT — the misuse is loud, not silent.
//   - The test tests/lgpd/audit-log-append-only.test.ts case "singleton db
//     rejected" enforces this: passing the singleton `db` from `@/db` must
//     throw an error matching /row-level security/ OR /permission denied/
//     OR /violates row-level security/ OR /invalid input syntax for type
//     uuid/.
//
// Signature is explicit (no AsyncLocalStorage magic in Phase 0) — Phase 1+
// may add ALS sugar; the explicit signature stays as the canonical primitive.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAudit = recordAudit;
const drizzle_orm_1 = require("drizzle-orm");
const audit_1 = require("@/db/schema/audit");
/**
 * Insert an audit_log row inside the caller's `withTenant(...)` block.
 *
 * The tenant_id column is populated from `current_setting('app.current_tenant_id')`
 * — there is intentionally no `tenantId` parameter so callers cannot forge a
 * mismatching tenant context. The RLS policy's `WITH CHECK` then asserts the
 * setting matches, and the INSERT fails if the caller bypassed withTenant.
 *
 * @throws Postgres error if called outside a withTenant block (caller MUST
 *         handle or surface this — silently swallowing it defeats audit).
 */
async function recordAudit(db, opts) {
    await db.insert(audit_1.auditLog).values({
        // tenant_id is filled from the transaction-local setting. Drizzle's
        // value mapper needs the cast applied here; the policy's WITH CHECK
        // verifies the value matches the setting (which it will by construction).
        // biome-ignore lint/suspicious/noExplicitAny: drizzle insert expects a string for uuid; the SQL expression returns the same uuid as the policy reads
        tenantId: (0, drizzle_orm_1.sql) `current_setting('app.current_tenant_id', true)::uuid`,
        userId: opts.userId,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId,
        // biome-ignore lint/suspicious/noExplicitAny: jsonb accepts any JSON-serializable payload
        payload: opts.payload,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
    });
}
