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

import { sql } from 'drizzle-orm'
import { auditLog } from '@/db/schema/audit'
import type { TenantDb } from '@/db/with-tenant'

export interface RecordAuditOptions {
  /** Coarse action name. e.g. 'user.signup', 'event.created'. */
  action: string
  /** Table or domain entity name. e.g. 'organization', 'event'. */
  entity: string
  /** Optional UUID of the affected row. */
  entityId?: string
  /** Sanitized payload — NEVER raw passwords or full PII. */
  payload?: unknown
  /** Acting user UUID — required. */
  userId: string
  /** Optional client IP (if known by the caller). */
  ipAddress?: string
  /** Optional user-agent (if known by the caller). */
  userAgent?: string
}

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
export async function recordAudit(db: TenantDb, opts: RecordAuditOptions): Promise<void> {
  await db.insert(auditLog).values({
    // tenant_id is filled from the transaction-local setting. Drizzle's
    // value mapper needs the cast applied here; the policy's WITH CHECK
    // verifies the value matches the setting (which it will by construction).
    // biome-ignore lint/suspicious/noExplicitAny: drizzle insert expects a string for uuid; the SQL expression returns the same uuid as the policy reads
    tenantId: sql`current_setting('app.current_tenant_id', true)::uuid` as any,
    userId: opts.userId,
    action: opts.action,
    entity: opts.entity,
    entityId: opts.entityId,
    // biome-ignore lint/suspicious/noExplicitAny: jsonb accepts any JSON-serializable payload
    payload: opts.payload as any,
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  })
}
