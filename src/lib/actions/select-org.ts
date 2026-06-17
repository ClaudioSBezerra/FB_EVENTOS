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

import { headers as nextHeaders } from 'next/headers'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { listUserMemberships } from '@/lib/auth/memberships'
import { setActiveOrganizationForSession } from '@/lib/auth/set-active-org'
import { logger } from '@/lib/logger'

const inputSchema = z.object({
  organizationId: z.string().uuid(),
})

export type SelectOrgResult =
  | { ok: true; slug: string }
  | { ok: false; error: 'no_session' | 'not_member' | 'switch_failed' }

export async function selectActiveOrg(raw: unknown): Promise<SelectOrgResult> {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'not_member' }

  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) return { ok: false, error: 'no_session' }

  const memberships = await listUserMemberships(session.user.id)
  const match = memberships.find((m) => m.organizationId === parsed.data.organizationId)
  if (!match) {
    logger.warn(
      { userId: session.user.id, attemptedOrg: parsed.data.organizationId },
      'select_active_org_not_member',
    )
    return { ok: false, error: 'not_member' }
  }

  try {
    const ok = await setActiveOrganizationForSession(session.session.id, match.organizationId)
    if (!ok) return { ok: false, error: 'switch_failed' }
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        userId: session.user.id,
        orgId: match.organizationId,
      },
      'select_active_org_switch_failed',
    )
    return { ok: false, error: 'switch_failed' }
  }

  return { ok: true, slug: match.slug }
}
