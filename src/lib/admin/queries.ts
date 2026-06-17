// FB_EVENTOS — Admin-only DB queries (2026-06-17 admin-first rework).
//
// Thin TS wrappers over the SECURITY DEFINER helpers in migration 0024.
// All callers MUST gate via requireSuperAdmin() before invoking — these
// functions return cross-tenant data and have no internal authz.

import { pool } from '@/db'

export interface AdminOrgRow {
  id: string
  tenantId: string
  slug: string
  name: string
  createdAt: Date
  countMembers: number
  countEvents: number
}

export interface AdminUserRow {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  isSuperAdmin: boolean
  createdAt: Date
  countMemberships: number
}

export async function adminListOrganizations(): Promise<AdminOrgRow[]> {
  const rows = await pool<
    {
      id: string
      tenant_id: string
      slug: string
      name: string
      created_at: Date
      count_members: string | number
      count_events: string | number
    }[]
  >`SELECT * FROM fb_admin_list_organizations()`
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    name: r.name,
    createdAt: new Date(r.created_at),
    countMembers: Number(r.count_members),
    countEvents: Number(r.count_events),
  }))
}

export async function adminListUsers(): Promise<AdminUserRow[]> {
  const rows = await pool<
    {
      id: string
      email: string
      name: string | null
      email_verified: boolean
      is_super_admin: boolean
      created_at: Date
      count_memberships: string | number
    }[]
  >`SELECT * FROM fb_admin_list_users()`
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    emailVerified: r.email_verified,
    isSuperAdmin: r.is_super_admin,
    createdAt: new Date(r.created_at),
    countMemberships: Number(r.count_memberships),
  }))
}
