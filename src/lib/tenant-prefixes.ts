// FB_EVENTOS — Reserved tenant slug prefixes (Phase 0, Plan 04).
//
// Pure constants — NO database imports. Safe to import from:
//   - src/middleware.ts (Edge runtime)
//   - client components (signup-form.tsx etc.)
//   - server components, Server Actions
//
// The DB-bearing helpers (resolveTenantBySlug, fetchTenantIdForOrg) live in
// src/lib/tenant.ts which re-exports these. Client/Edge code MUST import
// from this file, not from '@/lib/tenant'.

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
