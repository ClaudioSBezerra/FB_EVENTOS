// FB_EVENTOS — bootstrapOrganization Server Action.
//
// Replaces a direct authClient.organization.create() call. Better Auth's
// own organization endpoint INSERTs into `organization` without populating
// `tenant_id`, but our schema has `organization.tenant_id NOT NULL` with a
// FK to `tenants` — so the native endpoint blows up with a NULL constraint
// violation (HTTP 500, content-length 0) the moment the form submits.
//
// This action performs the three INSERTs in one transaction:
//   1. tenants (global, no RLS) — fresh row, id = newTenantId.
//   2. organization (FORCE RLS) — id = tenantId per the Phase 0 invariant
//      (organization.id === organization.tenantId === tenants.id).
//   3. member (FORCE RLS) — the caller becomes the owner.
//
// Steps 2 and 3 set `app.current_tenant_id = newTenantId` first so the
// FORCE ROW LEVEL SECURITY policies on those tables accept the INSERT
// (`tenant_id = current_setting('app.current_tenant_id')::uuid`).
//
// After the transaction commits we call setActiveOrganizationForSession to
// flip session.activeOrganizationId + session.tenant_id so the next
// request (the dashboard redirect) lands inside the right tenant scope.

'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { headers as nextHeaders } from 'next/headers'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { db } from '@/db'
import { member, organization, session as sessionTable } from '@/db/schema/auth'
import { tenants } from '@/db/schema/tenants'
import { logger } from '@/lib/logger'
import { SYSTEM_PREFIXES } from '@/lib/tenant-prefixes'

// Extract everything postgres.js attaches to a query failure — `message` alone
// loses the actual server response (code, detail, hint, position). Without
// this we get "Failed query: ..." in the log and have no idea WHY.
function extractDbError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { err: String(err) }
  const out: Record<string, unknown> = { err: err.message }
  const e = err as Error & {
    code?: string
    detail?: string
    hint?: string
    schema_name?: string
    table_name?: string
    constraint_name?: string
    cause?: unknown
  }
  if (e.code) out.code = e.code
  if (e.detail) out.detail = e.detail
  if (e.hint) out.hint = e.hint
  if (e.schema_name) out.schema = e.schema_name
  if (e.table_name) out.table = e.table_name
  if (e.constraint_name) out.constraint = e.constraint_name
  if (e.cause instanceof Error) out.cause = e.cause.message
  return out
}

const slugRegex = /^[a-z][a-z0-9-]{2,30}$/

const inputSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .regex(slugRegex)
    .refine((s) => !SYSTEM_PREFIXES.has(s), 'reserved'),
})

export type BootstrapOrgInput = z.infer<typeof inputSchema>
export type BootstrapOrgResult =
  | { ok: true; slug: string }
  | {
      ok: false
      error: 'invalid_input' | 'no_session' | 'already_has_org' | 'slug_taken' | 'create_failed'
    }

export async function bootstrapOrganization(raw: unknown): Promise<BootstrapOrgResult> {
  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' }
  }

  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) {
    return { ok: false, error: 'no_session' }
  }
  if (session.session.activeOrganizationId) {
    return { ok: false, error: 'already_has_org' }
  }

  const userId = session.user.id
  const newTenantId = crypto.randomUUID()

  try {
    await db.transaction(async (tx) => {
      // 1. tenants — global, no RLS, plain INSERT.
      await tx.insert(tenants).values({
        id: newTenantId,
        name: parsed.data.name,
        slug: parsed.data.slug,
      })

      // 2. Establish the tenant context so the FORCE RLS policies on
      // organization + member + session accept the writes. `true` 3rd arg
      // makes the setting transaction-local; vanishes on COMMIT/ROLLBACK.
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${newTenantId}::text, true)`)

      // 3. organization — id matches tenantId per Phase 0 invariant so
      // downstream code that reads activeOrganizationId can resolve the
      // tenantId via either column without a lookup.
      await tx.insert(organization).values({
        id: newTenantId,
        tenantId: newTenantId,
        name: parsed.data.name,
        slug: parsed.data.slug,
      })

      // 4. member — caller becomes the owner.
      await tx.insert(member).values({
        tenantId: newTenantId,
        organizationId: newTenantId,
        userId,
        role: 'owner',
      })

      // 5. Flip session.activeOrganizationId — DELIBERATELY KEEPING
      //    session.tenant_id = NULL. Policy matches every getSession()
      //    via the `IS NULL` branch regardless of setting (Better Auth
      //    cookie-token lookup, no tenant scope yet). Downstream tenant
      //    reads use session.activeOrganizationId (= tenant.id) as input
      //    to withTenant().
      //
      //    WHY INSIDE THE TX (and not via auth.api.setActiveOrganization
      //    or a separate UPDATE):
      //      - auth.api.setActiveOrganization SELECTs `member` from the
      //        singleton db adapter (no GUC) → RLS default-deny → "user
      //        is not a member" → 500.
      //      - A separate UPDATE on the singleton db has no GUC, so the
      //        session policy's `current_setting('app.current_tenant_id',
      //        true)::uuid` cast hits 22P02 on empty-string when planner
      //        hoists the expression. Migration 0021 added NULLIF guard,
      //        but doing the UPDATE here makes the GUC explicit and
      //        survives even if a future regression reverts the NULLIF.
      const updated = await tx
        .update(sessionTable)
        .set({
          activeOrganizationId: newTenantId,
          updatedAt: new Date(),
        })
        .where(eq(sessionTable.id, session.session.id))
        .returning({ id: sessionTable.id })
      if (updated.length !== 1) {
        // Force the whole transaction to roll back — we will NOT leave a
        // dangling tenants/organization/member triple if the session row
        // can't be flipped.
        throw new Error(`session_update_zero_rows:${session.session.id}`)
      }
    })
  } catch (err) {
    const detail = extractDbError(err)
    logger.error(
      { ...detail, userId, slug: parsed.data.slug, sessionId: session.session.id },
      'bootstrap_org_tx_failed',
    )
    // postgres.js puts the unique-constraint phrasing in `cause`, not `message`
    // (Drizzle wraps the actual server error). Inspect both — and also the
    // postgres SQLSTATE code 23505 (unique_violation) which is the most
    // reliable signal.
    const msgParts = [detail.err, detail.cause, detail.detail, detail.code]
      .filter((p): p is string => typeof p === 'string')
      .join(' | ')
    if (detail.code === '23505' || /unique|duplicate|already exists/i.test(msgParts)) {
      return { ok: false, error: 'slug_taken' }
    }
    return { ok: false, error: 'create_failed' }
  }

  // 6. Bust the Server Component cache for routes that depend on the
  //    session so the redirect lands on a freshly-rendered dashboard.
  revalidatePath('/', 'layout')

  return { ok: true, slug: parsed.data.slug }
}
