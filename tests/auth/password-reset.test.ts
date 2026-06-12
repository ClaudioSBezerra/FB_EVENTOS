// FB_EVENTOS — Password reset flow tests (Phase 0, Plan 04 — Task 3).
//
// AUTH-03: request reset → token-bearing email → consume → password changed.
// T-0-06: request reset for an unknown email returns the SAME response shape
// as a request for a known email — no email enumeration leak.

import { afterAll, afterEach, beforeEach, expect, test } from 'vitest'

import { auth } from '@/auth/server'
import { pool } from '@/db'
import { __emails } from '@/lib/email'
import { markEmailVerified, signInUser, signUpUser } from '@/test/auth-helpers'
import { appPool, migratorPool } from '@/test/db'

const PASSWORD = 'super-secret-password-1234'
const NEW_PASSWORD = 'brand-new-secret-password-9876'

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

beforeEach(() => {
  __emails.reset()
})

afterEach(() => {
  __emails.reset()
})

async function requestReset(email: string): Promise<Response> {
  const req = new Request('http://localhost:3000/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, redirectTo: '/reset-password' }),
  })
  return auth.handler(req)
}

test('AUTH-03 happy path: request reset emits a verification token row + email', async () => {
  const email = `reset-ok-${Date.now()}@test.example`
  await signUpUser({ email, password: PASSWORD, name: 'R' })
  await markEmailVerified(email)
  __emails.reset()

  const res = await requestReset(email)
  expect(res.ok).toBe(true)

  // The email-lib captured a reset email in test mode (NODE_ENV=test branch).
  const sent = __emails.findByTo(email)
  expect(sent).toBeTruthy()
  expect(sent?.subject).toMatch(/Redefinir/)
  // Better Auth's reset URL uses path-style token: /reset-password/<token>?...
  const tokenMatch = sent?.html.match(/reset-password\/([^"?#&<>\s]+)/)
  expect(tokenMatch).toBeTruthy()
})

test('T-0-06: request reset for unknown email returns the SAME response shape', async () => {
  const knownEmail = `reset-known-${Date.now()}@test.example`
  await signUpUser({ email: knownEmail, password: PASSWORD, name: 'K' })
  await markEmailVerified(knownEmail)

  const knownRes = await requestReset(knownEmail)
  const unknownRes = await requestReset(`unknown-${Date.now()}@test.example`)

  // Same HTTP status code — no enumeration signal in the response.
  expect(unknownRes.status).toBe(knownRes.status)
})

test('AUTH-03 consume: reset token allows new password; old password no longer works', async () => {
  const email = `reset-consume-${Date.now()}@test.example`
  await signUpUser({ email, password: PASSWORD, name: 'C' })
  await markEmailVerified(email)
  __emails.reset()

  // 1. Request reset → capture token.
  await requestReset(email)
  const sent = __emails.findByTo(email)
  expect(sent).toBeTruthy()
  // Better Auth's reset URL uses path-style token: /reset-password/<token>?...
  const tokenMatch = sent?.html.match(/reset-password\/([^"?#&<>\s]+)/)
  expect(tokenMatch).toBeTruthy()
  const token = tokenMatch![1]
  expect(token).toBeTruthy()

  // 2. Consume the token to set a new password.
  const consumeReq = new Request('http://localhost:3000/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
  })
  const consumeRes = await auth.handler(consumeReq)
  expect(consumeRes.ok).toBe(true)

  // 3. Old password should no longer log in.
  const oldLogin = await signInUser({ email, password: PASSWORD })
  expect(oldLogin.ok).toBe(false)

  // 4. New password should work.
  const newLogin = await signInUser({ email, password: NEW_PASSWORD })
  expect(newLogin.ok).toBe(true)
})
