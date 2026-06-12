// FB_EVENTOS — RLS Contract Test 3 of 3 (Phase 0, Plan 03 — TENA-01, TENA-02).
//
// The cross-tenant isolation proof. Sets up two tenants (A and B), inserts
// one organization row for each (via the migrator with SET LOCAL so FORCE
// RLS lets the owner write), then asserts:
//
//   1. RLS is `relrowsecurity = true` AND `relforcerowsecurity = true` on
//      the 4 tenant-scoped tables (session, organization, member,
//      invitation). The plan's pg_class assertion target.
//
//   2. DEFAULT-DENY: an appPool query against `organization` WITHOUT
//      withTenant returns 0 rows even though 2 organizations exist. This
//      is the "forgotten withTenant" safety net — RLS predicate is
//      `tenant_id = current_setting(..., true)::uuid`; with no setting,
//      current_setting returns NULL and the predicate is FALSE for every row.
//
//   3. withTenant(tenantA) sees exactly 1 organization (tenant A's).
//
//   4. withTenant(tenantB) sees exactly 1 organization (tenant B's).
//
//   5. withTenant(tenantA) CANNOT see tenantB's organization. Explicit
//      cross-tenant blocking assertion.
//
// If ANY of these fail, the multi-tenant promise of FB_EVENTOS is broken.

import { afterAll, beforeEach, expect, test } from 'vitest'
import { pool } from '../../src/db'
import { organization } from '../../src/db/schema'
import { withTenant } from '../../src/db/with-tenant'
import { appPool, createTenant, insertOrganization, migratorPool } from '../../src/test/db'

let tenantA = ''
let tenantB = ''
let orgA = ''
let orgB = ''

// beforeEach (not beforeAll): the global setup.ts TRUNCATEs the tables in
// afterEach, so each test in this file needs the fixtures re-arranged. The
// alternative — skipping TRUNCATE here — would leak state between this
// file and other test files, breaking the singleFork serialization story.
beforeEach(async () => {
  tenantA = await createTenant(`rls-tenant-a-${Date.now()}`, 'RLS Tenant A')
  tenantB = await createTenant(`rls-tenant-b-${Date.now()}`, 'RLS Tenant B')
  orgA = await insertOrganization(tenantA, `rls-org-a-${Date.now()}`, 'Org A')
  orgB = await insertOrganization(tenantB, `rls-org-b-${Date.now()}`, 'Org B')
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

test('RLS is enabled AND forced on every tenant-scoped table', async () => {
  const rows = await migratorPool<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
     WHERE relname IN ('session', 'organization', 'member', 'invitation')
     ORDER BY relname
  `
  expect(rows.length).toBe(4)
  for (const row of rows) {
    expect(row.relrowsecurity, `${row.relname}: RLS must be enabled`).toBe(true)
    expect(
      row.relforcerowsecurity,
      `${row.relname}: RLS must be FORCED (table owner subject to policy too)`,
    ).toBe(true)
  }
})

test('default-deny: appPool query WITHOUT withTenant cannot reach tenant rows', async () => {
  // appPool (fb_eventos_app role) WITHOUT a withTenant block: the policy
  // predicate is `tenant_id = current_setting('app.current_tenant_id',
  // true)::uuid`. With no setting in the session, current_setting returns
  // an empty string; CAST '' to uuid raises 22P02. Postgres surfaces that
  // as a runtime error AT THE TABLE LEVEL — the query never returns rows.
  //
  // Either outcome (0 rows OR 22P02 error) proves default-deny is enforced.
  // Both block the data from reaching the caller. We assert the SECURITY
  // OUTCOME — "the appPool cannot read tenant rows without withTenant" —
  // rather than the specific Postgres failure mode. The error path is
  // actually the stronger signal: the policy is being EVALUATED, not
  // silently skipped.
  //
  // (We don't sanity-check the row count via migratorPool because under
  // FORCE RLS the migrator role itself is blocked from reading the table —
  // policy targets fb_eventos_app exclusively. The per-tenant assertions
  // below prove both rows exist.)
  let leakedRows: { id: string }[] | null = null
  try {
    leakedRows = await appPool<{ id: string }[]>`SELECT id FROM organization`
  } catch (err) {
    // 22P02 'invalid input syntax for type uuid: ""' is the expected
    // error path: the policy predicate is being evaluated against an
    // empty `current_setting` value. The exception means the policy
    // FIRED — the call did NOT leak rows.
    const pgErr = err as { code?: string }
    expect(pgErr.code, 'Expected 22P02 (CAST failure) from RLS predicate evaluation').toBe('22P02')
    leakedRows = []
  }
  expect(
    leakedRows.length,
    'DEFAULT-DENY VIOLATION: appPool sees rows without withTenant — RLS is not enforced!',
  ).toBe(0)
})

test('withTenant(tenantA) sees exactly 1 organization (tenant A only)', async () => {
  const rows = await withTenant(tenantA, async (db) => {
    return db.select().from(organization)
  })
  expect(rows.length).toBe(1)
  expect(rows[0]?.id).toBe(orgA)
  expect(rows[0]?.tenantId).toBe(tenantA)
})

test('withTenant(tenantB) sees exactly 1 organization (tenant B only)', async () => {
  const rows = await withTenant(tenantB, async (db) => {
    return db.select().from(organization)
  })
  expect(rows.length).toBe(1)
  expect(rows[0]?.id).toBe(orgB)
  expect(rows[0]?.tenantId).toBe(tenantB)
})

test('withTenant(tenantA) cannot read tenantB rows (explicit cross-tenant block)', async () => {
  const rows = await withTenant(tenantA, async (db) => {
    return db.select().from(organization)
  })
  // No row returned for orgB even though orgB exists.
  const ids = rows.map((r) => r.id)
  expect(ids).not.toContain(orgB)
})
