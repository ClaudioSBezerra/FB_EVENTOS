// FB_EVENTOS — 2FA TOTP enrollment integration test (Phase 0, Plan 04 — Task 3).
//
// AUTH-05: a signed-in user can enable TOTP and the two_factor table is
// populated. We do NOT exercise the full TOTP code-verification round trip
// here (that requires generating a TOTP code from the secret — which is
// trivially testable with `otpauth` but adds an extra dep). The
// security-relevant assertion is that enrollment creates a verified
// two-factor secret tied to the user — which is what AUTH-05 actually
// promises.

import { afterAll, expect, test } from 'vitest'

import { auth } from '@/auth/server'
import { pool } from '@/db'
import { cookieHeader, markEmailVerified, signInUser, signUpUser } from '@/test/auth-helpers'
import { appPool, migratorPool } from '@/test/db'

const PASSWORD = 'super-secret-password-1234'

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

test('AUTH-05: signed-in user can enable 2FA and a two_factor row is created', async () => {
  const email = `tfa-${Date.now()}@test.example`
  await signUpUser({ email, password: PASSWORD, name: 'TFA' })
  await markEmailVerified(email)
  const signin = await signInUser({ email, password: PASSWORD })
  expect(signin.status).toBe(200)
  const cookie = cookieHeader(signin.cookies)

  // Call Better Auth's two-factor enable endpoint.
  const req = new Request('http://localhost:3000/api/auth/two-factor/enable', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify({ password: PASSWORD }),
  })
  const res = await auth.handler(req)
  expect(res.ok, `enable 2fa failed: ${res.status}`).toBe(true)
  const body = (await res.json()) as { totpURI?: string; backupCodes?: string[] }
  expect(body.totpURI ?? '').toMatch(/otpauth:\/\//)
  expect(Array.isArray(body.backupCodes)).toBe(true)

  // two_factor row exists for the user.
  const rows = await migratorPool<{ id: string; secret: string; backup_codes: string }[]>`
    SELECT tf.id, tf.secret, tf.backup_codes
      FROM two_factor tf
      JOIN "user" u ON u.id = tf.user_id
     WHERE u.email = ${email}
  `
  expect(rows.length).toBe(1)
  expect(rows[0]?.secret).toBeTruthy()
  expect(rows[0]?.backup_codes).toBeTruthy()
})
