// FB_EVENTOS — withTenant() wrapper (Phase 0, Plan 03).
//
// This is the ONLY supported way to access a tenant-owned table at runtime.
// Every Server Action, Route Handler, and Graphile-Worker task MUST call
// withTenant(tenantId, fn) before issuing a query against any table that
// carries a `tenant_isolation` RLS policy.
//
// SEMANTICS:
//   1. Opens a postgres.js transaction via `pool.begin(...)`.
//   2. Inside the transaction, runs `SELECT set_config('app.current_tenant_id',
//      $tenantId, true)` — the trailing `true` flag makes the setting
//      **transaction-local**. On COMMIT/ROLLBACK the setting resets to NULL
//      automatically; the pooled connection cannot leak the tenant_id to a
//      subsequent transaction.
//   3. Constructs a Drizzle wrapper around the transaction handle and calls
//      `fn(db)`. The caller queries through `db`; every query inherits the
//      transaction-local setting, and every RLS policy resolves to
//      `tenant_id = '<tenantId>'`.
//
// WHY THIS SHAPE (RESEARCH Pitfall 3 — "SET vs SET LOCAL"):
//   FB_APU04-era code might write `await tx`SET app.current_tenant_id = '${id}'``
//   without LOCAL. On a pooled connection, that setting persists across
//   transactions — if the next caller forgets to override it, they see the
//   PREVIOUS request's tenant data. Cross-tenant data read with NO error.
//
//   `set_config(name, value, is_local=true)` is the only correct primitive.
//   Bare `SET` is banned in this codebase. The integration test
//   tests/db/with-tenant.test.ts asserts that `current_setting` returns the
//   empty string in a transaction OUTSIDE a withTenant block — proving the
//   transaction-local semantics hold.
//
// WHY A TRANSACTION (even for reads):
//   postgres.js `begin()` reserves a single pooled connection for the
//   duration. set_config(..., true) is anchored to that transaction. If we
//   used `pool` directly (without begin), the SET LOCAL would have no
//   transaction to attach to.
//
// FAILURE MODES handled by callers / verified by tests:
//   - tenantId is not a UUID → Postgres CAST raises 22P02; the transaction
//     rolls back; withTenant rejects. Callers should validate tenantId
//     upstream (Better Auth session lookup ensures this).
//   - fn throws → transaction rolls back; the pooled connection is returned
//     to the pool with NO residual tenant_id (transaction-local cleanup).
//   - Connection drops → postgres.js retries per its pool semantics; on
//     retry, fn is invoked again — fn MUST be idempotent for at-least-once
//     execution under network failures. (Plan 06 documents the at-most-once
//     contract for Graphile-Worker jobs.)

import { sql } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { db } from './index'
import type * as schema from './schema'

/**
 * Transaction-scoped Drizzle handle as exposed by `db.transaction(cb)` for
 * postgres-js. This is what callers of withTenant receive — a Drizzle query
 * builder bound to a single Postgres transaction.
 */
export type TenantDb = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle's TablesRelationalConfig is internal
  any
>

/**
 * Run `fn` with `app.current_tenant_id` set to `tenantId` for the duration
 * of a single Postgres transaction. The setting is transaction-local
 * (SET LOCAL semantics via `set_config(..., true)`) and resets automatically
 * on COMMIT/ROLLBACK.
 *
 * @param tenantId UUID string. Must match a row in `tenants(id)` for any
 *                 INSERT to satisfy the FK; SELECT/UPDATE/DELETE return 0
 *                 rows if tenantId does not match the row's stored tenant_id.
 * @param fn       Async callback receiving a transaction-scoped Drizzle DB.
 * @returns        Whatever `fn` returns.
 *
 * @see RESEARCH.md "Pattern 3: withTenant" and "Pitfall 3: SET vs SET LOCAL"
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  // Use Drizzle's `db.transaction()` (which delegates to postgres.js's
  // `pool.begin()` under the hood). The callback receives a transaction-
  // scoped Drizzle handle — same query builder, same schema typing — so
  // callers can write `db.select().from(organization)` as usual and the
  // queries flow through the open transaction.
  return db.transaction(async (tx) => {
    // Transaction-local: the `true` flag is load-bearing. Removing it
    // would leak tenant_id across pooled connections (RESEARCH Pitfall 3
    // / T-0-01).
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`)
    return fn(tx as TenantDb)
  })
}
