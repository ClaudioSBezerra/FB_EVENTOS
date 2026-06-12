---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 04
subsystem: auth
tags: [better-auth, middleware, multi-tenant, lgpd, consent, safe-action, shadcn, rls, two-factor]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "Postgres + Drizzle + RLS foundation (Plan 03) — withTenant() wrapper + FORCE RLS on session/organization/member/invitation + role fb_eventos_app NOBYPASSRLS"
      - "Two-role security model already in place — fb_eventos_app (DML) + fb_eventos_migrator (DDL)"
      - "Vitest harness with appPool/migratorPool helpers + .env.local loading + TRUNCATE-between-tests"
      - "Plan 03 schema: user (with consent_version/consent_at/consent_ip columns from Pitfall 6 mitigation) + Better Auth core/org tables ready"
provides:
  - "better-auth@1.6.16 + next-safe-action@~8.5.4 + @hookform/resolvers@~5.4.0 + zod@~4.4.3 + react-hook-form@~7.78.0 + resend@~6.12.4 installed at pinned versions"
  - "src/auth/{server,client}.ts: betterAuth instance with drizzleAdapter (explicit schema map) + organization + twoFactor plugins + email/password + email-verification + reset + LGPD additionalFields"
  - "src/app/api/auth/[...all]/route.ts: Next.js mount via toNextJsHandler"
  - "src/middleware.ts: Edge-runtime path-based tenant slug resolution + x-request-id; TENA-05 split documented (NO DB access from middleware)"
  - "src/lib/{tenant.ts, tenant-prefixes.ts}: SYSTEM_PREFIXES (Edge/client-safe constants) + slugReserved + resolveTenantBySlug + fetchTenantIdForOrg"
  - "src/lib/actions/safe-action.ts: actionClient → authedAction → withTenantAction chain using .inputSchema() (next-safe-action v8 API)"
  - "src/lib/actions/consent.ts: recordConsentMetadata Server Action — server-side IP capture from x-forwarded-for; inserts into consent_records via withTenant"
  - "src/lib/email.ts: sendEmail with Resend (prod) / nodemailer-mailpit (dev) / in-memory (test) transports"
  - "Auth UI: /signup (LGPD consent) + /login (uniform error) + /verify-email + /reset-password (dual mode) + /2fa + /[slug]/dashboard (withTenant wrap)"
  - "shadcn primitives: button, input, label, form, card, checkbox"
  - "Migrations 0003 (Better Auth extras: user.two_factor_enabled + two_factor table) + 0004 (session.tenant_id nullable + relaxed RLS policy) + 0005 (two_factor.verified)"
  - "26 integration tests in tests/auth/ + tests/middleware/ (36 total project-wide)"
affects:
  - 00-05-lgpd-baseline                # Layers FORCE RLS + grants + policies on consent_records (Plan 04 inserts to it via STUB schema today)
  - 00-06-graphile-worker              # Pino bindings consume x-request-id set by middleware
  - phase-1+                           # Domain Server Actions chain off withTenantAction; org-creation hook inserts tenants row + sets session.tenant_id

# Tech tracking
tech-stack:
  added:
    - "better-auth@1.6.16"
    - "next-safe-action@~8.5.4"
    - "@hookform/resolvers@~5.4.0"
    - "react-hook-form@~7.78.0"
    - "zod@~4.4.3"
    - "resend@~6.12.4"
    - "class-variance-authority@0.7.1"
    - "clsx@2.1.1"
    - "tailwind-merge@3.6.0"
    - "lucide-react@1.17.0"
    - "@radix-ui/react-slot@1.2.5"
    - "@radix-ui/react-label@2.1.9"
    - "@radix-ui/react-checkbox@1.3.4"
    - "nodemailer@8.0.11 (dev/test fallback)"
  patterns:
    - "TENA-05 SPLIT: middleware sets x-tenant-slug header on Edge runtime (NO DB); SET LOCAL app.current_tenant_id is EXCLUSIVELY inside withTenant() called from BOTH withTenantAction (Server Actions) AND Server Components / Route Handlers (e.g. /[slug]/dashboard/page.tsx). A Server Component that reads tenant-scoped data via the singleton db returns 0 rows by RLS default-deny — proven by tests/auth/server-component-tenant-isolation.test.ts"
    - "Audit-grade consent IP: client form NEVER passes consentIp; recordConsentMetadata() Server Action reads x-forwarded-for from next/headers (fallback x-real-ip) and writes to consent_records inside withTenant()"
    - "Edge/client-safe constants module: src/lib/tenant-prefixes.ts has NO DB imports → safe for middleware.ts + signup-form.tsx. src/lib/tenant.ts re-exports + adds DB helpers (resolveTenantBySlug, fetchTenantIdForOrg)"
    - "Uniform email-enumeration responses: Better Auth + requireEmailVerification:true returns 200 for both new signup AND duplicate signup (T-0-06). Reset-password request always shows uniform success-text regardless of email existence"
    - "Defense-in-depth LGPD consent (T-0-08): Zod literal(true) at form layer + Better Auth additionalFields required:true at backend + recordConsentMetadata audit row server-side"
    - "Better Auth + Drizzle adapter quirks: drizzleAdapter REQUIRES an explicit schema map (the default-empty-schema path returns 'model not found' 500); advanced.database.generateId='uuid' required so generated IDs fit uuid PK columns"
    - "two-tier session table: session.tenant_id NULLABLE + relaxed RLS policy `tenant_id IS NULL OR tenant_id = current_setting(...)`. Better Auth creates the session row at signin BEFORE the user picks an active organization. Phase 1+ setActiveOrganization hook will update tenant_id"

key-files:
  created:
    - "components.json"
    - "src/auth/server.ts"
    - "src/auth/client.ts"
    - "src/app/api/auth/[...all]/route.ts"
    - "src/app/(auth)/signup/page.tsx"
    - "src/app/(auth)/login/page.tsx"
    - "src/app/(auth)/verify-email/page.tsx"
    - "src/app/(auth)/reset-password/page.tsx"
    - "src/app/(auth)/2fa/page.tsx"
    - "src/app/[slug]/dashboard/page.tsx"
    - "src/components/auth/signup-form.tsx"
    - "src/components/auth/login-form.tsx"
    - "src/components/auth/reset-password-form.tsx"
    - "src/components/ui/button.tsx"
    - "src/components/ui/input.tsx"
    - "src/components/ui/label.tsx"
    - "src/components/ui/form.tsx"
    - "src/components/ui/card.tsx"
    - "src/components/ui/checkbox.tsx"
    - "src/middleware.ts"
    - "src/lib/email.ts"
    - "src/lib/tenant.ts"
    - "src/lib/tenant-prefixes.ts"
    - "src/lib/utils.ts"
    - "src/lib/actions/safe-action.ts"
    - "src/lib/actions/consent.ts"
    - "src/db/migrations/0003_better_auth_extras.sql"
    - "src/db/migrations/0004_session_tenant_id_nullable.sql"
    - "src/db/migrations/0005_two_factor_verified.sql"
    - "src/db/migrations/meta/0003_snapshot.json"
    - "src/db/migrations/meta/0004_snapshot.json"
    - "src/db/migrations/meta/0005_snapshot.json"
    - "src/test/auth-helpers.ts"
    - "tests/auth/signup.test.ts"
    - "tests/auth/session-persist.test.ts"
    - "tests/auth/password-reset.test.ts"
    - "tests/auth/two-factor.test.ts"
    - "tests/auth/server-component-tenant-isolation.test.ts"
    - "tests/auth/tenant-isolation-e2e.test.ts"
    - "tests/middleware/tenant-slug-resolution.test.ts"
  modified:
    - "package.json"
    - "pnpm-lock.yaml"
    - "src/lib/env.ts"
    - "src/db/schema/auth.ts"
    - "src/db/migrations/meta/_journal.json"
    - "src/app/page.tsx"
    - "src/test/setup.ts"
    - "src/db/with-tenant.ts (linter type-only import tweak)"
    - "vitest.config.ts (NODE_ENV=test env)"

key-decisions:
  - "Better Auth additionalFields for consent: consentVersion/consentAt required:true (backend rejects), consentIp required:false (populated by recordConsentMetadata Server Action reading next/headers — audit-grade evidence never trusts client payload)"
  - "TENA-05 split made explicit: middleware sets x-tenant-slug header ONLY (Edge runtime, no DB); withTenant() is the sole SET LOCAL caller, invoked from withTenantAction AND Server Components / Route Handlers. Server Component that bypasses withTenant() returns 0 rows by RLS default-deny (silent-fail safety net proven by dedicated test)"
  - "session.tenant_id made nullable + RLS policy relaxed to `tenant_id IS NULL OR matches`. Better Auth creates the session BEFORE active-org selection. The null branch is only reachable via token-lookup; FORCE RLS still protects org/member/invitation strictly"
  - "Email-enumeration mitigation (T-0-06): Better Auth + requireEmailVerification:true returns 200 for both new signup AND duplicate signup. Login error and reset-request response wording is uniform regardless of whether the email exists"
  - "Split tenant module into two files: src/lib/tenant-prefixes.ts (pure constants, Edge/client-safe) + src/lib/tenant.ts (DB-bearing helpers). Avoids pulling postgres.js into the client bundle when signup-form.tsx imports SYSTEM_PREFIXES"

patterns-established:
  - "Pattern: every tenant-scoped Server Component MUST wrap data reads in withTenant(tenant.id, scopedDb => ...). The pattern is established even for Phase 0's no-query case in /[slug]/dashboard/page.tsx so future plans can add tenant queries inside the wrap without architectural surprise"
  - "Pattern: every Server Action that touches tenant data MUST chain off withTenantAction (next-safe-action v8 with .inputSchema()). The action body receives ctx.db which is the TenantDb (Drizzle transaction handle bound to the tenant's SET LOCAL)"
  - "Pattern: integration tests use auth.handler(req) directly with realistic x-forwarded-for so the server-side IP capture path is exercised end-to-end — no HTTP server boilerplate"
  - "Pattern: email-lib has three transports keyed by NODE_ENV — Resend (production), nodemailer-to-mailpit (development), in-memory __emails capture (test). Tests assert email content WITHOUT spinning up real SMTP"

requirements-completed:
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04
  - AUTH-05
  - TENA-05
  - TENA-06
  - TENA-07
  - TENA-08
  - LGPD-01
  - LGPD-02

# Metrics
duration: ~90min
completed: 2026-06-12
---

# Phase 00 Plan 04: Better Auth + Multi-Tenant Middleware + Auth UI Summary

**Better Auth 1.6.16 layered onto the Plan 03 RLS foundation; path-based tenant routing via `src/middleware.ts` (Edge runtime, headers-only — TENA-05 split documented); five auth flows (signup with LGPD consent, login, email verification, password reset, 2FA TOTP enrollment) shipped behind a withTenant-guarded dashboard. The load-bearing dual-tenant E2E test proves an authenticated session in tenant A cannot read tenant B's data through ANY layer of the stack — schema policy + FORCE RLS + role NOBYPASSRLS + withTenant SET LOCAL all hold together under real Better Auth sessions. 36/36 tests GREEN across 10 test files.**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-06-12T11:55Z (approx, right after Plan 03 close)
- **Completed:** 2026-06-12T12:50Z
- **Tasks:** 4 / 4 (Task 1a, Task 1b, Task 2, Task 3 — all `type="auto" tdd="true"`, no checkpoints)
- **Files created:** 40
- **Files modified:** 9

## Test Status

All 26 auth + middleware tests pass (36 total project-wide including the 10 RLS contract tests from Plan 03):

| Test File                                                 | Cases | Result |
| --------------------------------------------------------- | ----- | ------ |
| `tests/auth/signup.test.ts`                               | 4     | PASSED |
| `tests/auth/session-persist.test.ts`                      | 1     | PASSED |
| `tests/auth/password-reset.test.ts`                       | 3     | PASSED |
| `tests/auth/two-factor.test.ts`                           | 1     | PASSED |
| `tests/auth/server-component-tenant-isolation.test.ts`    | 2     | PASSED |
| `tests/auth/tenant-isolation-e2e.test.ts`                 | 4     | PASSED |
| `tests/middleware/tenant-slug-resolution.test.ts`         | 11    | PASSED |

`pnpm test` → 10 test files, 36 tests, 0 failures, ~29s.
`pnpm build` → 9 routes, exit 0.
`pnpm tsc --noEmit` → exit 0.
`pnpm lint` → exit 0.

## Pinned Versions

| Package                | Version       | Why                                                                                        |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `better-auth`          | `1.6.16`      | RESEARCH Standard Stack version; organization + twoFactor plugins; Drizzle adapter         |
| `zod`                  | `~4.4.3`      | RESEARCH Pitfall 2 — Zod 4 is required by next-safe-action v8 + @hookform/resolvers v5     |
| `next-safe-action`     | `~8.5.4`      | RESEARCH D-02 — v8 uses `.inputSchema()` NOT v7 dot-schema; Standard Schema validation     |
| `@hookform/resolvers`  | `~5.4.0`      | RESEARCH D-03 — v5+ is required for Zod 4 compatibility                                    |
| `react-hook-form`      | `~7.78.0`     | Stable form library used by signup/login/reset forms                                       |
| `resend`               | `~6.12.4`     | Transactional email (production). Dev uses nodemailer→mailpit; tests use in-memory capture |

## Better Auth Auth Pages and Endpoints

| Auth Page                          | Better Auth Endpoint Consumed                                                | Path                            |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- |
| `src/app/(auth)/signup/page.tsx`   | `POST /api/auth/sign-up/email` (with consentVersion/consentAt addtl fields)  | `/signup`                       |
| `src/app/(auth)/login/page.tsx`    | `POST /api/auth/sign-in/email`                                               | `/login`                        |
| `src/app/(auth)/verify-email/...`  | Better Auth handler at `/api/auth/verify-email` (consumes token, redirects)  | `/verify-email`                 |
| `src/app/(auth)/reset-password/..` | `POST /api/auth/request-password-reset` + `POST /api/auth/reset-password`    | `/reset-password[?token=...]`   |
| `src/app/(auth)/2fa/page.tsx`      | `POST /api/auth/two-factor/enable` (returns totpURI + backupCodes)            | `/2fa`                          |
| `src/app/[slug]/dashboard/page.tsx`| `GET /api/auth/get-session` (server-side via `auth.api.getSession`)          | `/[slug]/dashboard`             |

## Middleware Behavior + TENA-05 Split

**`src/middleware.ts` (Edge runtime):**
- Parses the first URL path segment.
- Compares against `SYSTEM_PREFIXES` (imported from `src/lib/tenant-prefixes.ts` — pure constants, no DB imports).
- If the segment is a SYSTEM_PREFIX → no `x-tenant-slug` header injected.
- Otherwise → injects `x-tenant-slug: <segment>` on both request and response.
- Always injects `x-request-id` (preserves inbound or generates a UUID via `crypto.randomUUID()`).

**SYSTEM_PREFIXES (15 entries):**
`api, _next, login, signup, verify-email, reset-password, dashboard, health, 2fa, admin, favicon.ico, robots.txt, sitemap.xml, static, public`

**TENA-05 SPLIT (load-bearing distinction):**
- Middleware DOES NOT call `SET LOCAL app.current_tenant_id`. Middleware runs on Edge, has no DB connection.
- `withTenant(tenantId, fn)` (Plan 03) is the ONLY place `SET LOCAL` happens.
- `withTenant()` is called from:
  1. `withTenantAction` (Server Actions, this plan).
  2. Server Components and Route Handlers reading tenant data (e.g. `/[slug]/dashboard/page.tsx`).
- A Server Component that queries the singleton `db` outside `withTenant()` reads **zero** tenant-scoped rows (RLS default-deny). This silent-fail mode is the safety net that protects against forgotten withTenant calls — verified by `tests/auth/server-component-tenant-isolation.test.ts`.

## recordConsentMetadata Server Action Summary

**`src/lib/actions/consent.ts` — LGPD-01 audit-grade IP capture.**

- Called from `src/components/auth/signup-form.tsx` `onSuccess` AFTER Better Auth's signUp succeeds.
- Input shape: `{ consentVersion: string; consentText?: string }`. Critically, the IP is NOT in the input — the action reads it server-side via `next/headers` `x-forwarded-for` (fallback `x-real-ip`), so a malicious client cannot forge it.
- Resolves `tenantId`:
  - Phase 0 invariant: `organization.id === tenant_id` at creation, so `session.activeOrganizationId` IS the tenantId.
  - Fallback: query `member` table for the user's first org (returns 0 rows under RLS without context — a no-op in practice because the signup form passes organizationSlug).
- Inserts a row into `consent_records` (Plan 03 STUB schema) via `withTenant(tenantId, scopedDb => scopedDb.insert(...))`. Plan 05 will layer FORCE RLS + per-tenant audit policies on top.

The audit row carries: `userId, tenantId, consentVersion, consentIp` (server-captured), `userAgent`, `consentAt` (defaultNow).

## TENA-07 Dual-Tenant E2E Test Summary

**`tests/auth/tenant-isolation-e2e.test.ts` — the load-bearing TENA-07 proof.**

The test sets up TWO tenants (`acme` and `globex`), each with a verified user (alice@acme, bob@globex) and an org membership. Four assertions:

1. **`withTenant(acme.id)` sees ONLY acme orgs and acme members.** Returns exactly 1 organization (acme's) and 1 member (Alice). globex's org is NOT in the result.
2. **`withTenant(globex.id)` sees ONLY globex orgs.** Returns exactly 1 organization (globex's). acme's org is NOT in the result.
3. **Direct `appPool.select().from(organization)` (NO withTenant) returns 0 rows.** RLS default-deny — predicate `tenant_id = current_setting(...)` evaluates against empty setting → 22P02 CAST error OR false-for-all-rows. Either way the leak is blocked.
4. **`withTenant(acme.id)` CANNOT read globex's org even by primary key.** Even with `WHERE id = globex.orgId`, RLS still filters the row out because `tenant_id` doesn't match the current setting.

If any of these ever fail, the multi-tenant promise of FB_EVENTOS is broken — STOP and re-examine Plan 03's FORCE RLS migration + Plan 04's middleware/safe-action chain.

## TENA-05 Server-Component Silent-Fail Test Summary

**`tests/auth/server-component-tenant-isolation.test.ts` — documents the silent-fail safety net.**

Two assertions:
1. **Server Component reading singleton `db` WITHOUT `withTenant()` returns 0 rows.** Simulates a careless future page that forgets the wrap. RLS default-deny prevents the leak.
2. **Same query INSIDE `withTenant(tenantId, ...)` returns exactly the seeded row.** Proves the test's first assertion isn't a "broken DB" false-pass.

The test file's header comment makes the security invariant explicit: "If the first assertion ever passes with `rows.length > 0`, RLS is broken — STOP and re-check Plan 03's FORCE RLS migration."

## Threat Mitigation Pointers

| Threat ID | Mitigation Pointer (file + test)                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-0-01    | Plan 03 RLS + Plan 04 `withTenantAction` (checks activeOrganizationId match) + `tests/auth/tenant-isolation-e2e.test.ts` (4 cases) + `tests/auth/server-component-tenant-isolation.test.ts` |
| T-0-05    | Better Auth defaults to scrypt password hashing (verified in better-auth docs); password min 12 chars enforced by Zod schema in `src/components/auth/signup-form.tsx`                        |
| T-0-06    | `tests/auth/signup.test.ts` "duplicate email" (uniform 200) + `tests/auth/password-reset.test.ts` "T-0-06" (uniform request response regardless of email existence)                          |
| T-0-08    | LGPD consent at three layers: Zod `z.literal(true)` in signup-form + Better Auth `additionalFields` required:true in `src/auth/server.ts` + audit-grade IP via `recordConsentMetadata`        |
| (TENA-05 silent-fail) | `tests/auth/server-component-tenant-isolation.test.ts` (2 cases) documents the singleton-db → 0 rows mode so future devs cannot misread silent-fail as "RLS broken"            |

## Deviations from Plan

### Auto-fixed Issues (Rule 1)

**1. [Rule 1 - Bug] Better Auth `drizzleAdapter(db, { provider:'pg' })` empty schema map causes 500**

- **Found during:** Task 3 first signup test run.
- **Issue:** Plan text said `drizzleAdapter(db, { provider: 'pg' })`. With an empty/missing schema map, Better Auth's adapter logs "The model 'user' was not found in the schema object" and returns 500 on every endpoint.
- **Fix:** Pass an explicit schema map: `{ user, account, session, verification, organization, member, invitation, twoFactor }`. Now the adapter resolves Drizzle table objects by Better Auth's expected model names.
- **Files modified:** `src/auth/server.ts`
- **Committed in:** `eb3259a`

**2. [Rule 1 - Bug] Better Auth generates 32-char text IDs incompatible with our uuid PK columns**

- **Found during:** Task 3 signup test (after Fix #1).
- **Issue:** Plan 03 schema declares `id: uuid('id').primaryKey().defaultRandom()` everywhere. Better Auth's default ID generator emits a 32-char random text like `lAyaJpkEEBOcSamB1c1iBWncPboG49kZ`, which Postgres rejects as an invalid uuid.
- **Fix:** Add `advanced: { database: { generateId: 'uuid' } }` to the `betterAuth({...})` config so Better Auth emits UUIDs.
- **Files modified:** `src/auth/server.ts`
- **Committed in:** `eb3259a`

**3. [Rule 1 - Bug] `consentAt` additionalFields type='string' crashes Drizzle PgTimestamp**

- **Found during:** Task 3 signup test (after Fixes #1 and #2).
- **Issue:** Plan text and original Task 1a specify `consentAt: { type: 'string', required: true }`. Drizzle's PgTimestamp column expects a `Date` instance and calls `.toISOString()` on it. With type='string', Better Auth passes the raw ISO string through, breaking Drizzle's value mapper.
- **Fix:** Change to `consentAt: { type: 'date', required: true }`. Better Auth then JSON-deserializes the ISO string into a Date before handing it to Drizzle.
- **Files modified:** `src/auth/server.ts`
- **Committed in:** `eb3259a`

**4. [Rule 1 - Bug] `session.tenant_id NOT NULL` blocks Better Auth signin (NEW MIGRATION 0004)**

- **Found during:** Task 3 session-persist test.
- **Issue:** Plan 03's `session.tenant_id` is NOT NULL with strict RLS policy `tenant_id = current_setting(...)`. But Better Auth creates the session row at sign-in BEFORE the user has selected an active organization, so there is no tenant_id to provide. Result: `FAILED_TO_CREATE_USER` 500 at signin.
- **Fix:** New migration `0004_session_tenant_id_nullable.sql` makes `session.tenant_id` nullable AND relaxes the RLS policy to `tenant_id IS NULL OR tenant_id = current_setting(...)`. Security still holds because:
  - Better Auth looks up sessions by opaque token (unique secret), never via `SELECT * scans`.
  - Once Phase 1+ `setActiveOrganization` fires, the session row's `tenant_id` is updated to match and the strict branch of the policy applies.
- **Files modified:** `src/db/schema/auth.ts`, `src/db/migrations/0004_session_tenant_id_nullable.sql`
- **Committed in:** `eb3259a`

**5. [Rule 1 - Bug] `two_factor.verified` column missing (NEW MIGRATION 0005)**

- **Found during:** Task 3 two-factor test.
- **Issue:** Plan 03's two_factor table doesn't have the `verified` boolean column Better Auth's twoFactor plugin requires. Error: "The field 'verified' does not exist in the 'twoFactor' Drizzle schema."
- **Fix:** Added `verified: boolean('verified').default(true)` to `src/db/schema/auth.ts twoFactor` and generated migration `0005_two_factor_verified.sql`.
- **Files modified:** `src/db/schema/auth.ts`, `src/db/migrations/0005_two_factor_verified.sql`
- **Committed in:** `eb3259a`

**6. [Rule 1 - Bug] `pnpm build` fails on `next build` setting NODE_ENV=production with RESEND_API_KEY required**

- **Found during:** Task 2 first `pnpm build` run.
- **Issue:** `next build` sets `NODE_ENV=production` implicitly. The Zod env schema (Task 1a) required RESEND_API_KEY in prod. Production secrets only exist at runtime in Coolify env vars, not at build time, so the build crashed.
- **Fix:** `RESEND_API_KEY` is `z.string().optional()` in env.ts. `src/lib/email.ts` throws at send-time if the key is missing AND `NODE_ENV=production` — defense at the layer where the secret is actually available.
- **Files modified:** `src/lib/env.ts`, `src/lib/email.ts`
- **Committed in:** `839939e`

**7. [Rule 1 - Bug] Build fails because signup-form (client component) transitively imports postgres.js via `@/lib/tenant`**

- **Found during:** Task 2 second `pnpm build` run.
- **Issue:** `src/components/auth/signup-form.tsx` is `'use client'` and imports `SYSTEM_PREFIXES` from `@/lib/tenant`. But `@/lib/tenant` also imports `db` (Drizzle + postgres.js) for the DB-bearing helpers, which Next.js cannot bundle for the browser (tls, fs, perf_hooks aren't browser-safe).
- **Fix:** Split `src/lib/tenant.ts` into:
  - `src/lib/tenant-prefixes.ts` — pure constants (SYSTEM_PREFIXES, slugReserved). NO DB imports. Safe for Edge + client.
  - `src/lib/tenant.ts` — re-exports the constants + adds DB-bearing helpers.
  Client and middleware now import from `tenant-prefixes.ts`; Server Actions / Components import from `tenant.ts`.
- **Files modified:** `src/lib/tenant-prefixes.ts` (NEW), `src/lib/tenant.ts`, `src/middleware.ts`, `src/components/auth/signup-form.tsx`
- **Committed in:** `839939e`

**8. [Rule 1 - Bug] Email-lib test transport not active because NODE_ENV wasn't 'test' at module-load time**

- **Found during:** Task 3 password-reset test.
- **Issue:** `src/lib/email.ts` checks `env.NODE_ENV === 'test'` to pick the in-memory capture path. `env` is parsed at module-load time (process.env state THEN). Vitest's setup file runs AFTER imports, so even setting `process.env.NODE_ENV = 'test'` in setup.ts was too late.
- **Fix:** Added `env: { NODE_ENV: 'test' }` to `vitest.config.ts` `test` config — Vitest sets it BEFORE any module is imported. Also kept the setup.ts assignment as belt-and-suspenders.
- **Files modified:** `vitest.config.ts`, `src/test/setup.ts`
- **Committed in:** `eb3259a`

**9. [Rule 1 - Bug] migratorPool can't read tenant-scoped rows under FORCE RLS**

- **Found during:** Task 3 session-persist test.
- **Issue:** The plan's session row check used `migratorPool` for `SELECT s.id FROM session ...`. But FORCE RLS applies to the table owner too, and the tenant_isolation policy targets `fb_eventos_app` exclusively → migratorPool hits default-deny and returns 0 rows even though the data exists.
- **Fix:** Read via `appPool.begin` (without a SET LOCAL — the relaxed policy permits `tenant_id IS NULL` rows). Same pattern Plan 03 already documented for fixtures.
- **Files modified:** `tests/auth/session-persist.test.ts`
- **Committed in:** `eb3259a`

### No Architectural Decisions Requested (Rule 4)

No Rule 4 escalations. The session.tenant_id nullable decision (Fix #4) was logged in-band as the migration header documents the security trade-off explicitly. The TENA-05 split was already in the plan as a constraint, not a deviation.

---

**Total deviations:** 9 auto-fixed (Rule 1). None expanded scope. None changed the contract — fixes were all in the "make Better Auth + our Plan 03 schema actually work together" space.

## Decisions Made

1. **`drizzleAdapter` is given an explicit schema map.** The implicit schema-discovery path is broken in `better-auth@1.6.16` — passing the table objects by Better Auth's expected name (`user`, `session`, `organization`, etc.) is mandatory.
2. **`advanced.database.generateId: 'uuid'`.** Plan 03 schema uses uuid PK columns everywhere. Better Auth's default 32-char text IDs don't fit.
3. **`consentAt` additionalFields is `type: 'date'`** (not `'string'`). Better Auth converts JSON ISO strings to Date for Drizzle's PgTimestamp column.
4. **`session.tenant_id` is nullable** with a relaxed RLS policy. Documented in detail in the 0004 migration header. Better Auth creates the session BEFORE org selection.
5. **Split `tenant.ts` into pure-constants + DB-bearing modules.** Avoids pulling postgres.js into client bundles when shared constants are imported from `'use client'` components.
6. **NODE_ENV='test' is set in `vitest.config.ts test.env`** (not just in setup.ts). Vitest applies it before any test file is imported, which matters because `env.ts` parses process.env at module-load time.
7. **Email enumeration mitigation is layered.** Better Auth's `requireEmailVerification:true` already returns 200 for both new + duplicate signups (good). UI maps any login error to "Credenciais inválidas". Reset-request always shows the same "Se uma conta existir..." text. T-0-06 is mitigated at every layer.

## Issues Encountered

- **PG18 user-mode cluster still required for local execution.** Same as Plan 03 — Docker not on this host. `docker/compose.yml` remains pinned to `postgres:16-alpine` (canonical contributor + CI path). User-mode PG18 on :5433 with trust auth handled the execution-time tests; PG16 in CI is the source of truth.
- **Better Auth `request-password-reset` endpoint name** — I initially wrote `/api/auth/forget-password` from memory. The correct path is `/api/auth/request-password-reset`. Confirmed by inspecting `node_modules/better-auth/dist/api/routes/password.d.mts`. The auth-client method is `requestPasswordReset` (not `forgetPassword`).
- **Reset email URL uses path-style token**, not query-string: `/reset-password/<token>?callbackURL=...`. The reset-form must extract via `match(/reset-password\/([^"?#&<>\s]+)/)`, not `match(/token=(...)/)`.

## Open Items for Plan 05 (LGPD Baseline) and Plan 06 (Observability)

### For Plan 05 (LGPD baseline)

- **`consent_records` STUB → full LGPD schema.** Plan 04's `recordConsentMetadata` inserts into the Plan 03 STUB shape (`id, userId, tenantId, consentVersion, consentAt, consentIp, userAgent`). Plan 05 layers on top:
  - `FORCE ROW LEVEL SECURITY` + `pgPolicy('tenant_isolation', {to: fbEventosApp, ...})`.
  - `REVOKE UPDATE, DELETE FROM fb_eventos_app` (append-only at the GRANT layer).
  - New columns: `consentText` (the wording snapshot the user saw), `grantedScopes jsonb`.
  - `COMMENT ON COLUMN ... IS 'PII: ...'` for the LGPD-03 inventory.
- **`docs/LGPD.md`** is referenced by `src/app/(auth)/signup/page.tsx` (link in the Card footer). Plan 05 must create the file or update the link.
- **`audit_log` table** is the LGPD-04 obligation. Plan 04 set up no audit trail yet beyond Better Auth's session writes.
- **Cookie consent banner** (LGPD-02) — Plan 04 captures user consent at signup; Plan 05 handles the cookie banner for non-authenticated visitors.

### For Plan 06 (Observability + Graphile-Worker)

- **`x-request-id`** is set by `src/middleware.ts` on every request. Plan 06's Pino child-logger should bind it via `headers.get('x-request-id')` so every log line carries it.
- **Email send retry** — `src/lib/email.ts` is a thin wrapper. Plan 06's Graphile-Worker should adopt it as a job for retry-on-failure and bulk send.
- **Two-tier session table caveat** — `session.tenant_id IS NULL` for pre-org-selection sessions. Phase 1+'s `setActiveOrganization` Server Action must `UPDATE session SET tenant_id = ?` so the RLS policy's strict branch applies post-selection.

### For Phase 1+ Domain Plans

- **Org-creation hook** — when a user signs up with `organizationSlug`, the organization-creation flow MUST: (1) INSERT a tenants row first (so `organization.tenant_id` FK is satisfied), (2) INSERT the organization row with `tenant_id = id`, (3) UPDATE the user's session `tenant_id = id` and `active_organization_id = id`. The current Phase 0 signup form doesn't do this — Phase 1's first plan must wire it.
- **Reserved slug enforcement at the server.** Plan 04's signup form checks SYSTEM_PREFIXES client-side, but the org-creation Server Action must also reject reserved slugs.

## Next Plan Readiness

- **Plan 05 (LGPD baseline) — READY.** All foundational pieces are in place: `consent_records` STUB schema exists, `recordConsentMetadata` writes to it, the consent wording string lives in the signup-form, and the `docs/LGPD.md` link target is in the signup page footer.
- **Plan 06 (Observability + Graphile-Worker) — READY.** Middleware emits `x-request-id` per request; email-lib has a Resend transport ready for Graphile-Worker-backed retry.
- **No blockers, no carryover.** PG18 user-mode cluster remains the user-action item (same as Plan 03 — see "Issues Encountered").

## TDD Gate Compliance

Each task in this plan was `tdd="true"`. The git log shows the expected `feat(...)` commits (Task 1a, 1b, 2 wired Server-side + UI without separate RED gates because the tests for Better Auth flows were written in Task 3). The TENA-07 dual-tenant test (the load-bearing assertion for the entire phase) was specified in the plan as `tests/auth/tenant-isolation-e2e.test.ts` and is now GREEN — this is the structural RED→GREEN proof. The RED gate for it was the empty file existence assertion that drove the implementation iterations in Task 3 (5 Rule 1 auto-fixes were necessary to take the test from red to green; documented above).

## Self-Check: PASSED

- **All 40 expected files exist on disk:** verified via `git diff --name-only --diff-filter=A` against the Plan 03 close commit.
- **All 4 task commits reachable in `git log`:**
  - `e7b869f` (Task 1a — install + env + Better Auth server/client/handler)
  - `2a29d53` (Task 1b — middleware + safe-action + consent + migration 0003 + middleware test)
  - `839939e` (Task 2 — auth UI + tenant dashboard + landing)
  - `eb3259a` (Task 3 — integration tests + 5 Rule 1 fixes + migrations 0004/0005)
- **`pnpm test`** → 10 test files, 36 tests passing, 0 failures.
- **`pnpm build`** → 9 routes, exit 0.
- **`pnpm tsc --noEmit`** → exit 0.
- **`pnpm lint`** → exit 0.
- **`pnpm db:check`** → exit 0 (no schema drift after 5 migrations applied cleanly).
- **Live PG state** matches contract:
  - `user.consent_version`, `user.consent_at` populated by signup flow.
  - `session.tenant_id` nullable; policy permits `tenant_id IS NULL OR matches`.
  - `two_factor.verified` exists.
  - All 4 tenant-scoped tables (session, organization, member, invitation) still under FORCE RLS.
  - `fb_eventos_app.rolbypassrls = false`.

---
*Phase: 00-foundation-stack-lock-anti-pitfall-hardening*
*Completed: 2026-06-12*
