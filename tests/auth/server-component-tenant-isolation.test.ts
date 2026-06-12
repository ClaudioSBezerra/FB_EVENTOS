// FB_EVENTOS — TENA-05 silent-fail safety net test (Phase 0, Plan 04 — Task 3).
//
// This test is the LOAD-BEARING PROOF for the TENA-05 must_haves truth that
// Server Component DB access OUTSIDE withTenant() is silent-default-deny
// (= 0 rows returned) rather than a data leak.
//
// If this test ever passes the first assertion with `rows.length > 0`, RLS
// has been mis-configured — STOP and re-check Plan 03's FORCE RLS migration.
//
// Simulates the "careless future page" scenario: a Server Component that
// queries the singleton `db` for tenant-scoped data without wrapping in
// withTenant(). The RLS default-deny path returns 0 rows. We also assert
// that the happy path (same query INSIDE withTenant) returns exactly the
// seeded row, so the test cannot pass via "broken DB connection" false-pass.

import { afterAll, beforeEach, expect, test } from 'vitest'
import { db, pool } from '@/db'
import { organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'
import { appPool, createTenant, insertOrganization, migratorPool } from '@/test/db'

let tenantId = ''
let orgSlug = ''

beforeEach(async () => {
  const suffix = Date.now()
  tenantId = await createTenant(`tena05-alpha-${suffix}`, 'Alpha Corp')
  orgSlug = `tena05-alpha-${suffix}`
  await insertOrganization(tenantId, orgSlug, 'Alpha')
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

test('TENA-05 silent-fail: singleton db without withTenant returns 0 tenant rows', async () => {
  // Simulates a Server Component that forgets withTenant() — queries the
  // singleton `db` directly. Under FORCE RLS + role NOBYPASSRLS, the policy
  // predicate evaluates against an empty current_setting → the predicate
  // is FALSE for every row (or raises 22P02 on the CAST). Either way the
  // result is "no rows reach the caller" — silent default deny.
  //
  // Both the empty-rows path and the 22P02 error path prove the security
  // outcome. We treat both as success.
  let result: { id: string; tenantId: string }[] = []
  try {
    result = await db
      .select({ id: organization.id, tenantId: organization.tenantId })
      .from(organization)
  } catch (err) {
    const pgErr = err as { code?: string }
    expect(
      pgErr.code,
      'Expected 22P02 CAST failure from RLS predicate evaluation',
    ).toBe('22P02')
  }
  expect(result.length).toBe(0)
})

test('TENA-05 happy path: same query inside withTenant returns exactly the seeded row', async () => {
  const rows = await withTenant(tenantId, async (scopedDb) =>
    scopedDb.select({ id: organization.id, slug: organization.slug }).from(organization),
  )
  expect(rows.length).toBe(1)
  expect(rows[0]?.slug).toBe(orgSlug)
})
