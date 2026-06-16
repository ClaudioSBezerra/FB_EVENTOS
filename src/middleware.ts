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

// Import from the pure-constants module — Edge-runtime safe (no DB imports).
// The DB-bearing helpers (resolveTenantBySlug) live in '@/lib/tenant' which
// pulls in Drizzle; middleware MUST NOT import that path.
import { SYSTEM_PREFIXES } from '@/lib/tenant-prefixes'
// NOTE (Plan 06): Pino is Node-only — it cannot be imported into Edge
// middleware. We deliberately do NOT import @/lib/logger here. Request-id
// log binding happens DOWNSTREAM in Server Components / Server Actions via
// `childLogger({requestId: headers().get('x-request-id')})`. The middleware's
// job is to PROPAGATE the header; consumption happens in the Node runtime.

export function middleware(req: NextRequest): NextResponse {
  // 1. Request ID — preserve inbound or generate a fresh UUID.
  const incomingRequestId = req.headers.get('x-request-id')
  const requestId = incomingRequestId ?? crypto.randomUUID()

  // 2. Tenant slug parsing — first non-empty path segment.
  const { pathname } = req.nextUrl
  const firstSegment = pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''

  const isSystemPath = firstSegment === '' || SYSTEM_PREFIXES.has(firstSegment)
  const tenantSlug = isSystemPath ? null : firstSegment

  // 3. Structured access log — Edge runtime cannot use Pino, but a raw
  //    JSON.stringify on stdout is shape-compatible with the Pino lines
  //    Coolify already ingests from the Server Components / Worker. Lets
  //    operators tail the `web` container and see every hit with method,
  //    path, requestId, tenantSlug, no extra dashboards needed. Internal
  //    Next.js noise (HMR, RSC fetches for prefetch) is filtered.
  if (
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/__nextjs') &&
    pathname !== '/favicon.ico'
  ) {
    console.log(
      JSON.stringify({
        level: 30,
        time: Date.now(),
        service: 'fb-eventos-web',
        msg: 'http_request',
        method: req.method,
        path: pathname,
        requestId,
        tenantSlug: tenantSlug ?? undefined,
      }),
    )
  }

  // 4. Build the response with the headers forwarded to downstream code
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
