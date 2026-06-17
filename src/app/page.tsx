// FB_EVENTOS — Root route (2026-06-17 admin-first rework).
//
// Previously: landing page comercial. After the architecture switch (login-
// first, super-admin-driven org provisioning), root is a PURE STATE ROUTER:
//
//   anon                  → /login
//   super_admin           → /admin
//   member of 1 org       → /{slug}/dashboard
//   member of n orgs      → /select-org
//   logged in, 0 orgs     → /no-access
//
// Notes:
//   - The legacy `auto-select activeOrgId` fast path is preserved: if the
//     session row already has an active org, we resolve its slug via
//     withTenant() and redirect. If the activeOrgId is stale (org deleted),
//     we fall through to the memberships probe.
//   - The landing page comercial is preserved in git history (1971811,
//     d21f864, c802fbf) — future operator decision whether to mount it at
//     /sobre or /pricing.

import { eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { checkSuperAdmin } from '@/auth/super-admin'
import { organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'
import { listUserMemberships } from '@/lib/auth/memberships'
import { setActiveOrganizationForSession } from '@/lib/auth/set-active-org'

export default async function Home() {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })

  if (!session) redirect('/login')

  // Super admins always land in the admin console first.
  const { isSuperAdmin } = await checkSuperAdmin()
  if (isSuperAdmin) redirect('/admin')

  // Fast path: session already pinned to an active org → resolve slug.
  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId) {
    const slug = await withTenant(activeOrgId, async (scopedDb) => {
      const rows = await scopedDb
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, activeOrgId))
        .limit(1)
      return rows[0]?.slug ?? null
    }).catch(() => null)
    if (slug) redirect(`/${slug}/dashboard`)
    // Stale activeOrgId — fall through.
  }

  // No (live) active org → look up memberships via SECURITY DEFINER helper.
  const memberships = await listUserMemberships(session.user.id)

  if (memberships.length === 0) redirect('/no-access')
  if (memberships.length === 1) {
    // Single membership: flip session.active_organization_id BEFORE
    // redirecting. Without this, the dashboard's activeOrgId !== tenant.id
    // guard 403s (the freshly-logged-in user has session.active_org = NULL).
    // setActiveOrganizationForSession also sets session.tenant_id so
    // downstream withTenant() calls have a non-NULL fallback. Best-effort:
    // if the UPDATE fails (rare; RLS regression, FK error), we still
    // redirect — the dashboard will 403 with a clear message instead of
    // looping back here.
    const m = memberships[0]!
    await setActiveOrganizationForSession(session.session.id, m.organizationId).catch(() => null)
    redirect(`/${m.slug}/dashboard`)
  }
  redirect('/select-org')
}
