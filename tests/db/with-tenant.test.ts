// FB_EVENTOS — RLS Contract Test 2 of 3 (Phase 0, Plan 03 — TENA-05).
//
// Asserts the semantics of `withTenant(tenantId, fn)`:
//
//   1. `fn`'s return value is propagated back.
//   2. `set_config('app.current_tenant_id', $id, true)` is SET LOCAL —
//      i.e., the setting is transaction-local and resets to empty string
//      after the transaction commits. This is the RESEARCH Pitfall 3
//      mitigation. If this assertion ever turns red, somebody changed the
//      `true` flag to `false` (or removed it) — fix the withTenant
//      implementation, not this test.
//   3. Two concurrent `withTenant` calls do NOT leak: each transaction sees
//      only its own tenantId in `current_setting`. (Postgres MVCC + pool
//      checkout already guarantees this, but the test makes the guarantee
//      visible at the application layer.)
//
// The pool used by withTenant is `appPool` (= DATABASE_URL = fb_eventos_app
// role). All assertions therefore exercise the SAME role + the SAME pool
// that production code uses.

import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from '../../src/db'
import { withTenant } from '../../src/db/with-tenant'
import { appPool, createTenant, migratorPool } from '../../src/test/db'

let tenantA = ''
let tenantB = ''

// beforeEach because the global setup.ts TRUNCATE in afterEach wipes the
// tenants table between tests.
beforeEach(async () => {
  tenantA = await createTenant(`with-tenant-a-${Date.now()}`, 'With Tenant A')
  tenantB = await createTenant(`with-tenant-b-${Date.now()}`, 'With Tenant B')
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

test('withTenant returns the callback value', async () => {
  const result = await withTenant(tenantA, async (db) => {
    const rows = await db.execute<{ current_setting: string }>(
      // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
      `SELECT current_setting('app.current_tenant_id', true) AS current_setting` as any,
    )
    return rows[0]?.current_setting ?? ''
  })
  expect(result).toBe(tenantA)
})

test('set_config is transaction-local (RESEARCH Pitfall 3)', async () => {
  // Inside withTenant: setting equals tenantA.
  const insideValue = await withTenant(tenantA, async (db) => {
    const rows = await db.execute<{ s: string }>(
      // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
      `SELECT current_setting('app.current_tenant_id', true) AS s` as any,
    )
    return rows[0]?.s ?? ''
  })
  expect(insideValue).toBe(tenantA)

  // After withTenant commits, a fresh query on the SAME pool returns empty
  // string — proving the setting did not leak past the transaction.
  // Use the underlying postgres.js client to bypass Drizzle's transaction-
  // wrapping layer and prove the pool's connection is clean.
  const outsideRows = await appPool<
    { s: string }[]
  >`SELECT current_setting('app.current_tenant_id', true) AS s`
  expect(outsideRows[0]?.s ?? '').toBe('')
})

test('concurrent withTenant calls do NOT leak tenantId between each other', async () => {
  // Run two withTenant calls in parallel. Each must see only its own
  // tenantId via current_setting — never the other's.
  const [a, b] = await Promise.all([
    withTenant(tenantA, async (db) => {
      // Small async delay to maximize overlap with the other transaction.
      await new Promise((r) => setTimeout(r, 25))
      const rows = await db.execute<{ s: string }>(
        // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
        `SELECT current_setting('app.current_tenant_id', true) AS s` as any,
      )
      return rows[0]?.s ?? ''
    }),
    withTenant(tenantB, async (db) => {
      await new Promise((r) => setTimeout(r, 25))
      const rows = await db.execute<{ s: string }>(
        // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
        `SELECT current_setting('app.current_tenant_id', true) AS s` as any,
      )
      return rows[0]?.s ?? ''
    }),
  ])
  expect(a).toBe(tenantA)
  expect(b).toBe(tenantB)
  expect(a).not.toBe(b)
})
