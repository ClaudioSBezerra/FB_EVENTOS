"use strict";
// FB_EVENTOS — Extract postgres.js TransactionSql from a Drizzle TenantDb
// (Phase 1, Plan 01-05 — extracted from Plan 01-04 fornecedores.ts).
//
// Plan 01-04 introduced this pattern inside `fornecedores.ts` so the
// outbox enqueueJob(tx, ...) lands in the SAME postgres.js transaction
// as the business UPDATE. Plan 01-05 reuses the same helper from worker
// tasks (pdf.generate-contract enqueues zapsign.send-contract). Extracting
// it here keeps the workaround localized.
//
// IMPORTANT: Drizzle's PgTransaction exposes its session as an `@internal`
// field, but the runtime layout is stable for postgres-js:
// `tx.session.client` is the TransactionSql tag. The integration test
// tests/jobs/enqueue.test.ts proves the runtime shape every commit; if a
// future Drizzle major version refactors `session.client`, this helper
// localizes the fix.
Object.defineProperty(exports, "__esModule", { value: true });
exports.rawSqlFromTenantDb = rawSqlFromTenantDb;
function rawSqlFromTenantDb(db) {
    const internal = db;
    return internal.session.client;
}
