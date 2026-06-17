// FB_EVENTOS — Admin actions for usuarios (2026-06-17 admin-first rework).
//
// All actions gated by requireSuperAdmin(). Three operations:
//   1. createUser           — provisiona um user com email_verified=true
//   2. attachUserToOrg      — cria member(user, org, role)
//   3. detachUserFromOrg    — remove member row
//   4. setSuperAdmin        — flip user.is_super_admin
//
// Membership writes are tenant-scoped (table member has FORCE RLS) so we
// use the same transaction-local set_config pattern.

'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { requireSuperAdmin } from '@/auth/super-admin'
import { db } from '@/db'
import { member, user as userTable } from '@/db/schema/auth'
import { logger } from '@/lib/logger'

// ────────────────────────────────────────────────────────────────────
// createUser
// ────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.email(),
  password: z.string().min(12).max(200),
  isSuperAdmin: z.boolean().optional().default(false),
})

export type CreateUserResult =
  | { ok: true; userId: string }
  | { ok: false; error: 'invalid_input' | 'email_taken' | 'create_failed' }

export async function createUser(raw: unknown): Promise<CreateUserResult> {
  await requireSuperAdmin()
  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  let newUserId: string
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        name: parsed.data.name,
        consentVersion: '2026-06-01',
        consentAt: new Date(),
      },
    })
    newUserId = result.user.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err: msg, email: parsed.data.email }, 'admin_create_user_signup_failed')
    if (/already exists|unique|duplicate/i.test(msg)) {
      return { ok: false, error: 'email_taken' }
    }
    return { ok: false, error: 'create_failed' }
  }

  try {
    await db
      .update(userTable)
      .set({
        emailVerified: true,
        isSuperAdmin: parsed.data.isSuperAdmin,
      })
      .where(eq(userTable.id, newUserId))
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), newUserId },
      'admin_create_user_post_update_failed',
    )
  }

  revalidatePath('/admin/usuarios')
  return { ok: true, userId: newUserId }
}

// ────────────────────────────────────────────────────────────────────
// attachUserToOrg / detachUserFromOrg
// ────────────────────────────────────────────────────────────────────

const attachSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
})

export type AttachResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'already_member' | 'attach_failed' }

export async function attachUserToOrg(raw: unknown): Promise<AttachResult> {
  await requireSuperAdmin()
  const parsed = attachSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${parsed.data.organizationId}::text, true)`,
      )
      const existing = await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.userId, parsed.data.userId),
            eq(member.organizationId, parsed.data.organizationId),
          ),
        )
        .limit(1)
      if (existing.length > 0) throw new Error('already_member')
      await tx.insert(member).values({
        tenantId: parsed.data.organizationId,
        organizationId: parsed.data.organizationId,
        userId: parsed.data.userId,
        role: parsed.data.role,
      })
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'already_member') return { ok: false, error: 'already_member' }
    logger.error({ err: msg, ...parsed.data }, 'admin_attach_user_failed')
    return { ok: false, error: 'attach_failed' }
  }

  revalidatePath('/admin/usuarios')
  revalidatePath(`/admin/usuarios/${parsed.data.userId}`)
  revalidatePath(`/admin/organizadoras/${parsed.data.organizationId}`)
  return { ok: true }
}

const detachSchema = z.object({
  memberId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export type DetachResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'detach_failed' }

export async function detachUserFromOrg(raw: unknown): Promise<DetachResult> {
  await requireSuperAdmin()
  const parsed = detachSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${parsed.data.organizationId}::text, true)`,
      )
      const res = await tx
        .delete(member)
        .where(eq(member.id, parsed.data.memberId))
        .returning({ id: member.id })
      if (res.length === 0) throw new Error('not_found')
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'not_found') return { ok: false, error: 'not_found' }
    logger.error({ err: msg, ...parsed.data }, 'admin_detach_user_failed')
    return { ok: false, error: 'detach_failed' }
  }

  revalidatePath('/admin/usuarios')
  revalidatePath(`/admin/organizadoras/${parsed.data.organizationId}`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────────────
// setSuperAdmin — toggle global flag
// ────────────────────────────────────────────────────────────────────

const setSuperAdminSchema = z.object({
  userId: z.string().uuid(),
  isSuperAdmin: z.boolean(),
})

export type SetSuperAdminResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'self_demote' | 'update_failed' }

export async function setSuperAdmin(raw: unknown): Promise<SetSuperAdminResult> {
  const { userId: callerId } = await requireSuperAdmin()
  const parsed = setSuperAdminSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  // Defensive — block accidental self-demotion (would lock you out of /admin).
  if (parsed.data.userId === callerId && parsed.data.isSuperAdmin === false) {
    return { ok: false, error: 'self_demote' }
  }

  try {
    const res = await db
      .update(userTable)
      .set({ isSuperAdmin: parsed.data.isSuperAdmin })
      .where(eq(userTable.id, parsed.data.userId))
      .returning({ id: userTable.id })
    if (res.length === 0) return { ok: false, error: 'not_found' }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), ...parsed.data },
      'admin_set_super_admin_failed',
    )
    return { ok: false, error: 'update_failed' }
  }

  revalidatePath('/admin/usuarios')
  revalidatePath(`/admin/usuarios/${parsed.data.userId}`)
  return { ok: true }
}
