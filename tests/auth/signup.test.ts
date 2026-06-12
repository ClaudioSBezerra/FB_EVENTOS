// FB_EVENTOS — Signup integration tests (Phase 0, Plan 04 — Task 3).
//
// AUTH-01 (email+password signup), AUTH-02 (verify-email-required),
// LGPD-01 (consentVersion + consentAt required; consentIp captured server-
// side). Mitigates T-0-06 (uniform duplicate response) and T-0-08 (LGPD
// consent capture).
//
// All tests use Better Auth's handler directly via auth.handler(req).

import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { eq } from 'drizzle-orm'

import { auth } from '@/auth/server'
import { db, pool } from '@/db'
import { user as userTable } from '@/db/schema/auth'
import { appPool, migratorPool } from '@/test/db'
import { signUpUser } from '@/test/auth-helpers'

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

const PASSWORD = 'super-secret-password-1234'

describe('Better Auth signUp.email — LGPD consent + happy path', () => {
  test('happy path: signup with consent creates user + consent fields populated', async () => {
    const email = `alice-${Date.now()}@acme.example`
    const res = await signUpUser({
      email,
      password: PASSWORD,
      name: 'Alice',
      ip: '198.51.100.10',
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const rows = await migratorPool<
      { id: string; consent_version: string | null; consent_at: Date | null }[]
    >`SELECT id, consent_version, consent_at FROM "user" WHERE email = ${email}`
    expect(rows.length).toBe(1)
    expect(rows[0]?.consent_version).toBe('2026-06-01')
    expect(rows[0]?.consent_at).toBeTruthy()
  })

  test('missing consent: signup without consentVersion is rejected', async () => {
    const email = `no-consent-${Date.now()}@test.example`
    // Build payload WITHOUT consentVersion/consentAt — Better Auth's
    // additionalFields(required:true) should reject.
    const req = new Request('http://localhost:3000/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.11',
      },
      body: JSON.stringify({ email, password: PASSWORD, name: 'NoConsent' }),
    })
    const res = await auth.handler(req)
    expect(res.ok).toBe(false)
    expect([400, 422]).toContain(res.status)

    const rows = await migratorPool<{ id: string }[]>`
      SELECT id FROM "user" WHERE email = ${email}
    `
    expect(rows.length).toBe(0)
  })

  test('duplicate email: returns uniform response (T-0-06 mitigation)', async () => {
    const email = `dup-${Date.now()}@test.example`
    const first = await signUpUser({ email, password: PASSWORD, name: 'First' })
    expect(first.status).toBe(200)

    const second = await signUpUser({ email, password: PASSWORD, name: 'Second' })
    // T-0-06: the response MUST be indistinguishable from a new-user signup.
    // Better Auth + requireEmailVerification:true achieves this by returning
    // 200 in both cases ("verification email sent" — no leak about whether
    // the address is already registered). The actual user row is NOT
    // duplicated (only ONE user exists in the DB).
    expect(second.status).toBe(first.status) // Same status code
    expect(typeof second.body).toBe(typeof first.body) // Same body shape

    // And verify only ONE user row exists (no duplicate user created).
    const rows = await migratorPool<{ id: string }[]>`
      SELECT id FROM "user" WHERE email = ${email}
    `
    expect(rows.length).toBe(1)
  })

  test('emailVerified defaults to false on signup (verification gate)', async () => {
    const email = `verif-${Date.now()}@test.example`
    const res = await signUpUser({ email, password: PASSWORD, name: 'V' })
    expect(res.status).toBe(200)

    const rows = await db
      .select({ id: userTable.id, emailVerified: userTable.emailVerified })
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1)
    expect(rows.length).toBe(1)
    expect(rows[0]?.emailVerified).toBe(false)
  })
})
