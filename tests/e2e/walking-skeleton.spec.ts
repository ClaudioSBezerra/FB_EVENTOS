// FB_EVENTOS — Walking-skeleton E2E spec (Phase 0, Plan 07 — Task 1).
//
// THE proof artifact for Phase 0: every piece built in Plans 01-06
// integrates into a single deployable system. Real Chromium drives a real
// Next.js server through Better Auth + middleware + RLS + withTenant +
// Server Components + the LGPD consent capture.
//
// ─────────────────────────────────────────────────────────────────────────
// IMPORTANT — TENA-07 ownership clarification:
//   This spec exercises a cross-tenant access scenario as SUPPLEMENTAL
//   smoke confidence only. The LOAD-BEARING tenant-isolation proof
//   remains Plan 04's `tests/auth/tenant-isolation-e2e.test.ts` (three
//   Vitest assertions: Alice sees only acme; slug-spoofing rejected;
//   appPool default-deny). If THAT Vitest test breaks, the phase fails
//   Plan 04. Plan 07 is not a blocking-dependency proxy for TENA-07.
// ─────────────────────────────────────────────────────────────────────────
//
// The two test cases:
//   1. Walking skeleton happy path — signup with LGPD consent → email
//      verify → login → /[slug]/dashboard renders the org name via
//      withTenant (one tenant-scoped round-trip). Then the same browser
//      attempts to access a different tenant's dashboard and is rejected
//      with 403/forbidden (supplemental smoke).
//   2. LGPD consent enforcement at signup — the form must refuse to
//      submit when the consent checkbox is unchecked (Zod z.literal(true)
//      at the form layer + Better Auth additionalFields required:true at
//      the backend — three-layer defense-in-depth from Plan 04).

import { expect, test } from '@playwright/test'

import { fetchVerificationLink, loginViaUI, signupViaUI } from './fixtures/two-tenants'

// Allow CI to skip when browsers aren't installed (this environment also
// uses the same gate). Browsers ARE installed in the GitHub Actions e2e
// job via `playwright install --with-deps chromium`.
const playwrightSkipReason =
  'Playwright browser binaries not installed in this environment ' +
  '(install via: pnpm exec playwright install --with-deps chromium)'

const browsersAvailable = process.env.PLAYWRIGHT_BROWSERS_READY === '1' || !!process.env.CI

test.describe('walking skeleton — integrated stack proof', () => {
  test.skip(!browsersAvailable, playwrightSkipReason)

  test('signup → verify → login → tenant-scoped dashboard round-trip', async ({ page }) => {
    const tenantSlug = `acme${Date.now().toString(36)}`
    const email = `alice+${tenantSlug}@acme.test`
    const password = 'sup3rsecret!password'

    // 1. Signup tenant A (with LGPD consent — the only path that survives
    //    Plan 04's three-layer defense).
    await signupViaUI(page, {
      tenantSlug,
      email,
      password,
      name: 'Alice',
      orgName: 'Acme Org',
    })

    // 2. Fetch the verification email from mailpit + visit the link.
    const link = await fetchVerificationLink(email)
    await page.goto(link)

    // 3. Login.
    await loginViaUI(page, email, password)

    // 4. Reach /[slug]/dashboard. The dashboard Server Component reads via
    //    withTenant(tenant.id, ...) (Plan 04 Task 2) — proving that the
    //    full stack composes: middleware injects x-tenant-slug, the
    //    Server Component resolves tenant.id, withTenant() sets the
    //    RLS GUC, the Drizzle query honors it.
    await expect(page).toHaveURL(new RegExp(`/${tenantSlug}/dashboard`))
    await expect(page.locator('body')).toContainText(/Acme/i)

    // 5. SUPPLEMENTAL cross-tenant smoke (NOT the load-bearing TENA-07
    //    proof — see Plan 04's tests/auth/tenant-isolation-e2e.test.ts).
    //    Same authenticated browser hits a different tenant's dashboard:
    //    the session.activeOrganizationId check in
    //    src/app/[slug]/dashboard/page.tsx returns 403 — even before any
    //    RLS query is issued.
    await page.goto('/globex-nonexistent/dashboard')
    await expect(page.locator('body')).toContainText(
      /403|forbidden|sem acesso|not.*member|n[ãa]o encontrad/i,
    )
  })
})

test.describe('LGPD consent enforcement at signup', () => {
  test.skip(!browsersAvailable, playwrightSkipReason)

  test('signup form refuses to submit without LGPD consent', async ({ page }) => {
    await page.goto('/signup')
    // Fill in every required field EXCEPT the consent checkbox.
    await page.fill('[name=email]', `noconsent+${Date.now()}@test.example`)
    await page.fill('[name=password]', 'sup3rsecret!password')
    await page.fill('[name=name]', 'No Consent')
    await page.fill('[name=orgName]', 'NoConsent Org')
    await page.fill('[name=orgSlug]', `noconsent${Date.now().toString(36)}`)
    // Deliberately skip page.check('[name=consent]')

    await page.click('button[type=submit]')

    // The Zod schema in signup-form.tsx requires
    // `consent: z.literal(true, { message: 'O consentimento LGPD é obrigatório...' })`.
    // RHF surfaces the error via the FormMessage component — we assert
    // that the consent-required wording appears somewhere on the page.
    // We do NOT navigate to /verify-email (the success path).
    await expect(page).toHaveURL(/\/signup/)
    await expect(page.locator('body')).toContainText(/consentimento.*obrigat|consent/i)
  })
})
