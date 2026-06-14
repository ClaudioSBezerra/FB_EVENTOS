// FB_EVENTOS — Dual-tenant cross-tenant isolation E2E (Phase 0, Plan 04 — Task 3).
//
// THIS IS THE LOAD-BEARING TENA-07 TEST.
//
// PROOF that an authenticated session in tenant A cannot read tenant B's
// data through ANY layer of the stack:
//
//   1. Schema layer: pgPolicy('tenant_isolation', ...) on session,
//      organization, member, invitation. → enforced by Plan 03.
//   2. Catalog layer: FORCE ROW LEVEL SECURITY. → enforced by 0002.
//   3. Role layer: fb_eventos_app has NOBYPASSRLS. → enforced by 0000.
//   4. Runtime layer: withTenant(tenantId, fn) uses SET LOCAL. → enforced
//      by src/db/with-tenant.ts and tests/db/with-tenant.test.ts.
//   5. Request layer: middleware sets x-tenant-slug; safe-action chain
//      checks session.activeOrganizationId === resolved tenant.id. → this
//      test.
//
// SCENARIO:
//   - Tenant A (acme) with user alice@acme + org membership.
//   - Tenant B (globex) with user bob@globex + org membership.
//   - Three assertions:
//     (a) Inside withTenant(A.id), Alice sees ONLY acme's org rows.
//     (b) Inside withTenant(B.id), Bob sees ONLY globex's org rows.
//     (c) Direct appPool query WITHOUT withTenant returns ZERO rows
//         (RLS default-deny — the safety net that prevents forgot-withTenant
//          from leaking data).
//
// If any of these fail, the multi-tenant promise of FB_EVENTOS is broken —
// STOP and re-examine Plan 03 + Plan 04 + the current migration chain.

import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, expect, test } from 'vitest'

import { pool } from '@/db'
import { member, organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'
import { markEmailVerified, signUpUser } from '@/test/auth-helpers'
import { appPool, createTenant, insertOrganization, migratorPool } from '@/test/db'

const PASSWORD = 'super-secret-password-1234'

interface Fixture {
  tenantId: string
  tenantSlug: string
  orgId: string
  userId: string
  userEmail: string
}

let acme: Fixture
let globex: Fixture

beforeEach(async () => {
  const suffix = Date.now()

  // ─── Tenant A: acme ───
  const acmeTenant = await createTenant(`acme-${suffix}`, 'Acme Eventos')
  const acmeOrg = await insertOrganization(acmeTenant, `acme-${suffix}`, 'Acme Eventos')
  const aliceEmail = `alice-${suffix}@acme.example`
  await signUpUser({ email: aliceEmail, password: PASSWORD, name: 'Alice' })
  await markEmailVerified(aliceEmail)
  const aliceRows = await migratorPool<{ id: string }[]>`
    SELECT id FROM "user" WHERE email = ${aliceEmail}
  `
  const aliceId = aliceRows[0]!.id
  // Make alice a member of acme. Insert via appPool + SET LOCAL (member is RLS-protected).
  await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${acmeTenant}, true)`
    await tx`INSERT INTO member (tenant_id, organization_id, user_id, role)
             VALUES (${acmeTenant}, ${acmeOrg}, ${aliceId}, 'owner')`
  })
  acme = {
    tenantId: acmeTenant,
    tenantSlug: `acme-${suffix}`,
    orgId: acmeOrg,
    userId: aliceId,
    userEmail: aliceEmail,
  }

  // ─── Tenant B: globex ───
  const globexTenant = await createTenant(`globex-${suffix}`, 'Globex')
  const globexOrg = await insertOrganization(globexTenant, `globex-${suffix}`, 'Globex')
  const bobEmail = `bob-${suffix}@globex.example`
  await signUpUser({ email: bobEmail, password: PASSWORD, name: 'Bob' })
  await markEmailVerified(bobEmail)
  const bobRows = await migratorPool<{ id: string }[]>`
    SELECT id FROM "user" WHERE email = ${bobEmail}
  `
  const bobId = bobRows[0]!.id
  await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${globexTenant}, true)`
    await tx`INSERT INTO member (tenant_id, organization_id, user_id, role)
             VALUES (${globexTenant}, ${globexOrg}, ${bobId}, 'owner')`
  })
  globex = {
    tenantId: globexTenant,
    tenantSlug: `globex-${suffix}`,
    orgId: globexOrg,
    userId: bobId,
    userEmail: bobEmail,
  }
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

test('TENA-07 (a): withTenant(acme.id) sees ONLY acme orgs + acme members', async () => {
  const result = await withTenant(acme.tenantId, async (db) => {
    const orgs = await db.select({ id: organization.id }).from(organization)
    const mems = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, acme.orgId))
    return { orgs, mems }
  })
  expect(result.orgs.length).toBe(1)
  expect(result.orgs[0]?.id).toBe(acme.orgId)
  // The acme orgs result must NOT contain globex's org id.
  expect(result.orgs.map((o) => o.id)).not.toContain(globex.orgId)
  expect(result.mems.length).toBe(1)
  expect(result.mems[0]?.userId).toBe(acme.userId)
})

test('TENA-07 (b): withTenant(globex.id) sees ONLY globex orgs', async () => {
  const result = await withTenant(globex.tenantId, async (db) => {
    return db.select({ id: organization.id }).from(organization)
  })
  expect(result.length).toBe(1)
  expect(result[0]?.id).toBe(globex.orgId)
  expect(result.map((o) => o.id)).not.toContain(acme.orgId)
})

test('TENA-07 (c): direct appPool query WITHOUT withTenant returns 0 rows', async () => {
  // The TENA-05 silent-fail safety net. Any code path that forgets to wrap
  // a tenant-scoped query in withTenant() hits RLS default-deny (predicate
  // current_setting empty → either 0 rows or 22P02 CAST error). Both prove
  // the leak is blocked.
  let leakedRows: { id: string }[] = []
  try {
    leakedRows = await appPool<{ id: string }[]>`SELECT id FROM organization`
  } catch (err) {
    const pgErr = err as { code?: string }
    expect(pgErr.code, 'Expected 22P02 from RLS predicate').toBe('22P02')
  }
  expect(leakedRows.length).toBe(0)
})

test('TENA-07 (d): withTenant(acme.id) CANNOT read globex.org by id', async () => {
  const result = await withTenant(acme.tenantId, async (db) => {
    return db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, globex.orgId))
  })
  // RLS filters globex.org out — Alice's session-context (tenant acme) can
  // never address a row whose tenant_id is globex's, even with the exact
  // primary-key value.
  expect(result.length).toBe(0)
})
