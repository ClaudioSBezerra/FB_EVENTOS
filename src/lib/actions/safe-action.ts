// FB_EVENTOS — next-safe-action v8 client chain (Phase 0, Plan 04).
//
// Three layered clients:
//   1. actionClient       — anonymous (anyone can call).
//   2. authedAction       — requires a Better Auth session.
//   3. withTenantAction   — requires session + activeOrganizationId,
//                            wraps the action body in withTenant(tenantId, ...)
//                            so RLS is enforced for every query inside.
//
// IMPORTANT — next-safe-action v8 API (RESEARCH Pitfall 5 — v7-to-v8):
//   - Use `.inputSchema(z.object(...))`, NOT the v7 dot-schema syntax.
//   - Middleware order matters: `authedAction` extends `actionClient`,
//     `withTenantAction` extends `authedAction`. Each middleware can mutate
//     ctx via `next({ ctx: {...} })`.
//
// IMPORTANT — RLS contract:
//   - The action body INSIDE withTenantAction receives a TenantDb (Drizzle
//     transaction handle) via ctx.db. Always use ctx.db for queries — never
//     the singleton db from @/db, which would bypass the transaction-local
//     tenant context.

import { headers as nextHeaders } from 'next/headers'
import { createSafeActionClient } from 'next-safe-action'
import { auth } from '@/auth/server'
import { withTenant } from '@/db/with-tenant'
import { fetchTenantIdForOrg } from '@/lib/tenant'

/**
 * Anonymous safe-action client. Validates inputs via Zod 4 but does not
 * require authentication. Use for public-facing actions only (rare).
 */
export const actionClient = createSafeActionClient({
  handleServerError(e) {
    // Return a uniform error string — never leak stack traces or internal
    // messages to the client. Plan 06 will pipe full errors to Pino + Sentry.
    return e instanceof Error ? e.message : 'Internal error'
  },
})

/**
 * Authenticated safe-action client. Requires a Better Auth session — throws
 * "Unauthorized" otherwise. ctx is extended with { userId, orgId }.
 */
export const authedAction = actionClient.use(async ({ next }) => {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) {
    throw new Error('Unauthorized')
  }
  return next({
    ctx: {
      userId: session.user.id,
      orgId: session.session.activeOrganizationId ?? null,
    },
  })
})

/**
 * Tenant-scoped safe-action client. Requires session + activeOrganizationId.
 * Wraps the action body in withTenant(tenantId, ...) — the action body
 * receives ctx.db (a Drizzle TenantDb transaction handle bound to the
 * tenant's SET LOCAL context).
 *
 * Use this for EVERY Server Action that reads or writes tenant-scoped data.
 */
export const withTenantAction = authedAction.use(async ({ ctx, next }) => {
  if (!ctx.orgId) {
    throw new Error('No active organization')
  }
  const tenantId = await fetchTenantIdForOrg(ctx.orgId)
  if (!tenantId) {
    throw new Error('Active organization has no tenant mapping')
  }
  return withTenant(tenantId, async (db) => {
    return next({
      ctx: {
        ...ctx,
        tenantId,
        db,
      },
    })
  })
})

/**
 * USAGE — IMPORTANT: every action MUST chain `.inputSchema(z.object(...))`
 * (next-safe-action v8 API; v7 dot-schema is REMOVED). Example:
 *
 * ```ts
 * const listOrganizations = withTenantAction
 *   .inputSchema(z.object({}))   // ← .inputSchema, NOT .schema (v7 name)
 *   .action(async ({ ctx }) => {
 *     return ctx.db.select().from(organization)
 *   })
 * ```
 *
 * Phase 1+ domain actions will look like this. We keep the example in
 * comments so the codebase has a structural reference for the API.
 */
