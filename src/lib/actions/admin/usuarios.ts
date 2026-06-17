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

  // Pre-check email duplication BEFORE calling Better Auth.
  //
  // Better Auth has anti-enumeration: when emailAndPassword.requireEmailVerification
  // OR emailAndPassword.autoSignIn === false (we have both), the sign-up
  // endpoint silently returns a SYNTHETIC user with a freshly generated id
  // instead of throwing on duplicate email. That id is NOT persisted —
  // anything we do with it (UPDATE, redirect to detail page) hits 0 rows
  // and looks like the user vanished. The admin console reported the user
  // as created and then 404'd on detail (2026-06-17 incident:
  // claudio_bezerra@hotmail.com duplicate). Pre-checking here keeps the
  // anti-enumeration guarantee for the public surface while giving admins
  // a clean error message.
  const existing = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, parsed.data.email))
    .limit(1)
  if (existing.length > 0) {
    return { ok: false, error: 'email_taken' }
  }

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

  // Defensive post-check: confirm the returned id is actually in the DB.
  // Belt-and-suspenders against future Better Auth changes that might
  // synthesize ids without the pre-check catching them (TOCTOU race).
  const created = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, newUserId))
    .limit(1)
  if (created.length === 0) {
    logger.error({ newUserId, email: parsed.data.email }, 'admin_create_user_synthetic_id_returned')
    return { ok: false, error: 'email_taken' }
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
// adminResetPassword — set new password + mark email_verified
// ────────────────────────────────────────────────────────────────────
//
// Caminho de emergência pra quando o fluxo normal de reset por email
// não funciona (SMTP off, conta com email não verificado, etc).
// super_admin define uma nova senha + força email_verified=true.
// Usa o hashPassword do better-auth/crypto pra garantir hash compatível
// com o algoritmo do Better Auth (scrypt).

const resetPasswordSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(10).max(200),
})

export type AdminResetPasswordResult =
  | { ok: true }
  | {
      ok: false
      error: 'invalid_input' | 'user_not_found' | 'no_credential_account' | 'update_failed'
    }

export async function adminResetUserPassword(raw: unknown): Promise<AdminResetPasswordResult> {
  await requireSuperAdmin()
  const parsed = resetPasswordSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  try {
    const { hashPassword } = await import('better-auth/crypto')
    const hash = await hashPassword(parsed.data.newPassword)

    // Update password no account (provider_id='credential') + força
    // email_verified=true pra desbloquear login imediato.
    const { account } = await import('@/db/schema/auth')
    const accountRows = await db
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(account.userId, parsed.data.userId), eq(account.providerId, 'credential')))
      .returning({ id: account.id })

    if (accountRows.length === 0) {
      return { ok: false, error: 'no_credential_account' }
    }

    await db
      .update(userTable)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(userTable.id, parsed.data.userId))

    // Invalida sessões antigas pra forçar re-login com a nova senha.
    const { session } = await import('@/db/schema/auth')
    await db.delete(session).where(eq(session.userId, parsed.data.userId))

    logger.info({ userId: parsed.data.userId }, 'admin_reset_user_password_success')
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), userId: parsed.data.userId },
      'admin_reset_user_password_failed',
    )
    return { ok: false, error: 'update_failed' }
  }

  revalidatePath('/admin/usuarios')
  revalidatePath(`/admin/usuarios/${parsed.data.userId}`)
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
