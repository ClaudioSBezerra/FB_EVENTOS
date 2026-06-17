// FB_EVENTOS — setActiveOrganization → session.tenant_id wiring
// (Phase 1, Plan 01-01 Task 3).
//
// Phase 0 plan 00-04 SUMMARY documented a gap: `session.tenant_id` is
// nullable at the schema layer because Better Auth creates a session BEFORE
// the user has selected an active organization. Once the user picks an org
// (Better Auth's `setActiveOrganization` endpoint, or the org-creation
// flow that auto-selects the just-created org), the session row's
// `tenant_id` must be updated to match the organization's tenant_id so
// future `withTenant()` calls — which derive the runtime tenant context
// from `session.tenant_id` — resolve to the correct tenant.
//
// IMPLEMENTATION SHAPE:
//   - Better Auth's organization-plugin adapter calls
//     `internalAdapter.updateSession(token, { activeOrganizationId })`
//     whenever the active org changes (set-active endpoint, org create,
//     org delete → null).
//   - We tap into Better Auth's `databaseHooks.session.update.before`
//     hook to intercept ANY session update. When the incoming patch
//     includes `activeOrganizationId`, we look up the organization's
//     `tenantId` via the SECURITY DEFINER PostgreSQL function
//     `public.fb_lookup_tenant_for_org(uuid)` installed in migration
//     0011, and inject `tenantId: <uuid>` (or null on deselect) into
//     the patch.
//
// SECURITY DEFINER RATIONALE:
//   The organization table is RLS-protected (FORCE). When we resolve a
//   tenant_id from an org_id we BY DEFINITION don't have a runtime tenant
//   context yet — we're computing it. The SECURITY DEFINER function runs
//   under the migrator role (the table owner) with row_security = off
//   scoped to the function body. The function takes a single uuid PK and
//   returns the matching tenant_id — the caller already has the org_id
//   (it came from the Better Auth payload), so no NEW data is leaked. See
//   migration 0011 for the GRANT model.

import { pool as appPool } from '@/db'

/**
 * Resolve organizationId → tenantId via the SECURITY DEFINER helper
 * function `public.fb_lookup_tenant_for_org(uuid)` installed in
 * migration 0011. Returns null if the org does not exist.
 */
export async function lookupTenantIdForOrganization(
  organizationId: string,
): Promise<string | null> {
  const rows = await appPool<{ tenant_id: string | null }[]>`
    SELECT fb_lookup_tenant_for_org(${organizationId}::uuid) AS tenant_id
  `
  return rows[0]?.tenant_id ?? null
}

/**
 * Better Auth `databaseHooks.session.update.before` hook factory.
 *
 * If the incoming session patch includes `activeOrganizationId`:
 *   - non-null  → resolve to the org's tenantId and inject `tenantId` into
 *                 the patch alongside `activeOrganizationId`
 *   - null      → inject `tenantId: null` (deselect path — Better Auth
 *                 wipes the active org on org delete or explicit unset)
 *
 * If the patch does NOT include `activeOrganizationId`, the hook is a
 * no-op (return undefined → Better Auth applies the patch as-is).
 */
export function makeSessionUpdateBeforeHook() {
  return async (
    incoming: Record<string, unknown>,
  ): Promise<undefined | { data: Record<string, unknown> }> => {
    if (!Object.hasOwn(incoming, 'activeOrganizationId')) {
      return // no-op — not an active-org change
    }
    const orgId = incoming.activeOrganizationId
    if (orgId === null || orgId === undefined) {
      // Deselect path — wipe tenant_id alongside.
      return { data: { ...incoming, tenantId: null } }
    }
    if (typeof orgId !== 'string') {
      // Defensive — Better Auth gives us uuid strings; anything else is a bug.
      return
    }
    const tenantId = await lookupTenantIdForOrganization(orgId)
    if (!tenantId) {
      // Org row not found (deleted in flight?). Let the update proceed
      // without tenantId; Better Auth will fail downstream on the FK.
      return
    }
    return { data: { ...incoming, tenantId } }
  }
}

/**
 * Direct mutation helper — used by tests and (future) Server Actions that
 * need to flip an active organization for a session WITHOUT going through
 * Better Auth's endpoint. Uses the same SECURITY DEFINER lookup + a
 * normal UPDATE against the session table inside a temporary withTenant-
 * style scope (the session row itself is tenant-scoped).
 *
 * Returns true on success, false if the session row or organization row
 * doesn't exist.
 */
export async function setActiveOrganizationForSession(
  sessionId: string,
  organizationId: string,
): Promise<boolean> {
  // We DELIBERATELY KEEP session.tenant_id = NULL after this UPDATE.
  //
  // The session table's RLS policy is:
  //   tenant_id IS NULL OR tenant_id = NULLIF(current_setting(...), '')::uuid
  //
  // If we set tenant_id = Y, then every subsequent `auth.api.getSession()`
  // call (which reads `session` via the singleton db with NO GUC set)
  // evaluates the policy as `Y = NULL → false`, so getSession returns 0
  // rows and the user appears logged out — exactly the bug reported on
  // 2026-06-17 when Fabricia clicked "Acessar como organizadora" and
  // ended up bounced to /login.
  //
  // Keeping tenant_id NULL means the `IS NULL` branch always permits
  // Better Auth's token-lookup, regardless of the (absent) GUC. All
  // tenant-scoped reads downstream derive context from
  // session.active_organization_id (= tenant.id by Phase 0 invariant),
  // never from session.tenant_id. Mirrors the same decision made in
  // bootstrapOrganization (commit e8f8548) — keep both helpers
  // consistent.
  const rows = await appPool.begin<{ id: string }[]>(async (tx) => {
    // We still set the GUC because the UPDATE itself runs as fb_eventos_app
    // (NOBYPASSRLS) and the policy's USING clause needs SOMETHING to
    // match. With tenant_id IS NULL pre-UPDATE the USING already passes
    // via the IS NULL branch; we set the GUC to the resolved tenantId
    // anyway as belt-and-suspenders in case the session row was somehow
    // touched earlier and tenant_id is already non-NULL.
    const tenantId = await lookupTenantIdForOrganization(organizationId)
    if (tenantId) {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    }
    return tx<{ id: string }[]>`
      UPDATE session
         SET active_organization_id = ${organizationId},
             updated_at             = now()
       WHERE id = ${sessionId}
       RETURNING id
    `
  })
  return rows.length === 1
}

/** Test-only: no-op now (preserved for backwards-compatibility with tests). */
export async function _closeSetActiveOrgPool(): Promise<void> {
  // The lookup now uses the app pool from src/db/index.ts which is closed
  // by individual test files. Kept as no-op so test code keeps compiling.
  return
}
