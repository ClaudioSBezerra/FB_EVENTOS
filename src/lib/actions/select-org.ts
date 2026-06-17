// FB_EVENTOS — selectActiveOrg Server Action (2026-06-17 admin-first rework).
//
// Called from /select-org when the user picks one of their orgs. Validates
// the membership cross-tenant via fb_list_user_memberships (security
// definer helper, migration 0023) so we never trust a clicked org_id
// blindly, then flips session.active_organization_id + session.tenant_id
// via the existing setActiveOrganizationForSession helper.
//
// On success the form-level redirect sends the user to /{slug}/dashboard.

'use server'

import { eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { checkSuperAdmin } from '@/auth/super-admin'
import { db } from '@/db'
import { organization } from '@/db/schema/auth'
import { listUserMemberships } from '@/lib/auth/memberships'
import { setActiveOrganizationForSession } from '@/lib/auth/set-active-org'
import { logger } from '@/lib/logger'

const inputSchema = z.object({
  organizationId: z.string().uuid(),
})

export type SelectOrgResult =
  | { ok: true; slug: string }
  | { ok: false; error: 'no_session' | 'not_member' | 'org_not_found' | 'switch_failed' }

/**
 * Flip session.active_organization_id to the requested org.
 *
 * Two paths:
 *   - Regular user → must have a member row for that org (cross-checked
 *     via fb_list_user_memberships SECURITY DEFINER probe).
 *   - Super admin (user.is_super_admin = true) → can enter ANY org even
 *     without a member row. This is the "act as organizadora" path
 *     surfaced by the /admin/organizadoras detail page, and is what lets
 *     a system admin (Fabricia / Claudio) operate any tenant's UI for
 *     support without first adding themselves as members.
 */
export async function selectActiveOrg(raw: unknown): Promise<SelectOrgResult> {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'not_member' }

  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) return { ok: false, error: 'no_session' }

  const { isSuperAdmin } = await checkSuperAdmin()

  // Resolve target org slug. For super admins we read via the singleton
  // db with no GUC — `organization` has RLS, so that read would normally
  // return 0 rows. We bypass by going through the admin SECURITY DEFINER
  // listing helper which is gated server-side. For regular users, we
  // reuse the member-bound listing which provides slug + name.
  let targetSlug: string | null = null

  if (isSuperAdmin) {
    // Admin acts-as path: read slug directly via withTenant of the target
    // org id (orgId === tenantId per Phase 0 invariant). This is the
    // cheapest cross-tenant lookup that respects RLS — we set the GUC
    // for the lookup tx only.
    try {
      const { withTenant } = await import('@/db/with-tenant')
      targetSlug = await withTenant(parsed.data.organizationId, async (scopedDb) => {
        const rows = await scopedDb
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, parsed.data.organizationId))
          .limit(1)
        return rows[0]?.slug ?? null
      })
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          orgId: parsed.data.organizationId,
        },
        'select_active_org_admin_slug_lookup_failed',
      )
      // Fallback: try the singleton db (RLS may return 0 rows but cheap).
      const rows = await db
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, parsed.data.organizationId))
        .limit(1)
      targetSlug = rows[0]?.slug ?? null
    }
    if (!targetSlug) return { ok: false, error: 'org_not_found' }
  } else {
    const memberships = await listUserMemberships(session.user.id)
    const match = memberships.find((m) => m.organizationId === parsed.data.organizationId)
    if (!match) {
      logger.warn(
        { userId: session.user.id, attemptedOrg: parsed.data.organizationId },
        'select_active_org_not_member',
      )
      return { ok: false, error: 'not_member' }
    }
    targetSlug = match.slug
  }

  try {
    const ok = await setActiveOrganizationForSession(session.session.id, parsed.data.organizationId)
    if (!ok) return { ok: false, error: 'switch_failed' }
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        userId: session.user.id,
        orgId: parsed.data.organizationId,
      },
      'select_active_org_switch_failed',
    )
    return { ok: false, error: 'switch_failed' }
  }

  return { ok: true, slug: targetSlug }
}
