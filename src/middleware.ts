// FB_EVENTOS — Path-based tenant slug + request-id middleware (Phase 0, Plan 04).
//
// ─────────────────────────────────────────────────────────────────────────
// TENA-05 wiring — IMPORTANT distinction (do not collapse the two layers):
// ─────────────────────────────────────────────────────────────────────────
//
// This middleware runs on the **Edge runtime** and has NO database connection.
// Its responsibilities are limited to:
//   1. Parse the first URL path segment.
//   2. Validate against SYSTEM_PREFIXES (src/lib/tenant.ts) — system paths
//      like /api, /login, /signup are NOT treated as tenant slugs.
//   3. Inject `x-tenant-slug: <slug>` header on tenant-routed requests.
//   4. Inject `x-request-id` (preserve incoming or generate via
//      crypto.randomUUID()) for log correlation (Plan 06 Pino bindings).
//
// THIS MIDDLEWARE DOES NOT ISSUE `SET LOCAL app.current_tenant_id`.
// That GUC is set EXCLUSIVELY inside `withTenant()` (src/db/with-tenant.ts,
// Plan 03), called from:
//   - `withTenantAction` (src/lib/actions/safe-action.ts) for Server Actions
//   - Server Components / Route Handlers reading tenant data
//     (e.g. src/app/[slug]/dashboard/page.tsx)
//
// A Server Component that bypasses withTenant() and queries the singleton
// `db` reads ZERO tenant-scoped rows (RLS default-deny — proven by
// tests/auth/server-component-tenant-isolation.test.ts). This is the silent-
// fail safety net the TENA-05 contract is built on.
//
// ─────────────────────────────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server'

// Inline SYSTEM_PREFIXES because the Edge runtime cannot import modules
// that pull in `postgres.js` / Drizzle. The canonical list lives in
// src/lib/tenant.ts and IS the source of truth for Server Components and
// Server Actions. We duplicate the literal here to keep middleware on Edge.
// CI gate (check-system-prefixes) ensures the two stay in sync.
const SYSTEM_PREFIXES_EDGE = new Set([
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

export function middleware(req: NextRequest): NextResponse {
  // 1. Request ID — preserve inbound or generate a fresh UUID.
  const incomingRequestId = req.headers.get('x-request-id')
  const requestId = incomingRequestId ?? crypto.randomUUID()

  // 2. Tenant slug parsing — first non-empty path segment.
  const { pathname } = req.nextUrl
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''

  const isSystemPath = firstSegment === '' || SYSTEM_PREFIXES_EDGE.has(firstSegment)
  const tenantSlug = isSystemPath ? null : firstSegment

  // 3. Build the response with the headers forwarded to downstream code
  //    (Server Components, Server Actions, Route Handlers) via the request
  //    object AND echoed back on the response for client/log correlation.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-request-id', requestId)
  if (tenantSlug) {
    requestHeaders.set('x-tenant-slug', tenantSlug)
  } else {
    requestHeaders.delete('x-tenant-slug')
  }

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  res.headers.set('x-request-id', requestId)
  if (tenantSlug) {
    res.headers.set('x-tenant-slug', tenantSlug)
  }
  return res
}

// Match every request except Next.js internals and static assets. The
// matcher is intentionally broad so /api/* requests still get x-request-id
// for log correlation (no tenant slug on those — handled inside).
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt (root assets)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
}
