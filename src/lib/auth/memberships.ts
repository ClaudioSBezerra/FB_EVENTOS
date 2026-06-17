// FB_EVENTOS — Cross-tenant memberships lookup (migration 0023).
//
// Wraps the SECURITY DEFINER function fb_list_user_memberships(uuid) so
// callers get a typed array instead of raw rows. Used by:
//   - src/app/page.tsx (root state router)
//   - src/app/select-org/page.tsx
//   - src/app/admin/usuarios/[userId]/page.tsx (show user's memberships)

import { pool } from '@/db'

export interface UserMembership {
  memberId: string
  organizationId: string
  tenantId: string
  slug: string
  name: string
  role: string
}

export async function listUserMemberships(userId: string): Promise<UserMembership[]> {
  const rows = await pool<
    {
      member_id: string
      organization_id: string
      tenant_id: string
      slug: string
      name: string
      role: string
    }[]
  >`
    SELECT member_id, organization_id, tenant_id, slug, name, role
      FROM fb_list_user_memberships(${userId}::uuid)
  `
  return rows.map((r) => ({
    memberId: r.member_id,
    organizationId: r.organization_id,
    tenantId: r.tenant_id,
    slug: r.slug,
    name: r.name,
    role: r.role,
  }))
}
