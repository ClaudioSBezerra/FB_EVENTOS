"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugReserved = exports.SYSTEM_PREFIXES = void 0;
exports.resolveTenantBySlug = resolveTenantBySlug;
exports.fetchTenantIdForOrg = fetchTenantIdForOrg;
exports.resolveTenantSlug = resolveTenantSlug;
const drizzle_orm_1 = require("drizzle-orm");
const db_1 = require("@/db");
const tenants_1 = require("@/db/schema/tenants");
var tenant_prefixes_1 = require("./tenant-prefixes");
Object.defineProperty(exports, "SYSTEM_PREFIXES", { enumerable: true, get: function () { return tenant_prefixes_1.SYSTEM_PREFIXES; } });
Object.defineProperty(exports, "slugReserved", { enumerable: true, get: function () { return tenant_prefixes_1.slugReserved; } });
const tenant_prefixes_2 = require("./tenant-prefixes");
/**
 * Look up a tenant row by slug. Returns null if the slug is reserved or no
 * matching (non-deleted) tenant exists. Tenants table has NO RLS — this
 * helper is safe to call outside withTenant().
 */
async function resolveTenantBySlug(slug) {
    if ((0, tenant_prefixes_2.slugReserved)(slug))
        return null;
    const rows = await db_1.db
        .select({
        id: tenants_1.tenants.id,
        slug: tenants_1.tenants.slug,
        name: tenants_1.tenants.name,
    })
        .from(tenants_1.tenants)
        .where((0, drizzle_orm_1.sql) `${tenants_1.tenants.slug} = ${slug.toLowerCase()} AND ${tenants_1.tenants.deletedAt} IS NULL`)
        .limit(1);
    return rows[0] ?? null;
}
/**
 * Look up tenant_id for an organization id. Phase 0 invariant:
 * organization.tenant_id === organization.id at creation. We confirm the
 * tenants row exists via the global tenants table.
 */
async function fetchTenantIdForOrg(orgId) {
    const tenant = await db_1.db
        .select({ id: tenants_1.tenants.id })
        .from(tenants_1.tenants)
        .where((0, drizzle_orm_1.eq)(tenants_1.tenants.id, orgId))
        .limit(1);
    return tenant[0]?.id ?? null;
}
/**
 * Look up tenant slug for a tenant_id. Used by Server Actions / job
 * handlers that need the canonical MinIO bucket name (`{slug}-uploads`)
 * but only carry the tenant_id from session/job payload.
 *
 * The `tenants` table has no RLS; this is safe to call outside withTenant().
 */
async function resolveTenantSlug(tenantId) {
    const rows = await db_1.db
        .select({ slug: tenants_1.tenants.slug })
        .from(tenants_1.tenants)
        .where((0, drizzle_orm_1.eq)(tenants_1.tenants.id, tenantId))
        .limit(1);
    const slug = rows[0]?.slug;
    if (!slug)
        throw new Error(`Tenant ${tenantId} not found`);
    return slug;
}
