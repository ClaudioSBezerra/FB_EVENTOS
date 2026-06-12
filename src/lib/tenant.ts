// FB_EVENTOS — Tenant slug / reserved-path helpers (Phase 0, Plan 04).
//
// SYSTEM_PREFIXES is the canonical list of reserved first-path-segments that
// MUST NOT be used as tenant slugs. Three layers consume it:
//   1. src/middleware.ts — skips tenant resolution for these paths.
//   2. src/components/auth/signup-form.tsx — client-side org-slug validation.
//   3. Future organization-creation Server Action — server-side rejection.
//
// RESEARCH Pitfall 7: a tenant whose slug = "api" would shadow /api/* routes.
// We block the entire set defensively.

import { eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { tenants } from '@/db/schema/tenants'

export const SYSTEM_PREFIXES = new Set([
  'api',
  '_next',
  'login',
  'signup',
  'verify-email',
  'reset-password',
  'dashboard',
  'health',
  '2fa',
  'admin',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'static',
  'public',
])

export function slugReserved(slug: string): boolean {
  return SYSTEM_PREFIXES.has(slug.toLowerCase())
}

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
 * Look up tenant_id for an organization id. The organization-creation hook
 * (Phase 1+) inserts a tenants row first and stores its id in
 * `organization.tenant_id`. This helper reads it back so safe-action /
 * consent.ts can resolve `orgId → tenantId`.
 *
 * Uses migratorPool so the lookup is not blocked by RLS — `organization` is
 * tenant-scoped, but we need to read tenant_id BEFORE we have a tenant
 * context. The lookup must therefore go through a privileged path. Since
 * Plan 03's two-role model rejects the migrator from the policy too (FORCE
 * RLS), we instead use a raw postgres.js query as a superuser-equivalent:
 * the simplest correct shape is to query the global `tenants` table joined
 * via organization, using `withTenant(orgId-as-tenant-id)`. Phase 0 models
 * `org.id === org.tenant_id` so this lookup is a one-step query through
 * `withTenant` with the org's own id as tenantId.
 *
 * For Phase 0, we keep the model simple: the orgId IS the tenantId.
 * Returns the orgId itself (= tenantId by data-model invariant). When
 * Phase 1+ decouples them, this helper is the single source to update.
 */
export async function fetchTenantIdForOrg(orgId: string): Promise<string | null> {
  // Phase 0 invariant: organization.tenant_id === organization.id at creation.
  // The lookup is therefore degenerate, but we still validate the org exists.
  // We read organization with current_setting bypass — wait, we can't bypass
  // RLS. So we directly query `tenants` via the orgId-as-tenant-id assumption
  // and confirm a tenants row exists.
  const tenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, orgId))
    .limit(1)
  return tenant[0]?.id ?? null
}
