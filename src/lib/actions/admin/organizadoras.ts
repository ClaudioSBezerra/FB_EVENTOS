// FB_EVENTOS — Admin actions for organizadoras (2026-06-17 admin-first rework).
//
// All actions gated by requireSuperAdmin(). Cross-tenant writes use the
// transaction-local set_config('app.current_tenant_id', ...) pattern
// established by bootstrapOrganization.

'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { requireSuperAdmin } from '@/auth/super-admin'
import { db } from '@/db'
import { member, organization, user as userTable } from '@/db/schema/auth'
import { tenants } from '@/db/schema/tenants'
import { logger } from '@/lib/logger'
import { SYSTEM_PREFIXES } from '@/lib/tenant-prefixes'

const slugRegex = /^[a-z][a-z0-9-]{2,30}$/

// ────────────────────────────────────────────────────────────────────
// createOrganizadora — wizard: cria tenant + organization + admin user + member
// ────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  orgName: z.string().min(2).max(120),
  orgSlug: z
    .string()
    .regex(slugRegex)
    .refine((s) => !SYSTEM_PREFIXES.has(s), 'reserved'),
  adminName: z.string().min(2).max(120),
  adminEmail: z.email(),
  adminPassword: z.string().min(12).max(200),
})

export type CreateOrganizadoraResult =
  | { ok: true; orgId: string; slug: string; userId: string }
  | {
      ok: false
      error: 'invalid_input' | 'slug_taken' | 'email_taken' | 'create_failed'
    }

export async function createOrganizadora(raw: unknown): Promise<CreateOrganizadoraResult> {
  await requireSuperAdmin()

  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const { orgName, orgSlug, adminName, adminEmail, adminPassword } = parsed.data
  const newTenantId = crypto.randomUUID()

  // 1. Create the user via Better Auth so password hashing + email
  // uniqueness checks are handled by the auth subsystem. We mark
  // emailVerified=true server-side after success because this is an
  // admin-provisioned account (the admin trusts the email).
  let newUserId: string
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: adminEmail,
        password: adminPassword,
        name: adminName,
        // additionalFields (LGPD consent — required by schema)
        consentVersion: '2026-06-01',
        consentAt: new Date(),
      },
    })
    newUserId = result.user.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err: msg, adminEmail }, 'admin_create_org_signup_failed')
    if (/already exists|unique|duplicate/i.test(msg)) {
      return { ok: false, error: 'email_taken' }
    }
    return { ok: false, error: 'create_failed' }
  }

  // 2. Mark the admin-created user verified (skip email loop).
  try {
    await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, newUserId))
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), newUserId },
      'admin_create_org_verify_failed',
    )
    // Not fatal — proceed with org creation.
  }

  // 3. Create tenant + organization + member in one tx with GUC set.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id: newTenantId,
        name: orgName,
        slug: orgSlug,
      })
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${newTenantId}::text, true)`)
      await tx.insert(organization).values({
        id: newTenantId,
        tenantId: newTenantId,
        name: orgName,
        slug: orgSlug,
      })
      await tx.insert(member).values({
        tenantId: newTenantId,
        organizationId: newTenantId,
        userId: newUserId,
        role: 'owner',
      })
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
    const combined = `${msg} ${cause}`
    logger.error({ err: msg, cause, orgSlug, newTenantId }, 'admin_create_org_tx_failed')
    if (/unique|duplicate|already exists/i.test(combined)) {
      return { ok: false, error: 'slug_taken' }
    }
    return { ok: false, error: 'create_failed' }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/organizadoras')

  return { ok: true, orgId: newTenantId, slug: orgSlug, userId: newUserId }
}

// ────────────────────────────────────────────────────────────────────
// updateOrganizadora — rename only (slug change is intentionally NOT
//   supported — it would require URL migration + cache invalidation
//   across the whole product surface).
// ────────────────────────────────────────────────────────────────────

const updateSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(2).max(120),
})

export type UpdateOrganizadoraResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'update_failed' }

export async function updateOrganizadora(raw: unknown): Promise<UpdateOrganizadoraResult> {
  await requireSuperAdmin()
  const parsed = updateSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${parsed.data.orgId}::text, true)`,
      )
      const orgRes = await tx
        .update(organization)
        .set({ name: parsed.data.name })
        .where(eq(organization.id, parsed.data.orgId))
        .returning({ id: organization.id })
      if (orgRes.length === 0) throw new Error('not_found')
      await tx
        .update(tenants)
        .set({ name: parsed.data.name })
        .where(eq(tenants.id, parsed.data.orgId))
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'not_found') return { ok: false, error: 'not_found' }
    logger.error({ err: msg, orgId: parsed.data.orgId }, 'admin_update_org_failed')
    return { ok: false, error: 'update_failed' }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/organizadoras')
  revalidatePath(`/admin/organizadoras/${parsed.data.orgId}`)
  return { ok: true }
}
