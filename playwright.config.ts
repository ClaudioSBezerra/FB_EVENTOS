// FB_EVENTOS — Playwright E2E configuration (Phase 0, Plan 07 — Task 1).
//
// Walking-skeleton end-to-end test runner. The Playwright suite is the
// proof artifact that all of Plans 01-06 integrate into a single deployable
// system: signup → email-verify → login → tenant-scoped dashboard
// round-trip + LGPD consent enforcement.
//
// IMPORTANT — TENA-07 ownership:
//   The walking-skeleton spec exercises a cross-tenant access scenario as
//   SUPPLEMENTAL smoke confidence only. The LOAD-BEARING tenant-isolation
//   proof remains Plan 04's tests/auth/tenant-isolation-e2e.test.ts (three
//   Vitest assertions covering RLS + role NOBYPASSRLS + withTenant). If
//   that Vitest test breaks, the phase fails Plan 04. Plan 07 is not a
//   blocking-dependency proxy.
//
// `webServer` boots `pnpm dev` and waits for /api/health to return 200 —
// the same probe Coolify/Traefik will use in production.

import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  // Tests should not depend on each other; serial run keeps signup races out.
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
    {
      // D-14 gate — Phase 1 piloto Trindade. Runs the same Chromium
      // config but with explicit sandbox env defaults injected via the
      // tests/e2e/fixtures/d14-gate-fixtures.ts module (ensureSandboxEnv).
      // The existing walking-skeleton/planta-editor specs ARE NOT
      // included in this project — they run under 'chromium' above.
      // The d14-gate project narrows to the describe.serial block:
      //   tests/e2e/walking-skeleton.spec.ts → "D-14 gate" describe
      // by using --grep at invocation time:
      //   pnpm test:e2e --project=d14-gate --grep "D-14 gate"
      name: 'd14-gate',
      use: devices['Desktop Chrome'],
      testMatch: /walking-skeleton\.spec\.ts/,
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Boot the Next.js dev server. Plan 07's /api/health route is the
        // readiness probe — same contract Coolify uses in production.
        command: 'pnpm dev',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
