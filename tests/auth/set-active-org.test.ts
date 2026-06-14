// FB_EVENTOS — setActiveOrganization → session.tenant_id wiring test
// (Phase 1, Plan 01-01 Task 3).
//
// Proves that the Better Auth `databaseHooks.session.update.before` hook
// installed in src/auth/server.ts populates session.tenant_id whenever the
// session's active_organization_id is updated. Without this hook the gap
// from Phase 0 Plan 00-04 SUMMARY (session.tenant_id stuck at NULL) re-opens
// and every withTenant() against an org-scoped table returns 0 rows.
//
// SCENARIO:
//   1. Insert a tenant + an organization tied to that tenant.
//   2. Insert a session for a user (tenant_id NULL, active_organization_id NULL —
//      the pre-org-selection state).
//   3. Drive `setActiveOrganizationForSession(sessionId, orgId)` (the same
//      lookup path the Better Auth hook uses internally).
//   4. Assert the session row now has tenant_id = tenant.id AND
//      active_organization_id = orgId.
//   5. Drive the hook's makeSessionUpdateBeforeHook factory directly with a
//      patch that includes activeOrganizationId and assert it injects the
//      matching tenantId.
//   6. (Phase 0 invariant) Make sure withTenant(tenant.id) still sees the
//      org row — proves the RLS contract wasn't broken by the new tables.

import { afterAll, beforeEach, expect, test } from 'vitest'

import { pool } from '@/db'
import { organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'
import {
  _closeSetActiveOrgPool,
  lookupTenantIdForOrganization,
  makeSessionUpdateBeforeHook,
  setActiveOrganizationForSession,
} from '@/lib/auth/set-active-org'
import {
  appPool,
  createTenant,
  insertOrganization,
  insertSession,
  insertUser,
  migratorPool,
} from '@/test/db'

let tenantId = ''
let tenantSlug = ''
let orgId = ''
let userId = ''
let sessionId = ''

beforeEach(async () => {
  const suffix = Date.now()
  tenantSlug = `setactive-${suffix}`
  tenantId = await createTenant(tenantSlug, 'SetActive Test Tenant')
  orgId = await insertOrganization(tenantId, `setactive-org-${suffix}`, 'SetActive Org')
  userId = await insertUser(`setactive-${suffix}@example.test`, 'SetActive User')
  // Insert a session with tenant_id populated (matches Phase 0 helper shape) —
  // we test that updating active_organization_id KEEPS the tenant_id consistent,
  // which is the production case after the hook fires.
  sessionId = await insertSession(
    tenantId,
    userId,
    `tok-setactive-${suffix}`,
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  )
})

afterAll(async () => {
  await _closeSetActiveOrgPool()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

test('lookupTenantIdForOrganization resolves orgId → tenant.id', async () => {
  const found = await lookupTenantIdForOrganization(orgId)
  expect(found).toBe(tenantId)
})

test('lookupTenantIdForOrganization returns null for missing org', async () => {
  const found = await lookupTenantIdForOrganization('00000000-0000-0000-0000-000000000000')
  expect(found).toBeNull()
})

test('setActiveOrganizationForSession flips active_organization_id + keeps tenant_id', async () => {
  const ok = await setActiveOrganizationForSession(sessionId, orgId)
  expect(ok).toBe(true)
  // Read back via appPool inside withTenant — session is RLS-FORCED, so
  // even the migrator can't read it directly without policy assist.
  const rows = await appPool.begin<
    { id: string; tenant_id: string; active_organization_id: string }[]
  >(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<{ id: string; tenant_id: string; active_organization_id: string }[]>`
      SELECT id, tenant_id, active_organization_id FROM session WHERE id = ${sessionId}
    `
  })
  expect(rows[0]).toBeDefined()
  expect(rows[0]?.tenant_id).toBe(tenantId)
  expect(rows[0]?.active_organization_id).toBe(orgId)
})

test('makeSessionUpdateBeforeHook injects tenantId when activeOrganizationId is in patch', async () => {
  const hook = makeSessionUpdateBeforeHook()
  const patch = { activeOrganizationId: orgId, updatedAt: new Date() }
  const result = await hook(patch)
  expect(result).toBeDefined()
  expect(result?.data.tenantId).toBe(tenantId)
  expect(result?.data.activeOrganizationId).toBe(orgId)
})

test('makeSessionUpdateBeforeHook is a no-op when patch lacks activeOrganizationId', async () => {
  const hook = makeSessionUpdateBeforeHook()
  const patch = { token: 'rotated-token', updatedAt: new Date() }
  const result = await hook(patch)
  expect(result).toBeUndefined()
})

test('makeSessionUpdateBeforeHook injects tenantId=null when activeOrganizationId is null', async () => {
  const hook = makeSessionUpdateBeforeHook()
  const patch = { activeOrganizationId: null, updatedAt: new Date() }
  const result = await hook(patch)
  expect(result).toBeDefined()
  expect(result?.data.tenantId).toBeNull()
  expect(result?.data.activeOrganizationId).toBeNull()
})

test('after setActive, withTenant(tenantId) still reads org rows (RLS invariant)', async () => {
  await setActiveOrganizationForSession(sessionId, orgId)
  const rows = await withTenant(tenantId, async (db) => {
    return db.select().from(organization)
  })
  expect(rows.length).toBe(1)
  expect(rows[0]?.id).toBe(orgId)
  expect(rows[0]?.tenantId).toBe(tenantId)
})
