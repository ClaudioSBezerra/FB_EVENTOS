// FB_EVENTOS — Session persistence integration test (Phase 0, Plan 04 — Task 3).
//
// AUTH-04: signing in produces a session row in Postgres + a cookie. A
// follow-up request with that cookie returns the SAME session (proving
// persistence across browser refreshes).

import { afterAll, beforeEach, expect, test } from 'vitest'
import { eq } from 'drizzle-orm'

import { auth } from '@/auth/server'
import { pool } from '@/db'
import {
  cookieHeader,
  getSession,
  markEmailVerified,
  signInUser,
  signUpUser,
} from '@/test/auth-helpers'
import { appPool, migratorPool } from '@/test/db'

const PASSWORD = 'super-secret-password-1234'

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

test('AUTH-04: sign-in creates session row + cookie; follow-up reuses session', async () => {
  const email = `persist-${Date.now()}@test.example`
  // 1. Sign up.
  const signup = await signUpUser({ email, password: PASSWORD, name: 'Persist' })
  expect(signup.status).toBe(200)

  // 2. Mark email verified (simulate clicking the link).
  await markEmailVerified(email)

  // 3. Sign in.
  const signin = await signInUser({ email, password: PASSWORD })
  expect(signin.status).toBe(200)
  expect(signin.cookies.length).toBeGreaterThan(0)

  // 4. Verify a session row exists in Postgres. Use appPool with SET LOCAL
  //    so RLS lets us through — even though tenant_id IS NULL for the
  //    pre-org-selection session, FORCE RLS requires the policy to match,
  //    and the policy targets fb_eventos_app (not fb_migrator). The
  //    `tenant_id IS NULL` branch of the policy is what permits this read.
  const sessionRows = await appPool.begin(async (tx) => {
    return tx<{ id: string; user_id: string; expires_at: Date; tenant_id: string | null }[]>`
      SELECT s.id, s.user_id, s.expires_at, s.tenant_id
        FROM session s
        JOIN "user" u ON u.id = s.user_id
       WHERE u.email = ${email}
    `
  })
  expect(sessionRows.length).toBe(1)
  expect(sessionRows[0]?.expires_at).toBeInstanceOf(Date)
  // expires_at must be > now (active session)
  expect(sessionRows[0]!.expires_at.getTime()).toBeGreaterThan(Date.now())

  // 5. Follow-up request with the cookie returns the SAME session.
  const cookie = cookieHeader(signin.cookies)
  const session1 = (await getSession(cookie)) as {
    user: { id: string; email: string }
    session: { id: string }
  } | null
  expect(session1?.user.email).toBe(email)

  const session2 = (await getSession(cookie)) as {
    user: { id: string; email: string }
    session: { id: string }
  } | null
  expect(session2?.session.id).toBe(session1?.session.id)
})
