// FB_EVENTOS — Super admin guard (migration 0022, 2026-06-17).
//
// Single source of truth for "is this caller a super admin?". Used by:
//   - src/app/admin/layout.tsx (gates the whole /admin/* surface)
//   - src/app/page.tsx (routes super admins to /admin on root visits)
//   - server actions under src/lib/actions/admin/*
//
// The is_super_admin flag lives on `user` (global table, no RLS). We look it
// up via the singleton db — `user` is never RLS-scoped, so no withTenant
// wrap. The session already gives us the userId; one column SELECT is the
// cheapest possible gate.
//
// IMPORTANT: do NOT trust client-supplied is_super_admin (e.g. cookies,
// JSON tokens) — always re-read from the DB on each gate. This is the same
// stance Better Auth takes for session lookups.

import { eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import { auth } from './server'

/** Lightweight result: whether the current session belongs to a super admin. */
export interface SuperAdminCheck {
  isSuperAdmin: boolean
  userId: string | null
  email: string | null
}

/**
 * Resolves the current session and looks up the is_super_admin flag on
 * the user row. Returns `isSuperAdmin: false` if there is no session, the
 * user row is gone, or the flag is unset.
 */
export async function checkSuperAdmin(): Promise<SuperAdminCheck> {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) {
    return { isSuperAdmin: false, userId: null, email: null }
  }
  const rows = await db
    .select({ isSuperAdmin: user.isSuperAdmin, email: user.email })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1)
  const row = rows[0]
  if (!row) {
    return { isSuperAdmin: false, userId: session.user.id, email: null }
  }
  return {
    isSuperAdmin: row.isSuperAdmin === true,
    userId: session.user.id,
    email: row.email,
  }
}

/**
 * Throws via Next.js notFound() if the caller is NOT a super admin. Use as
 * the first line of every /admin/* server component or server action. We
 * use notFound (404) instead of 403 so the existence of /admin is opaque
 * to non-admin users — same playbook as Stripe Dashboard / Vercel admin.
 */
export async function requireSuperAdmin(): Promise<{
  userId: string
  email: string
}> {
  const check = await checkSuperAdmin()
  if (!check.isSuperAdmin || !check.userId || !check.email) {
    // Lazy import to avoid bundling next/navigation in non-RSC paths.
    const { notFound } = await import('next/navigation')
    notFound()
    // Unreachable — notFound throws — but the explicit throw satisfies
    // the type narrower and protects us if Next.js ever changes notFound
    // to return.
    throw new Error('unreachable')
  }
  return { userId: check.userId, email: check.email }
}
