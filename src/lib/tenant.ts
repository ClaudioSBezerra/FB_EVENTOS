// FB_EVENTOS — Tenant slug / reserved-path helpers (Phase 0, Plan 04).
//
// This module re-exports SYSTEM_PREFIXES + slugReserved from the pure
// constants file (src/lib/tenant-prefixes.ts) AND adds DB-bearing helpers
// (resolveTenantBySlug, fetchTenantIdForOrg) that depend on the Drizzle
// singleton `db`. Client components MUST import the constants from
// '@/lib/tenant-prefixes' to avoid pulling postgres.js into the client
// bundle.
//
// Three layers consume the constants:
//   1. src/middleware.ts — skips tenant resolution for these paths.
//   2. src/components/auth/signup-form.tsx — client-side org-slug validation
//      (uses tenant-prefixes.ts directly).
//   3. Future organization-creation Server Action — server-side rejection.
//
// RESEARCH Pitfall 7: a tenant whose slug = "api" would shadow /api/* routes.
// We block the entire set defensively.

import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { tenants } from '@/db/schema/tenants'

export { SYSTEM_PREFIXES, slugReserved } from './tenant-prefixes'

import { slugReserved } from './tenant-prefixes'

export interface ResolvedTenant {
  id: string
  slug: string
  name: string
}

/**
 * Look up a tenant row by slug. Returns null if the slug is reserved or no
 * matching (non-deleted) tenant exists. Tenants table has NO RLS — this
 * helper is safe to call outside withTenant().
 */
export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  if (slugReserved(slug)) return null
  const rows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
    })
    .from(tenants)
    .where(sql`${tenants.slug} = ${slug.toLowerCase()} AND ${tenants.deletedAt} IS NULL`)
    .limit(1)
  return rows[0] ?? null
}

/**
 * Look up tenant_id for an organization id. Phase 0 invariant:
 * organization.tenant_id === organization.id at creation. We confirm the
 * tenants row exists via the global tenants table.
 */
export async function fetchTenantIdForOrg(orgId: string): Promise<string | null> {
  const tenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, orgId))
    .limit(1)
  return tenant[0]?.id ?? null
}
