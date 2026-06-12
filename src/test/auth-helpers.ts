// FB_EVENTOS — Auth integration test helpers (Phase 0, Plan 04 — Task 3).
//
// Helpers that drive Better Auth flows via the route handler (no HTTP server
// — we call auth.handler(req) directly). Each helper produces realistic
// request shapes so:
//   - signUpUser exercises Better Auth's signUp.email handler with the
//     LGPD additionalFields payload (consentVersion, consentAt) and a forged
//     x-forwarded-for so recordConsentMetadata can read the IP.
//   - verifyEmail flips emailVerified=true via the migrator pool (simulates
//     the user clicking the verification link).
//   - signInUser exercises sign-in.email and returns the session cookie.

import { auth } from '@/auth/server'
import { migratorPool } from './db'

const TEST_BASE_URL = 'http://localhost:3000'
const DEFAULT_IP = '198.51.100.42'

export interface SignUpArgs {
  email: string
  password: string
  name: string
  organizationName?: string
  organizationSlug?: string
  consentVersion?: string
  consentAt?: string
  ip?: string
}

export interface SignUpResult {
  ok: boolean
  status: number
  body: unknown
  cookies: string[]
}

/**
 * Call Better Auth signUp.email via auth.handler. Includes a forged
 * x-forwarded-for header so the session/consent capture path reads a
 * deterministic IP.
 */
export async function signUpUser(args: SignUpArgs): Promise<SignUpResult> {
  const payload = {
    email: args.email,
    password: args.password,
    name: args.name,
    consentVersion: args.consentVersion ?? '2026-06-01',
    consentAt: args.consentAt ?? new Date().toISOString(),
  }
  const req = new Request(`${TEST_BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': args.ip ?? DEFAULT_IP,
      'user-agent': 'fb-eventos-test/0',
    },
    body: JSON.stringify(payload),
  })
  const res = await auth.handler(req)
  const cookies: string[] = []
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'set-cookie') cookies.push(v)
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  return {
    ok: res.ok,
    status: res.status,
    body,
    cookies,
  }
}

/**
 * Mark a user as email-verified via the migrator pool. Simulates the user
 * clicking the link in the verification email — required before signIn
 * succeeds when requireEmailVerification:true.
 */
export async function markEmailVerified(email: string): Promise<void> {
  await migratorPool`UPDATE "user" SET email_verified = true WHERE email = ${email}`
}

/**
 * Sign in via Better Auth sign-in.email. Returns the session cookie string
 * (joined Set-Cookie values) for the caller to attach to follow-up requests.
 */
export async function signInUser(args: {
  email: string
  password: string
  ip?: string
}): Promise<{ ok: boolean; status: number; body: unknown; cookies: string[] }> {
  const req = new Request(`${TEST_BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': args.ip ?? DEFAULT_IP,
      'user-agent': 'fb-eventos-test/0',
    },
    body: JSON.stringify({ email: args.email, password: args.password }),
  })
  const res = await auth.handler(req)
  const cookies: string[] = []
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'set-cookie') cookies.push(v)
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, body, cookies }
}

/**
 * Extract the session cookie pair "name=value" suitable for sending in a
 * follow-up Cookie header. Better Auth uses a cookie named
 * `better-auth.session_token` by default.
 */
export function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
}

/**
 * Fetch session state via auth.handler. Caller passes a cookie header.
 */
export async function getSession(cookie: string) {
  const req = new Request(`${TEST_BASE_URL}/api/auth/get-session`, {
    method: 'GET',
    headers: { cookie },
  })
  const res = await auth.handler(req)
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Forge a request — used in TENA-07 to test that activeOrgId/slug-mismatch
 * paths are rejected.
 */
export async function makeAuthedRequest(
  path: string,
  cookie: string,
  init?: RequestInit & { tenantSlug?: string },
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('cookie', cookie)
  headers.set('x-forwarded-for', DEFAULT_IP)
  if (init?.tenantSlug) headers.set('x-tenant-slug', init.tenantSlug)
  return fetch(`${TEST_BASE_URL}${path}`, { ...init, headers })
}
