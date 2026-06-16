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

import { sql } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { db } from '@/db'
import { member, organization } from '@/db/schema/auth'
import { tenants } from '@/db/schema/tenants'
import { setActiveOrganizationForSession } from '@/lib/auth/set-active-org'
import { SYSTEM_PREFIXES } from '@/lib/tenant-prefixes'

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
  const sessionId = session.session.id
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
      // organization + member accept the INSERTs. The `true` third arg to
      // set_config makes it transaction-local; commits at COMMIT and
      // vanishes on ROLLBACK.
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
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/unique|duplicate|already exists/i.test(msg)) {
      return { ok: false, error: 'slug_taken' }
    }
    return { ok: false, error: 'create_failed' }
  }

  // 5. Flip session.activeOrganizationId + session.tenant_id so the next
  // request resolves to the new tenant scope.
  const flipped = await setActiveOrganizationForSession(sessionId, newTenantId)
  if (!flipped) {
    return { ok: false, error: 'create_failed' }
  }

  return { ok: true, slug: parsed.data.slug }
}
