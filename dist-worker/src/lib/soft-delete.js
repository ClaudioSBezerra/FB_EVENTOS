"use strict";
// FB_EVENTOS — Soft-delete helpers (Phase 0, Plan 05 — LGPD-05).
//
// Every tenant-owned PII-bearing table in FB_EVENTOS carries a
// `deleted_at timestamptz` column (Plan 03 added it to `tenants` and `user`;
// Phase 1+ tables must follow the pattern). Standard query filters use
// `notDeleted(table)` to exclude soft-deleted rows by default.
//
// Hard-delete via a Graphile-Worker anonymize-after-retention job is the
// Phase 4 LGPD-07 work; Phase 0 only provides the schema column +
// query-time helpers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.notDeleted = notDeleted;
exports.softDelete = softDelete;
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Returns an `IS NULL` SQL predicate on `table.deletedAt`. Compose with
 * other `where` predicates inside `withTenant()`:
 *
 *   await db.select().from(organization)
 *     .where(and(eq(organization.tenantId, tid), notDeleted(organization)))
 *
 * Returns `isNull(table.deletedAt)` which Drizzle understands as
 * `deleted_at IS NULL`.
 */
function notDeleted(table) {
    // biome-ignore lint/suspicious/noExplicitAny: isNull accepts any column expression
    return (0, drizzle_orm_1.isNull)(table.deletedAt);
}
/**
 * Set `deleted_at = NOW()` on the row with `id`. Composes with `withTenant()`
 * — the caller MUST supply the tenant-scoped `db` so the UPDATE passes the
 * tenant_isolation policy's WITH CHECK clause.
 *
 * Returns nothing — the row may already be soft-deleted (idempotent) or may
 * not exist (RLS-hidden or genuinely absent). Callers needing a "did this
 * affect anything" check should run a follow-up SELECT.
 */
async function softDelete(db, table, id) {
    await db
        .update(table)
        .set({ deletedAt: (0, drizzle_orm_1.sql) `NOW()` })
        // biome-ignore lint/suspicious/noExplicitAny: id column is generic
        .where((0, drizzle_orm_1.eq)(table.id, id));
}
