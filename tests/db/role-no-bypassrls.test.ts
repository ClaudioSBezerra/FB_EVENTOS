// FB_EVENTOS — RLS Contract Test 1 of 3 (Phase 0, Plan 03 — TENA-03).
//
// Asserts that the runtime app role `fb_eventos_app` does NOT have BYPASSRLS.
// This is the single most load-bearing security flag in the multi-tenant
// contract. If this test ever turns red, every other RLS check in the system
// is compromised:
//
//   - Direct app queries against tenant-owned tables would return ALL rows
//     regardless of `app.current_tenant_id`.
//   - The tenant_isolation policies would still be in the catalog but the
//     planner would skip them for this role.
//   - Cross-tenant data leak would be silent — no error, just rows from
//     other tenants in the response.
//
// THIS IS THE ASSERTION THAT MUST NEVER BE WEAKENED. If a future migration
// changes `fb_eventos_app` (e.g., ALTER ROLE ... BYPASSRLS), this test
// catches it on the next CI run.
//
// Read the assertion: `pg_roles.rolbypassrls = false` means the role
// participates in RLS policies (= protected). `rolbypassrls = true` (== bad)
// would mean the role ignores all policies.

import { afterAll, expect, test } from 'vitest'
import { migratorPool } from '../../src/test/db'

afterAll(async () => {
  await migratorPool.end({ timeout: 5 })
})

test('fb_eventos_app role does NOT have BYPASSRLS (TENA-03 contract)', async () => {
  const rows = await migratorPool<{ rolbypassrls: boolean }[]>`
    SELECT rolbypassrls FROM pg_roles WHERE rolname = 'fb_eventos_app'
  `
  expect(rows.length, 'fb_eventos_app role must exist (created by migration 0000)').toBe(1)
  expect(
    rows[0]?.rolbypassrls,
    'CONTRACT VIOLATION: fb_eventos_app has BYPASSRLS — cross-tenant data leak risk. ' +
      'Revert any ALTER ROLE that granted BYPASSRLS to this role.',
  ).toBe(false)
})

test('fb_eventos_migrator role exists with CREATEDB (TENA-04)', async () => {
  const rows = await migratorPool<{ rolcreatedb: boolean; rolsuper: boolean }[]>`
    SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname = 'fb_eventos_migrator'
  `
  expect(rows.length).toBe(1)
  expect(rows[0]?.rolcreatedb, 'migrator must have CREATEDB for drizzle-kit migrate').toBe(true)
  expect(rows[0]?.rolsuper, 'migrator must NOT be superuser').toBe(false)
})
