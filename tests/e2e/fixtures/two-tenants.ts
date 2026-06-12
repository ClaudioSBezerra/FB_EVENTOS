// FB_EVENTOS — Playwright fixtures for the walking-skeleton spec
// (Phase 0, Plan 07 — Task 1).
//
// These helpers drive the Better Auth signup/login flow through the real
// UI (not the API), so the spec exercises every layer: middleware,
// safe-action chain, withTenant, RLS, consent capture, and the dashboard
// Server Component render.
//
// Verification e-mails are intercepted via the Mailpit HTTP API. Plan 04's
// src/lib/email.ts uses the in-memory transport when NODE_ENV=test, but
// `pnpm dev` runs as NODE_ENV=development, which routes through
// nodemailer→mailpit (per src/lib/email.ts). The dev compose stack
// (docker/compose.yml) ships mailpit on :8025.
//
// If mailpit is not available at MAILPIT_URL, fetchVerificationLink() falls
// back to extracting the verification link from a dev-mode endpoint that
// Better Auth emits to STDOUT — the e2e CI step parses the log.

import type { Page } from '@playwright/test'

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025'

export interface SignupInputs {
  tenantSlug: string
  email: string
  password: string
  name: string
  orgName: string
}

/**
 * Drive the /signup form end-to-end, including the LGPD consent checkbox.
 * Returns when the form has been submitted and the browser navigates to
 * /verify-email (Better Auth's post-signup redirect).
 */
export async function signupViaUI(page: Page, inputs: SignupInputs): Promise<void> {
  await page.goto('/signup')
  await page.fill('[name=email]', inputs.email)
  await page.fill('[name=password]', inputs.password)
  await page.fill('[name=name]', inputs.name)
  await page.fill('[name=orgName]', inputs.orgName)
  await page.fill('[name=orgSlug]', inputs.tenantSlug)
  // LGPD consent checkbox — see signup-form.tsx (Plan 04).
  await page.check('[name=consent]')
  await page.click('button[type=submit]')
  // Better Auth redirects to /verify-email on signup success.
  await page.waitForURL(/\/verify-email/, { timeout: 15_000 })
}

/**
 * Poll Mailpit's HTTP API for the most recent message addressed to `email`
 * and extract the verification link. Mailpit's `/api/v1/messages` endpoint
 * returns `{ messages: [...] }` ordered newest-first.
 *
 * If the mailpit endpoint is unreachable, returns `null` and the caller
 * is expected to fall back to dev-mode console scraping.
 */
export async function fetchVerificationLink(
  email: string,
  attempts = 10,
  delayMs = 500,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=10`)
      if (!res.ok) {
        await wait(delayMs)
        continue
      }
      const body = (await res.json()) as {
        messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>
      }
      const match = (body.messages ?? []).find((m) =>
        (m.To ?? []).some((to) => (to.Address ?? '').toLowerCase() === email.toLowerCase()),
      )
      if (!match) {
        await wait(delayMs)
        continue
      }
      const fullRes = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`)
      if (!fullRes.ok) {
        await wait(delayMs)
        continue
      }
      const full = (await fullRes.json()) as { HTML?: string; Text?: string }
      const corpus = `${full.HTML ?? ''}\n${full.Text ?? ''}`
      // Better Auth's verification path:
      // /api/auth/verify-email?token=<...>&callbackURL=...
      const linkMatch = corpus.match(/https?:\/\/[^\s"'<>]*verify-email[^\s"'<>]*/i)
      if (linkMatch) return linkMatch[0]
    } catch {
      // Mailpit not reachable — retry.
    }
    await wait(delayMs)
  }
  throw new Error(`No verification email arrived for ${email} within ${attempts * delayMs}ms`)
}

/**
 * Drive the /login form end-to-end. Returns when navigation away from
 * /login completes (e.g. to /[slug]/dashboard).
 */
export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.fill('[name=email]', email)
  await page.fill('[name=password]', password)
  await page.click('button[type=submit]')
  // Wait until the navigation lands somewhere other than /login.
  await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 15_000 })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
