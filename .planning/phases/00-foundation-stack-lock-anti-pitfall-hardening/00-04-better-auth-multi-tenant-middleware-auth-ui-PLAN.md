---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 04
type: execute
wave: 3
depends_on:
  - 00-03
files_modified:
  - package.json
  - src/auth/server.ts
  - src/auth/client.ts
  - src/app/api/auth/[...all]/route.ts
  - src/middleware.ts
  - src/lib/actions/safe-action.ts
  - src/lib/actions/consent.ts
  - src/lib/tenant.ts
  - src/lib/env.ts
  - src/app/(auth)/login/page.tsx
  - src/app/(auth)/signup/page.tsx
  - src/app/(auth)/verify-email/page.tsx
  - src/app/(auth)/reset-password/page.tsx
  - src/app/(auth)/2fa/page.tsx
  - src/app/[slug]/dashboard/page.tsx
  - src/app/page.tsx
  - src/components/auth/signup-form.tsx
  - src/components/auth/login-form.tsx
  - src/components/auth/reset-password-form.tsx
  - src/components/ui/button.tsx
  - src/components/ui/input.tsx
  - src/components/ui/label.tsx
  - src/components/ui/form.tsx
  - src/components/ui/card.tsx
  - src/components/ui/checkbox.tsx
  - src/lib/email.ts
  - src/db/schema/auth.ts
  - src/db/migrations/0003_better_auth_extras.sql
  - tests/auth/signup.test.ts
  - tests/auth/session-persist.test.ts
  - tests/auth/password-reset.test.ts
  - tests/auth/two-factor.test.ts
  - tests/auth/tenant-isolation-e2e.test.ts
  - tests/auth/server-component-tenant-isolation.test.ts
  - tests/middleware/tenant-slug-resolution.test.ts
  - components.json
autonomous: true
requirements:
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
requirements_addressed:
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
tags:
  - better-auth
  - middleware
  - multi-tenant
  - lgpd
  - consent
  - safe-action
  - shadcn
must_haves:
  truths:
    - "User can sign up at /signup with email + password + LGPD consent checkbox; backend rejects signup if consent is missing"
    - "Verification email is generated and sent (mailpit in dev; Resend in prod)"
    - "Email verification link marks user as verified and grants session access"
    - "User can request password reset via /reset-password; receives email link; can set new password"
    - "Session persists across browser refreshes (cookie + Postgres-backed Better Auth session)"
    - "2FA TOTP enrollment available at /2fa for owner-role accounts; login flow prompts for TOTP code when enabled"
    - "Better Auth organization plugin enabled; default roles `owner` / `admin` / `member` map to TENA-08 owner/admin/viewer"
    - "TENA-05 wiring split across two layers: (1) `src/middleware.ts` resolves the tenant slug from the URL path, validates it against SYSTEM_PREFIXES, and injects `x-tenant-slug` + `x-request-id` headers — middleware does NOT set the Postgres GUC because it runs on the Edge runtime and has no DB connection; (2) `withTenant(tenantId, fn)` (Plan 03) is the ONLY place `SET LOCAL app.current_tenant_id` happens, and it is invoked from BOTH `withTenantAction` (Server Actions) AND any Server Component / Route Handler that reads tenant-scoped data (e.g. `[slug]/dashboard/page.tsx`). A Server Component that queries the singleton `db` outside `withTenant()` reads zero tenant-scoped rows (RLS default-deny) — proven by `tests/auth/server-component-tenant-isolation.test.ts`."
    - "withTenantAction() middleware: authenticates session + resolves activeOrganizationId → tenant_id → opens withTenant(tenantId) scope"
    - "Cross-tenant integration test (TENA-07): user authenticated under tenant A's session cannot read tenant B's data through any Server Action or Route Handler"
    - "Reserved slug validation: organization creation rejects slugs in SYSTEM_PREFIXES (api, login, signup, dashboard, health, ...)"
    - "Consent capture (LGPD-01): signup form requires the consent checkbox (Zod `z.literal(true)`); on signup `onSuccess`, the client calls the `recordConsentMetadata()` Server Action which extracts the IP from `headers().get('x-forwarded-for')` (and falls back to `x-real-ip`/socket address) and inserts a row into `consent_records` (Plan 05) under the active tenant context — Better Auth `additionalFields.consentIp` is `required: false` because the IP is captured server-side via this Server Action, not via Better Auth's signup payload (avoids hooking Better Auth internals). `consentVersion` and `consentAt` ARE captured directly through Better Auth `additionalFields`."
  artifacts:
    - path: "src/auth/server.ts"
      provides: "betterAuth() instance with drizzleAdapter + organization + twoFactor + emailAndPassword + additionalFields(consentVersion/consentAt required; consentIp NOT required — populated by recordConsentMetadata Server Action)"
      contains: "drizzleAdapter"
    - path: "src/app/api/auth/[...all]/route.ts"
      provides: "Better Auth Next.js handler"
    - path: "src/middleware.ts"
      provides: "Path-based tenant slug resolution + x-request-id (Edge runtime — sets headers only, does NOT touch DB)"
      contains: "x-tenant-slug"
    - path: "src/lib/actions/safe-action.ts"
      provides: "actionClient + authedAction + withTenantAction (wraps action body in withTenant())"
      contains: "next-safe-action"
    - path: "src/lib/actions/consent.ts"
      provides: "recordConsentMetadata() Server Action — captures IP server-side after signup and inserts into consent_records via withTenant()"
      contains: "recordConsentMetadata"
    - path: "src/lib/tenant.ts"
      provides: "SYSTEM_PREFIXES set + slugReserved(slug) check + resolveTenantBySlug(slug)"
    - path: "src/app/[slug]/dashboard/page.tsx"
      provides: "Tenant-scoped Server Component — reads tenant data ONLY through withTenant(tenant.id, db => ...) (not the singleton db)"
      contains: "withTenant"
    - path: "tests/auth/tenant-isolation-e2e.test.ts"
      provides: "TENA-07 dual-tenant E2E proof (Server Action layer)"
    - path: "tests/auth/server-component-tenant-isolation.test.ts"
      provides: "Proves Server Component DB access via the singleton db (no withTenant wrap) returns 0 tenant-scoped rows — documents the silent-fail failure mode TENA-05 mitigates"
  key_links:
    - from: "src/middleware.ts"
      to: "src/lib/tenant.ts"
      via: "SYSTEM_PREFIXES + slug parsing"
      pattern: "SYSTEM_PREFIXES"
    - from: "src/lib/actions/safe-action.ts"
      to: "src/db/with-tenant.ts"
      via: "withTenantAction wraps next-safe-action middleware + calls withTenant"
      pattern: "withTenant\\("
    - from: "src/app/[slug]/dashboard/page.tsx"
      to: "src/db/with-tenant.ts"
      via: "Server Component MUST wrap tenant-data reads in withTenant(tenant.id, db => ...) — singleton db reads return 0 tenant rows by RLS default-deny"
      pattern: "withTenant\\("
    - from: "src/auth/server.ts"
      to: "src/db/schema/auth.ts"
      via: "drizzleAdapter(db, { provider: 'pg' })"
      pattern: "drizzleAdapter\\(db"
    - from: "src/components/auth/signup-form.tsx"
      to: "src/lib/actions/consent.ts"
      via: "Form onSuccess calls recordConsentMetadata() which inserts consent_records row with IP from headers"
      pattern: "recordConsentMetadata"
    - from: "src/lib/actions/consent.ts"
      to: "src/db/schema/consent.ts"
      via: "import consentRecords — inserts consent evidence row (consent_version, consent_at, consent_ip) using the stub schema created by Plan 03 Task 1 (Plan 05 layers FORCE RLS + grants on top)"
      pattern: "consentRecords"
    - from: "src/auth/server.ts additionalFields"
      to: "user.consentVersion / user.consentAt columns"
      via: "Better Auth additionalFields → drizzle user table → INSERT on signup (consentIp is NOT in additionalFields; populated via consent_records by recordConsentMetadata)"
      pattern: "consentVersion|consentAt"
---

<objective>
Layer Better Auth 1.6.16 onto the Postgres RLS foundation (Plan 03), wire path-based multi-tenant resolution via `src/middleware.ts`, and ship the auth UI — signup with LGPD consent capture, login, email verification, password reset, and 2FA TOTP enrollment. End-state: a user can sign up under tenant A, verify, log in, and reach `/[slug]/dashboard` — and the cross-tenant integration test proves their session cannot leak data into tenant B's scope.

**TENA-05 wiring is split across two layers (this distinction was added in revision):**
1. **`src/middleware.ts`** (Edge runtime) — parses the tenant slug from the URL path, validates against `SYSTEM_PREFIXES`, and injects `x-tenant-slug` + `x-request-id` headers. Middleware has NO database connection (Edge runtime), so it does NOT and CANNOT issue `SET LOCAL app.current_tenant_id`. Its job is path-to-slug resolution only.
2. **`withTenant(tenantId, fn)`** (Plan 03) — the ONLY place `SET LOCAL app.current_tenant_id` runs. Every code path that reads tenant-scoped data MUST be inside a `withTenant` block:
   - `withTenantAction` (this plan, Server Actions) calls `withTenant()` automatically.
   - `[slug]/dashboard/page.tsx` and any other Server Component / Route Handler that reads tenant data MUST call `withTenant(tenant.id, db => db.query....)` explicitly.
   - If a Server Component bypasses `withTenant()` and queries the singleton `db`, it returns zero tenant-scoped rows (RLS default-deny — proven by `tests/auth/server-component-tenant-isolation.test.ts`). This is the documented silent-fail mode the checker flagged.

Purpose: Mitigates T-0-01 (cross-tenant leak end-to-end now that requests actually exist), T-0-05 (weak password hashing — Better Auth defaults to scrypt/argon2), T-0-06 (email enumeration — uniform signup responses), and T-0-08 (LGPD consent capture at signup). Provides the load-bearing surface every Phase 1+ feature builds on.

Output: Better Auth server + client + Next.js handler; `src/middleware.ts`; safe-action client chain (actionClient → authedAction → withTenantAction); `src/lib/actions/consent.ts` Server Action; shadcn-ui auth pages (signup/login/verify-email/reset-password/2fa); the dual-tenant E2E test that proves TENA-07; the Server Component isolation test that documents the silent-fail failure mode.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-VALIDATION.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-03-SUMMARY.md

<interfaces>
<!-- Required imports the executor MUST use. Pin EXACTLY. -->

dependencies (added in this plan):
  better-auth:        1.6.16   (from RESEARCH Standard Stack)
  zod:                ~4.4.3
  next-safe-action:   ~8.5.4   (Standard Schema — uses .inputSchema() NOT .schema(); see RESEARCH Pitfall #5/v7-to-v8)
  @hookform/resolvers: ~5.4.0  (MUST be ^5 for Zod 4 — RESEARCH Pitfall 2)
  react-hook-form:    ~7.78.0
  resend:             ~6.12.4  (transactional email)

# from src/db/with-tenant.ts (Plan 03):
function withTenant<T>(tenantId: string, fn: (db: DrizzleDB) => Promise<T>): Promise<T>

# Better Auth shape (RESEARCH Pattern 5):
src/auth/server.ts exports:
  const auth = betterAuth({ database: drizzleAdapter(db, { provider: 'pg' }), ... })

src/app/api/auth/[...all]/route.ts:
  import { auth } from '@/auth/server';
  import { toNextJsHandler } from 'better-auth/next-js';
  export const { POST, GET } = toNextJsHandler(auth);

# Safe action client (next-safe-action v8 — NOTE .inputSchema() not .schema()):
src/lib/actions/safe-action.ts exports:
  const actionClient: SafeActionClient                  // anonymous
  const authedAction: SafeActionClient<{userId, orgId}> // auth-gated
  const withTenantAction: SafeActionClient<{userId, orgId, tenantId}>  // auth + tenant-scoped

# Consent Server Action (this plan adds):
src/lib/actions/consent.ts exports:
  async function recordConsentMetadata(args: {
    consentVersion: string;
    consentText?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>
  // Reads IP from next/headers headers().get('x-forwarded-for') (fallback x-real-ip).
  // Inserts a row into consent_records (Plan 05) under the active tenant context via withTenant().
  // Called from signup-form.tsx onSuccess after Better Auth signUp returns.

# Middleware (RESEARCH Pattern 4 — Next.js 15 still uses middleware.ts; do NOT rename to proxy.ts):
src/middleware.ts exports `middleware(req)` and `config`.
# IMPORTANT (TENA-05 scope): middleware runs on the Edge runtime and has no DB connection.
# It sets x-tenant-slug + x-request-id headers ONLY. SET LOCAL happens in withTenant() (Plan 03).

# SYSTEM_PREFIXES — reserved slugs that must NOT become tenant identifiers:
SYSTEM_PREFIXES = new Set(['api', '_next', 'login', 'signup', 'verify-email',
  'reset-password', 'dashboard', 'health', '2fa', 'admin', 'favicon.ico',
  'robots.txt', 'sitemap.xml', 'static'])
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1a: Install packages + shadcn-ui primitives + env validation + Better Auth server/client + Next.js handler</name>
  <files>package.json, components.json, src/auth/server.ts, src/auth/client.ts, src/app/api/auth/[...all]/route.ts, src/lib/env.ts, src/components/ui/button.tsx, src/components/ui/input.tsx, src/components/ui/label.tsx, src/components/ui/form.tsx, src/components/ui/card.tsx, src/components/ui/checkbox.tsx</files>
  <read_first>
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Pattern 5: Better Auth Setup", "Pitfall 6: Better Auth additionalFields")
    - src/db/schema/auth.ts (Plan 03 Task 1)
    - .env.example (Plan 01)
  </read_first>
  <behavior>
    - All dependencies pinned (better-auth, zod, next-safe-action, react-hook-form, @hookform/resolvers, resend).
    - shadcn-ui initialized with the six base primitives (button/input/label/form/card/checkbox).
    - `src/lib/env.ts` Zod-validates all env vars (DATABASE_URL, DATABASE_MIGRATOR_URL, BETTER_AUTH_SECRET min 32, BETTER_AUTH_URL valid URL, RESEND_API_KEY, NEXT_PUBLIC_APP_URL, LOG_LEVEL enum, NODE_ENV enum, TZ).
    - `src/auth/server.ts` instantiates Better Auth with the Drizzle adapter, organization + twoFactor plugins, email/password + email verification, and `additionalFields` for `consentVersion` (required) + `consentAt` (required). `consentIp` is `required: false` because the IP is captured server-side by a separate Server Action (see Task 1b), avoiding hooks into Better Auth internals.
    - `src/auth/client.ts` exposes `authClient` with signIn/signUp/signOut/useSession.
    - `src/app/api/auth/[...all]/route.ts` mounts the Next.js handler.
  </behavior>
  <action>
    1. Install dependencies (pin exactly per RESEARCH):
       ```
       pnpm add better-auth@1.6.16 zod@~4.4.3 next-safe-action@~8.5.4 react-hook-form@~7.78.0 @hookform/resolvers@~5.4.0 resend@~6.12.4
       ```
       Critically: do NOT install `next-safe-action@7.x` or `@hookform/resolvers@4.x` — RESEARCH Pitfall 2 + Pattern v7-to-v8.

    2. Initialize shadcn-ui non-interactively if possible (or document the interactive answers in README): `pnpm dlx shadcn@latest init` choosing style=default, base-color=slate, css-variables=yes. Then:
       ```
       pnpm dlx shadcn@latest add button input label form card checkbox
       ```
       This creates `components.json` + `src/components/ui/*.tsx`.

    3. Upgrade `src/lib/env.ts` to use Zod 4 validation for: `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `BETTER_AUTH_SECRET` (min 32 chars), `BETTER_AUTH_URL` (must be a valid URL), `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `LOG_LEVEL` (enum), `NODE_ENV` (enum), `TZ`. Use `z.string().min(32)` and `z.url()` (Zod 4 syntax). Export typed `env`. Throw a friendly error on first miss in dev.

    4. Create `src/auth/server.ts` per RESEARCH Pattern 5. Critical points:
       - `database: drizzleAdapter(db, { provider: 'pg' })` — uses the fb_eventos_app `db` (so RLS applies to session reads where appropriate; the `user` table requires we set tenant context BEFORE reading sessions for tenant-scoped flows — see safe-action withTenantAction in Task 1b).
       - `emailAndPassword: { enabled: true, requireEmailVerification: true }` (AUTH-01, AUTH-02).
       - `emailVerification: { sendVerificationEmail: async ({ user, url }) => { await sendEmail({to: user.email, subject: 'Verify your FB_EVENTOS email', html: \`<a href="${url}">Verify</a>\`}); }, sendOnSignUp: true }` (AUTH-02).
       - Password reset hook via `emailAndPassword.sendResetPassword` (AUTH-03).
       - `plugins: [organization({ allowUserToCreateOrganization: true }), twoFactor({ issuer: 'FB Eventos' })]` (TENA-08, AUTH-05).
       - `session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 }` (AUTH-04: 7-day persistence with daily refresh).
       - **LGPD-01 additionalFields (REVISION: consentIp now required:false):**
         ```typescript
         user: {
           additionalFields: {
             consentVersion: { type: 'string', required: true },
             consentAt: { type: 'string', required: true },
             consentIp: { type: 'string', required: false },  // populated by recordConsentMetadata Server Action (Task 1b)
           }
         }
         ```
         Rationale: Better Auth's signUp payload comes from the browser; an IP set by the browser is not trustworthy. We mark `consentIp` as `required: false` here and populate it from the server-side `headers().get('x-forwarded-for')` via a separate Server Action `recordConsentMetadata()` (Task 1b) called from the signup form's onSuccess callback. This avoids hooking Better Auth internals and gives us audit-grade IP capture inside `consent_records` (Plan 05).
       - `trustedOrigins: [env.BETTER_AUTH_URL]`.

    5. Create `src/auth/client.ts`:
       ```typescript
       import { createAuthClient } from 'better-auth/react';
       export const authClient = createAuthClient({ baseURL: env.NEXT_PUBLIC_APP_URL });
       export const { signIn, signUp, signOut, useSession } = authClient;
       ```

    6. Create `src/app/api/auth/[...all]/route.ts`:
       ```typescript
       import { auth } from '@/auth/server';
       import { toNextJsHandler } from 'better-auth/next-js';
       export const { POST, GET } = toNextJsHandler(auth);
       ```

    Per D-02 (researcher reconciliation): `next-safe-action@~8.5.4` — `.inputSchema()` not `.schema()` (used in Task 1b). Per D-03: `@hookform/resolvers@~5.x` for Zod 4.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && pnpm lint && grep -q 'toNextJsHandler' src/app/api/auth/\[...all\]/route.ts && grep -q 'twoFactor' src/auth/server.ts && grep -q 'organization' src/auth/server.ts && grep -q 'consentVersion' src/auth/server.ts && grep -q 'consentAt' src/auth/server.ts && grep -E "consentIp.*required:\\s*false" src/auth/server.ts && test -f components.json && test -f src/components/ui/button.tsx && test -f src/components/ui/checkbox.tsx && node -e "const p=require('./package.json');if(!/~?8\.5\./.test(p.dependencies['next-safe-action']))process.exit(1);if(!/~?5\./.test(p.dependencies['@hookform/resolvers']))process.exit(2);if(!/~?1\.6\./.test(p.dependencies['better-auth']))process.exit(3);if(!/~?4\.4\./.test(p.dependencies['zod']))process.exit(4)"</automated>
  </verify>
  <acceptance_criteria>
    - `package.json` `dependencies`: `better-auth ~1.6.16`, `next-safe-action ~8.5.4`, `@hookform/resolvers ~5.4.0`, `zod ~4.4.3`, `react-hook-form ~7.78.0`, `resend ~6.12.4`
    - `src/auth/server.ts` contains: `drizzleAdapter(db, { provider: 'pg' })`, `emailAndPassword.enabled: true`, `requireEmailVerification: true`, `sendOnSignUp: true`, `organization({...})`, `twoFactor({...})`, `consentVersion` + `consentAt` with `required: true`, AND `consentIp` with `required: false`
    - `src/app/api/auth/[...all]/route.ts` exports `GET` and `POST` from `toNextJsHandler(auth)`
    - shadcn-ui initialized (`components.json` exists) with button/input/label/form/card/checkbox primitives
  </acceptance_criteria>
  <done>Packages installed at pinned versions; Better Auth server + client + handler wired; `consentIp` correctly marked `required:false` (populated later via Server Action); shadcn-ui ready for forms.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 1b: Middleware + tenant lib + email lib + safe-action chain + consent Server Action + migration 0003 + middleware test</name>
  <files>src/middleware.ts, src/lib/tenant.ts, src/lib/email.ts, src/lib/actions/safe-action.ts, src/lib/actions/consent.ts, src/db/schema/auth.ts, src/db/migrations/0003_better_auth_extras.sql, tests/middleware/tenant-slug-resolution.test.ts</files>
  <read_first>
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Pattern 4: middleware.ts", "next-safe-action v8 Client Setup", "Pitfall 7: Reserved Slug Collision")
    - src/auth/server.ts (Task 1a)
    - src/db/schema/auth.ts (Plan 03 Task 1)
    - src/db/with-tenant.ts (Plan 03 Task 3)
    - src/db/schema/consent.ts (Plan 03 Task 1 — consent_records stub schema; Plan 05 layers grants and RLS on top)
  </read_first>
  <behavior>
    - `src/middleware.ts` (Edge runtime): reads the first URL path segment; if it is in `SYSTEM_PREFIXES`, it is NOT treated as a tenant slug. Otherwise, the segment is set as `x-tenant-slug` header. Every request gets a `x-request-id` (preserved from inbound or generated via `crypto.randomUUID()`). **TENA-05 scope clarification:** middleware does NOT issue `SET LOCAL app.current_tenant_id` — that GUC is set exclusively inside `withTenant()` (Plan 03), called by both `withTenantAction` (Server Actions) AND any Server Component / Route Handler that reads tenant data (e.g. `[slug]/dashboard/page.tsx` in Task 2). Middleware on Edge has no DB connection by design.
    - `src/lib/tenant.ts` exports `SYSTEM_PREFIXES`, `slugReserved(slug): boolean`, and `resolveTenantBySlug(slug): Promise<{ id, slug, name } | null>` (queries `tenants` table via the global `db` — `tenants` has no RLS).
    - `src/lib/email.ts` wraps `resend` for production AND a dev fallback that posts to `mailpit` on `localhost:1025` via SMTP.
    - `src/lib/actions/safe-action.ts` exports three clients: `actionClient` (no auth), `authedAction` (requires Better Auth session — uses `auth.api.getSession()`), `withTenantAction` (requires session AND `session.activeOrganizationId` AND wraps `withTenant(tenantId)` around the action body).
    - `src/lib/actions/consent.ts` exports `recordConsentMetadata({ consentVersion, consentText? })` Server Action. It uses `next/headers` `headers().get('x-forwarded-for')` (fallback `x-real-ip`) to extract the client IP server-side, looks up the active tenant via `auth.api.getSession()` → `session.activeOrganizationId` → `resolveTenantBySlug` (or org→tenant mapping), and inserts a row into `consent_records` (Plan 05's `src/db/schema/consent.ts`) wrapped in `withTenant(tenantId, ...)`. If no active tenant yet (signup race condition), the action falls back to inserting with `tenant_id = null` (consent_records allows nullable tenant_id per Plan 05 schema).
    - Better Auth's auto-extra columns (like `session.activeOrganizationId`) live in migration `0003_better_auth_extras.sql`.
    - Tenant slug resolution unit test verifies SYSTEM_PREFIXES exclusion, reserved-slug rejection, and request-id generation.
  </behavior>
  <action>
    1. Create `src/lib/tenant.ts`:
       ```typescript
       export const SYSTEM_PREFIXES = new Set([
         'api', '_next', 'login', 'signup', 'verify-email', 'reset-password',
         'dashboard', 'health', '2fa', 'admin', 'favicon.ico', 'robots.txt',
         'sitemap.xml', 'static', 'public'
       ]);
       export function slugReserved(slug: string): boolean { return SYSTEM_PREFIXES.has(slug.toLowerCase()); }
       export async function resolveTenantBySlug(slug: string) {
         // SELECT id, slug, name FROM tenants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1
       }
       ```

    2. Create `src/lib/email.ts` exporting `sendEmail({to, subject, html})`. In `NODE_ENV=production`, uses `Resend(env.RESEND_API_KEY).emails.send(...)`. In dev/test, posts to mailpit via direct SMTP using a small `nodemailer` instance (add `pnpm add -D nodemailer @types/nodemailer` if needed) targeting `mailpit:1025` from `docker/compose.yml`.

    3. Create `src/middleware.ts` per RESEARCH Pattern 4. Critical:
       - File name MUST be `middleware.ts` (NOT `proxy.ts` — that's Next 16 only; we pin 15 — RESEARCH Pitfall 1).
       - Generate `x-request-id` (`crypto.randomUUID()`) if not present; forward on request and response headers.
       - Parse first path segment; if NOT in SYSTEM_PREFIXES, set `x-tenant-slug` header.
       - Add a header-of-the-file comment block documenting the TENA-05 split: "Middleware runs on Edge — no DB. It only sets x-tenant-slug + x-request-id headers. SET LOCAL app.current_tenant_id is the exclusive responsibility of withTenant() (src/db/with-tenant.ts, Plan 03), called from withTenantAction (Server Actions, this file's sibling safe-action.ts) AND from Server Components / Route Handlers that read tenant data."
       - Export `config.matcher` excluding `_next/static`, `_next/image`, `favicon.ico`, `robots.txt`.

    4. Create `src/lib/actions/safe-action.ts` per RESEARCH "next-safe-action v8 Client Setup":
       - `actionClient = createSafeActionClient()`
       - `authedAction = actionClient.use(async ({next}) => { const session = await auth.api.getSession({headers: await headers()}); if (!session) throw new Error('Unauthorized'); return next({ ctx: { userId: session.user.id, orgId: session.session.activeOrganizationId } }); })`
       - `withTenantAction = authedAction.use(async ({next, ctx}) => { if (!ctx.orgId) throw new Error('No active organization'); const tenant = await resolveTenantBySlug(<derived from orgId>); ... return next({ ctx: { ...ctx, tenantId: tenant.id } }); })`
       - Wrap the actual server action body in `withTenant(ctx.tenantId, async (db) => ...)` so RLS is enforced inside.
       - NOTE: use `.inputSchema(z.object(...))` (v8 API), NOT `.schema()` (v7).

    5. Create `src/lib/actions/consent.ts` (NEW — replaces the Better Auth additionalFields IP-capture pathway):
       ```typescript
       'use server';
       import { headers } from 'next/headers';
       import { auth } from '@/auth/server';
       import { db } from '@/db';
       import { withTenant } from '@/db/with-tenant';
       import { consentRecords } from '@/db/schema/consent';  // Plan 05
       import { resolveTenantBySlug } from '@/lib/tenant';
       import { z } from 'zod';

       const inputSchema = z.object({
         consentVersion: z.string().min(1),
         consentText: z.string().optional(),
       });

       export async function recordConsentMetadata(raw: unknown) {
         const parsed = inputSchema.safeParse(raw);
         if (!parsed.success) return { ok: false as const, error: 'invalid_input' };

         const h = await headers();
         const fwd = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '';
         const ip = (fwd.split(',')[0] ?? '').trim() || 'unknown';
         const userAgent = h.get('user-agent') ?? null;

         const session = await auth.api.getSession({ headers: h });
         if (!session) return { ok: false as const, error: 'no_session' };

         const userId = session.user.id;
         const orgId = session.session.activeOrganizationId;

         // Look up tenant_id for the active org (Phase 0 schema: orgId IS the tenant identifier
         // via the organization → tenant slug mapping; if no orgId yet during signup, fall back to null).
         let tenantId: string | null = null;
         if (orgId) {
           // The mapping from orgId to tenant_id depends on Plan 03/04 schema:
           // For Phase 0, organization.tenant_id is the tenant_id directly (we model org-as-tenant).
           // resolveTenantBySlug or a direct organization lookup gives us the tenant_id.
           // Implementation detail: query organization table for the row matching orgId, read its tenant_id.
           tenantId = await fetchTenantIdForOrg(orgId);  // helper inline
         }

         const insert = async (scopedDb: typeof db) => {
           await scopedDb.insert(consentRecords).values({
             userId,
             tenantId,
             consentVersion: parsed.data.consentVersion,
             consentText: parsed.data.consentText ?? null,
             ipAddress: ip,
             userAgent,
           });
         };

         if (tenantId) {
           await withTenant(tenantId, insert);
         } else {
           // consent_records allows tenant_id NULL (Plan 05) for pre-signup / no-org consent
           await insert(db);
         }

         return { ok: true as const };
       }

       async function fetchTenantIdForOrg(orgId: string): Promise<string | null> {
         // SELECT tenant_id FROM organization WHERE id = $1 LIMIT 1
         // Returns null if not found.
         // ...
         return null;
       }
       ```
       Notes:
       - The IP capture happens server-side via `next/headers` — never trusts a client-supplied value.
       - The Server Action is callable from the signup form's `onSuccess` callback (Task 2) AFTER Better Auth's signup completes (so a session and active org exist).
       - For LGPD audit-grade evidence, the row in `consent_records` (Plan 05) is the source of truth. Better Auth's `user.consentIp` column remains nullable.

    6. Add a column for `activeOrganizationId` on the Better Auth `session` table if Better Auth's auto-migration didn't add it. Generate migration `0003_better_auth_extras.sql` covering: (a) Better Auth required extras for org plugin, (b) any column Plan 03's hand-written schema missed. Run `pnpm db:generate` to let drizzle-kit emit any structural fixups; commit the generated SQL. Confirm `user.consent_ip` column is `nullable` (matches Task 1a's `required:false`).

    7. Create `tests/middleware/tenant-slug-resolution.test.ts`:
        - Test 1: `slugReserved('api')` returns true; `slugReserved('acme-corp')` returns false.
        - Test 2: middleware against `GET /acme-corp/dashboard` sets `x-tenant-slug: acme-corp`.
        - Test 3: middleware against `GET /api/health` does NOT set `x-tenant-slug`.
        - Test 4: middleware always sets `x-request-id` (uses `crypto.randomUUID()` if absent).
        - Test 5: middleware does NOT touch the DB — explicit test that no postgres connection is made (use a Node mock on `postgres()` from `postgres` package; assert it was not called within middleware execution). Documents the TENA-05 split.
        - Use Next.js's `NextRequest` constructor + call the exported `middleware(req)` directly.

    Per CLAUDE.md AuthMiddleware admin bypass concern: do NOT add an "admin" role that bypasses checks. Use Better Auth org plugin roles `owner`/`admin`/`member` with explicit per-action role checks (set up here, enforced in domain-feature plans of Phase 1+).
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && pnpm lint && pnpm db:generate && pnpm db:migrate && pnpm test:unit tests/middleware/ && test -f src/middleware.ts && grep -q 'middleware' src/middleware.ts && grep -q 'SYSTEM_PREFIXES' src/middleware.ts && grep -qE 'Edge|set_config|SET LOCAL' src/middleware.ts && test -f src/lib/actions/consent.ts && grep -q 'recordConsentMetadata' src/lib/actions/consent.ts && grep -q "x-forwarded-for" src/lib/actions/consent.ts && grep -q 'withTenant' src/lib/actions/consent.ts && grep -q 'inputSchema' src/lib/actions/safe-action.ts && ! grep -q '\.schema(' src/lib/actions/safe-action.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/middleware.ts` file name is exactly `middleware.ts` (NOT `proxy.ts`); contains literal `SYSTEM_PREFIXES`; sets `x-tenant-slug` and `x-request-id` headers; contains a comment block documenting the TENA-05 split (middleware does NOT issue SET LOCAL)
    - `src/lib/tenant.ts` exports `SYSTEM_PREFIXES`, `slugReserved`, `resolveTenantBySlug`
    - `src/lib/actions/safe-action.ts` uses `.inputSchema()` (NOT `.schema()`); exports `actionClient`, `authedAction`, `withTenantAction`
    - `src/lib/actions/consent.ts` exports `recordConsentMetadata`; reads IP from `next/headers` `x-forwarded-for` (fallback `x-real-ip`); inserts into `consent_records` via `withTenant` when tenant is known
    - `tests/middleware/tenant-slug-resolution.test.ts` exists with 5+ test cases (incl. one that asserts middleware does not touch DB); `pnpm test:unit tests/middleware/` exits 0
    - Migration `0003_better_auth_extras.sql` applied; `pnpm db:check` exits 0; `user.consent_ip` column is nullable
  </acceptance_criteria>
  <done>Middleware resolves tenant slug with SYSTEM_PREFIXES guard; safe-action client chain ready; consent IP capture wired through a server-side Server Action (recordConsentMetadata) using next/headers — Better Auth additionalFields no longer carry the IP, which is now audit-grade-trustworthy because it never crosses the client boundary.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Auth UI pages (signup with LGPD consent / login / verify-email / reset-password / 2fa) + tenant dashboard stub + signup-form wiring to recordConsentMetadata</name>
  <files>src/app/(auth)/signup/page.tsx, src/app/(auth)/login/page.tsx, src/app/(auth)/verify-email/page.tsx, src/app/(auth)/reset-password/page.tsx, src/app/(auth)/2fa/page.tsx, src/app/[slug]/dashboard/page.tsx, src/app/page.tsx, src/components/auth/signup-form.tsx, src/components/auth/login-form.tsx, src/components/auth/reset-password-form.tsx</files>
  <read_first>
    - src/auth/server.ts (Task 1a)
    - src/auth/client.ts (Task 1a)
    - src/lib/actions/safe-action.ts (Task 1b)
    - src/lib/actions/consent.ts (Task 1b)
    - src/components/ui/* (Task 1a — shadcn)
    - src/db/with-tenant.ts (Plan 03)
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (section "Pattern 5")
  </read_first>
  <behavior>
    - `/signup` renders a form: email, password (min 12 chars), name, organization name, organization slug (validated against SYSTEM_PREFIXES client-side AND server-side), LGPD consent checkbox (REQUIRED) referencing `docs/LGPD.md`. Submission calls `authClient.signUp.email({...})` with `consentVersion='2026-06-01'`, `consentAt=new Date().toISOString()` — `consentIp` is NOT passed from the client. After Better Auth's signUp returns success, the form's `onSuccess` callback invokes `recordConsentMetadata({ consentVersion: '2026-06-01', consentText: <wording snapshot> })` (Task 1b) — the Server Action extracts the IP from `headers()` and inserts the audit-grade row into `consent_records`. If slug is reserved → form-level error. If consent unchecked → form prevented from submitting + backend rejects (Better Auth additionalFields `consentVersion` is `required:true`, so empty consent metadata fails at the Better Auth layer too).
    - `/login` renders email+password; on success redirects to `/[org-slug]/dashboard` (read from session.activeOrganizationId → tenants.slug).
    - `/verify-email` is the landing page Better Auth redirects to after clicking the link; displays "Email verified ✓" if URL token validates, otherwise error.
    - `/reset-password` has two sub-flows: (a) request reset (email field) → POSTs to Better Auth reset endpoint → "If the email exists you'll receive a link" (uniform response — mitigates T-0-06 email enumeration); (b) consume reset token (when query string has token) → new password form → submit.
    - `/2fa` allows owner-role users to enroll TOTP and view recovery codes.
    - `/[slug]/dashboard` is a protected Server Component that: looks up tenant by slug (`resolveTenantBySlug`), requires session, requires session.activeOrganizationId matches the slug's tenant_id, then **reads tenant data via `withTenant(tenant.id, db => db.query....)`** — NOT via the singleton `db`. Renders a tiny "Welcome to {tenant.name}" page. The `withTenant` wrap is mandatory even though the dashboard initially shows only `tenant.name` (which is read from `tenants` global lookup), because the architectural pattern enforces it for every page that will later add tenant-scoped queries.
    - `/` (landing): if logged in → redirect to first-org dashboard; else → links to /signup, /login.
  </behavior>
  <action>
    Mitigates T-0-06 (email enumeration) by ensuring signup AND reset-password emit identical responses on collision/non-existence. Mitigates T-0-08 (LGPD consent at signup) at the UI layer (backend already enforces via additionalFields `consentVersion` required:true from Task 1a + audit row from Task 1b).

    1. Use shadcn `<Form>`, `<Input>`, `<Label>`, `<Button>`, `<Card>`, `<Checkbox>` primitives for all auth pages.

    2. Build `src/components/auth/signup-form.tsx` (client component) using react-hook-form + `@hookform/resolvers@5` + Zod 4 schema (`email`, `password` min 12, `name` min 2, `orgName` min 2, `orgSlug` regex `/^[a-z][a-z0-9-]{2,30}$/`, `consent` `z.literal(true, { message: 'LGPD consent required' })`). Client-side slug validation: reject if SYSTEM_PREFIXES.has(slug). On submit:
       ```typescript
       const consentVersion = '2026-06-01';
       const consentAt = new Date().toISOString();
       const result = await authClient.signUp.email({
         email, password, name,
         organizationName: orgName,
         organizationSlug: orgSlug,
         consentVersion,
         consentAt,
         // consentIp deliberately NOT sent from client — captured server-side
       });
       if (!result.error) {
         // Record audit-grade consent evidence (IP from server headers)
         await recordConsentMetadata({ consentVersion, consentText: LGPD_CONSENT_TEXT_V1 });
         router.replace(`/${orgSlug}/dashboard`);
       }
       ```
       Import `recordConsentMetadata` from `@/lib/actions/consent` (Server Action — invoked from the client form, runs server-side).

    3. Build `src/components/auth/login-form.tsx` (client) — calls `authClient.signIn.email({email, password})`. On success: read session, look up tenant slug, `router.replace(\`/${slug}/dashboard\`)`. On error: generic "Invalid credentials" (not "user not found" — T-0-06).

    4. Build `src/components/auth/reset-password-form.tsx` (client) — two modes detected by `searchParams.token`:
        - Mode "request": email field → `authClient.forgetPassword({email, redirectTo: '/reset-password'})`; show uniform "If an account exists you'll receive an email" regardless of result.
        - Mode "consume": password fields → `authClient.resetPassword({newPassword, token})`.

    5. Pages:
       - `src/app/(auth)/signup/page.tsx` — wraps `<SignupForm />` in a Card with the LGPD consent text snippet and link to `/docs/lgpd` (or the placeholder path) — documents `docs/LGPD.md` exists in Plan 05.
       - `src/app/(auth)/login/page.tsx`, `verify-email/page.tsx`, `reset-password/page.tsx`, `2fa/page.tsx` — analogous server components rendering their respective forms.
       - `src/app/[slug]/dashboard/page.tsx` — server component. Read session via `auth.api.getSession({ headers: await headers() })`. If no session → redirect to `/login`. Look up tenant by slug. If `session.session.activeOrganizationId !== tenant.id` → return 403 ("You do not have access to this organization"). Then **wrap any tenant-scoped read in `withTenant(tenant.id, async db => { /* future queries */ return { greeting: \`Welcome, ${session.user.name}, to ${tenant.name}!\` }; })`**. Even for Phase 0's no-tenant-query case, the wrap is present (verified by acceptance criteria grep) so the pattern is established. **Anti-pattern to AVOID:** querying the singleton `db` from this page for tenant-scoped data — that returns 0 rows silently. The next task adds a test that proves this failure mode.
       - `src/app/page.tsx` — landing: link to /signup, /login; if `getSession()` succeeds → server-side redirect to first org's dashboard.

    6. Update `src/lib/email.ts` if needed so the email URLs include the correct app URL (`env.BETTER_AUTH_URL`) — verification + reset URLs hit `/verify-email?token=...` and `/reset-password?token=...`.

    Per LGPD-01/T-0-08: signup without `consent=true` MUST be rejected at the backend (Better Auth additionalFields `consentVersion` with `required:true` enforces this — Task 1a) AND prevented at the UI (Zod schema requires `z.literal(true)` — this task) AND audit-grade IP capture happens via `recordConsentMetadata()` (Task 1b). Defense in depth.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && pnpm lint && pnpm build && test -f "src/app/(auth)/signup/page.tsx" && test -f "src/app/(auth)/login/page.tsx" && test -f "src/app/(auth)/verify-email/page.tsx" && test -f "src/app/(auth)/reset-password/page.tsx" && test -f "src/app/(auth)/2fa/page.tsx" && test -f "src/app/[slug]/dashboard/page.tsx" && grep -q 'withTenant' "src/app/[slug]/dashboard/page.tsx" && grep -q 'consent' src/components/auth/signup-form.tsx && grep -qE "z\.literal\(true" src/components/auth/signup-form.tsx && grep -q 'recordConsentMetadata' src/components/auth/signup-form.tsx</automated>
  </verify>
  <acceptance_criteria>
    - All five auth pages exist under `src/app/(auth)/` and compile via `pnpm build`
    - `src/app/[slug]/dashboard/page.tsx` exists, is a server component, verifies session AND tenant slug match, AND contains a `withTenant(tenant.id, ...)` call (verified by grep — establishes the pattern even for the no-query Phase 0 case)
    - `src/components/auth/signup-form.tsx` Zod schema requires `consent: z.literal(true, ...)` (regex match `z\.literal\(true`)
    - `src/components/auth/signup-form.tsx` rejects slugs in SYSTEM_PREFIXES (client-side check imported from `@/lib/tenant`)
    - `src/components/auth/signup-form.tsx` calls `recordConsentMetadata(...)` after a successful Better Auth signUp (grep matches `recordConsentMetadata`)
    - `src/components/auth/login-form.tsx` shows generic "Invalid credentials" (no user-existence leak)
    - `src/components/auth/reset-password-form.tsx` shows uniform "If an account exists..." on request mode
    - `pnpm build` exits 0
    - `pnpm lint` exits 0
  </acceptance_criteria>
  <done>Auth UI exists end-to-end; signup captures LGPD consent at backend (additionalFields required for consentVersion/consentAt), frontend (Zod literal), AND server-side via recordConsentMetadata for audit-grade IP evidence; reset-password and login emit uniform responses to mitigate email enumeration; the `/[slug]/dashboard` route establishes the withTenant pattern.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Integration tests — signup/verify/login/reset/2FA happy paths + TENA-07 cross-tenant E2E isolation + Server Component isolation failure-mode test</name>
  <files>tests/auth/signup.test.ts, tests/auth/session-persist.test.ts, tests/auth/password-reset.test.ts, tests/auth/two-factor.test.ts, tests/auth/tenant-isolation-e2e.test.ts, tests/auth/server-component-tenant-isolation.test.ts, src/test/auth-helpers.ts</files>
  <read_first>
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-VALIDATION.md (section "Phase Requirements → Test Map")
    - src/auth/server.ts (Task 1a)
    - src/lib/actions/safe-action.ts (Task 1b)
    - src/lib/actions/consent.ts (Task 1b)
    - src/app/[slug]/dashboard/page.tsx (Task 2)
    - src/db/with-tenant.ts (Plan 03)
    - tests/db/rls-forced.test.ts (Plan 03 Task 3 — pattern for two-tenant fixtures)
  </read_first>
  <behavior>
    - signup.test.ts: POST /api/auth/sign-up/email with valid payload + consent → 200 + verification row exists + user row exists + `consent_version` populated. Same payload without consent (missing `consentVersion`) → 400 + no user row created. After successful signup, a row in `consent_records` is present with the IP from the request headers (verifies `recordConsentMetadata` path).
    - session-persist.test.ts (AUTH-04): Sign up + verify (manually mark `emailVerified=true` via migratorPool) + sign in → session row exists in `session` table with future `expiresAt`; cookie returned; second request with cookie returns the same session.
    - password-reset.test.ts: POST request-reset for existing email → 200 + verification token row created + email "sent" (capture via mailpit API or a stub spy). POST request-reset for non-existent email → identical 200 (no leak — T-0-06). Consume token → password updated; old credentials no longer log in.
    - two-factor.test.ts (AUTH-05): User enables TOTP → returns secret + recovery codes. Login flow with TOTP enabled returns "2fa-required" intermediate state; supplying valid TOTP completes login.
    - tenant-isolation-e2e.test.ts (TENA-07 — LOAD-BEARING): Two tenants A+B. Create user A in tenant A, user B in tenant B. Sign in as user A (cookie captured). Hit an action that reads from a tenant-scoped table via `withTenantAction`. User A sees only tenant A's organization. Then forge a request as user A but with `x-tenant-slug: tenant-b` → action MUST throw / return 403 because session's activeOrganizationId does not match. Also try without `withTenant` wrapper directly via the appPool: returns 0 rows (RLS default-deny).
    - **server-component-tenant-isolation.test.ts (NEW — closes the TENA-05 silent-fail loop):** Simulates what happens when a Server Component (e.g. a careless future page) reads tenant data via the singleton `db` WITHOUT wrapping in `withTenant()`. Seeds rows for tenant A. Imports the singleton `db` from `@/db` directly (no withTenant wrap). Queries `db.select().from(organization)` (or any tenant-scoped table). Asserts the result is `[]` (zero rows). This documents the failure mode TENA-05 mitigates: forgetting `withTenant()` in a Server Component does not leak data — it silently returns empty. The test serves as the load-bearing proof for the TENA-05 truth in must_haves.
  </behavior>
  <action>
    Mitigates T-0-01 by closing the loop end-to-end: schema-level RLS (Plan 03) + middleware header injection (Task 1b) + Server Action gate (Task 1b) + Server Component withTenant pattern (Task 2) all together prove TENA-07; the Server Component isolation test documents the TENA-05 silent-fail mode.

    1. Create `src/test/auth-helpers.ts`: helpers for `signUpUser({tenantSlug, email, password, name})` (POSTs to `/api/auth/sign-up/email` via the auth handler — use `auth.handler(req)` directly without a HTTP server, supplying realistic `x-forwarded-for` header so `recordConsentMetadata` can read it), `verifyEmail(userId)` (via migratorPool, sets `emailVerified=true`), `signInUser({email, password})` (returns cookie). For 2FA: helper to enroll + generate TOTP via `otpauth` lib if needed (or capture the secret from enrollment and compute the code).

    2. `tests/auth/signup.test.ts`: four tests:
       - Happy path: signup with consent → 200 + user row + consent_records row with IP populated from forged `x-forwarded-for`.
       - Missing consent (no `consentVersion` field) → 400 + 0 user rows.
       - Duplicate email → uniform error (no enumeration).
       - `recordConsentMetadata` independently callable post-signup: assert the consent row exists with IP from headers (proves Task 1b's wiring).

    3. `tests/auth/session-persist.test.ts`: AUTH-04 — verify session row in DB + cookie + second request honors cookie.

    4. `tests/auth/password-reset.test.ts`: AUTH-03 + T-0-06 — request flow happy path, request flow for unknown email returns identical 200, consume flow updates password.

    5. `tests/auth/two-factor.test.ts`: AUTH-05 — enroll + verify TOTP works in login flow.

    6. `tests/auth/tenant-isolation-e2e.test.ts` (TENA-07 — LOAD-BEARING for the entire phase contract):
       - Setup (via migratorPool): create tenants `acme` (id=A) and `globex` (id=B); create user `alice@acme.example` with verified email + member of org A; create user `bob@globex.example` member of org B.
       - Test 1: signed-in Alice calls a Server Action that lists organizations she's a member of (`withTenantAction` with action body `withTenant(ctx.tenantId, db => db.select().from(organization))`). Returns exactly 1 org (acme).
       - Test 2: signed-in Alice forges a request with `Cookie: <alice-session>` but `x-tenant-slug: globex`. `withTenantAction` middleware verifies session.activeOrganizationId === tenantBySlug.id and rejects with "Active org mismatch" → 403.
       - Test 3: appPool direct query (no `withTenant`): `SELECT * FROM organization` returns 0 rows (RLS default-deny). Same query inside `withTenant(A.id)` returns acme's row only. Same query inside `withTenant(B.id)` returns globex's row only. Never both.

    7. `tests/auth/server-component-tenant-isolation.test.ts` (NEW — documents the TENA-05 silent-fail mode):
       ```typescript
       import { test, expect, beforeAll } from 'vitest';
       import { db } from '@/db';
       import { organization } from '@/db/schema/auth';
       import { withTenant } from '@/db/with-tenant';
       import { migratorPool, createTenant } from '@/test/db';

       let tenantId: string;
       beforeAll(async () => {
         tenantId = await createTenant('alpha', 'Alpha Corp');
         // Seed an organization row in tenant alpha
         await migratorPool`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
         await migratorPool`
           INSERT INTO organization (id, name, slug, tenant_id)
           VALUES (gen_random_uuid(), 'Alpha', 'alpha', ${tenantId})
         `;
       });

       test('TENA-05 silent-fail: Server Component reading singleton db without withTenant returns 0 tenant rows', async () => {
         // Simulates a careless Server Component that bypasses withTenant().
         // RLS default-deny means the query returns [] instead of leaking data.
         const rows = await db.select().from(organization);
         expect(rows.length).toBe(0);
       });

       test('TENA-05 happy path: same query inside withTenant returns the row', async () => {
         const rows = await withTenant(tenantId, async (scopedDb) =>
           scopedDb.select().from(organization)
         );
         expect(rows.length).toBe(1);
         expect(rows[0]?.slug).toBe('alpha');
       });
       ```
       Header comment on the file: "This test is the load-bearing proof for the TENA-05 must_haves truth that Server Component DB access outside withTenant() is silent-default-deny rather than leak. If this test ever passes the first assertion with `rows.length > 0`, RLS is broken — STOP and fix Plan 03's FORCE RLS migration."

    8. Wire these tests into `pnpm test:unit` (vitest picks up `tests/**`). Run `pnpm test:unit` — all must pass.

    Per CLAUDE.md "implicit admin overrides all roles": none of these tests exercise an "admin bypass" path; if any role-based shortcut is found, fix the auth config (Task 1a) — do NOT add suppression to the tests.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm db:up && sleep 3 && pnpm db:migrate && pnpm test:unit tests/auth/ && pnpm test:unit tests/auth/tenant-isolation-e2e.test.ts && pnpm test:unit tests/auth/server-component-tenant-isolation.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/auth/signup.test.ts` has 4+ tests; all pass; the "missing consent" test confirms HTTP 400 and 0 rows created; happy path asserts a `consent_records` row exists with the forged IP
    - `tests/auth/session-persist.test.ts` confirms session row + cookie + second request reuses session
    - `tests/auth/password-reset.test.ts` confirms unknown-email returns identical response to known-email (regex check on response body)
    - `tests/auth/two-factor.test.ts` confirms TOTP enrollment + verification end-to-end
    - `tests/auth/tenant-isolation-e2e.test.ts` has 3+ tests covering: (a) Alice sees only acme, (b) Alice's session with x-tenant-slug: globex is rejected, (c) appPool direct query returns 0 without withTenant
    - `tests/auth/server-component-tenant-isolation.test.ts` exists with 2 test cases (singleton-db = 0 rows; withTenant = 1 row) — closes the TENA-05 silent-fail documentation gap
    - `pnpm test:unit` exits 0 with at least 17 test cases across `tests/auth/` and `tests/middleware/`
    - All tests run via Vitest (no manual setup); CI `test` job (Plan 02) runs them on every PR
  </acceptance_criteria>
  <done>Five Better Auth flows (signup/verify/login/reset/2FA) covered by integration tests; TENA-07 dual-tenant isolation proven end-to-end through the full stack (middleware header + Server Action + RLS); TENA-05 silent-fail mode documented and proven by server-component-tenant-isolation.test.ts; CI runs everything on every PR.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → /api/auth/* | Better Auth handler validates input + Zod schema + verifies email-verification token signature |
| Cookie → session lookup | Postgres `session` table is source of truth; cookie carries opaque session id only |
| Request path → tenant slug | middleware.ts parses + validates against SYSTEM_PREFIXES; downstream withTenantAction verifies activeOrganizationId match |
| Edge middleware → Postgres GUC | NO direct connection — middleware sets headers only; SET LOCAL happens exclusively inside withTenant() (Plan 03) |
| Server Action input → DB | next-safe-action v8 + Zod 4 inputSchema validates before action body runs |
| Server Component DB read → tenant data | MUST be wrapped in withTenant(); bypass returns 0 rows by RLS default-deny (proven by server-component-tenant-isolation.test.ts) |
| Browser → server (consent IP) | Client cannot forge consentIp; IP captured server-side via next/headers `x-forwarded-for` inside recordConsentMetadata Server Action |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-0-01 | Information Disclosure (high) | end-to-end request → tenant data | mitigate | Plan 03 RLS + Task 1b withTenantAction (checks activeOrganizationId) + Task 3 tenant-isolation-e2e.test.ts proves it + Task 3 server-component-tenant-isolation.test.ts documents the silent-fail safety net |
| T-0-05 | Tampering / EoP (medium) | password storage | mitigate | Better Auth defaults to scrypt (verified in better-auth docs); password min 12 chars enforced by Zod schema in signup form |
| T-0-06 | Information Disclosure (medium) | signup + reset password responses | mitigate | Uniform responses on signup duplicate ("If an account exists...") + on reset for unknown email; signup with missing consent returns 400 not 409 |
| T-0-08 | Compliance / Tampering (high) | LGPD consent capture at signup | mitigate | additionalFields `consentVersion`/`consentAt` required:true in Better Auth (backend rejects without consent) + Zod literal(true) in form (frontend prevents) + recordConsentMetadata Server Action writes audit-grade IP to consent_records + tests/auth/signup.test.ts asserts all three |
| (RESEARCH Pitfall 6) | Tampering | additionalFields not in DB | mitigate | Plan 03 Task 1 already added consent_* columns to drizzle user schema; migration 0001 created them; this plan's Task 1a ties additionalFields → those columns (consentIp nullable per revision) |
| (RESEARCH Pitfall 7) | EoP | reserved slug collision | mitigate | SYSTEM_PREFIXES set + slugReserved() + UI-level + server-level rejection on signup |
| (TENA-05 silent-fail) | Information Disclosure | Server Component bypasses withTenant() | mitigate | RLS default-deny returns 0 rows + Task 3 server-component-tenant-isolation.test.ts documents the mode so future devs cannot misread silent-fail as "RLS broken" |
</threat_model>

<verification>
1. `pnpm build` succeeds end-to-end (all auth pages and middleware compile).
2. `pnpm test:unit tests/auth/ tests/middleware/` exits 0 with at least 17 test cases.
3. `tests/auth/tenant-isolation-e2e.test.ts` passes — closes the loop on TENA-07.
4. `tests/auth/server-component-tenant-isolation.test.ts` passes — closes the TENA-05 silent-fail documentation gap.
5. Manual smoke (dev only): `pnpm db:up && pnpm dev`; visit `localhost:3000/signup`, sign up `alice@acme.example` with consent → check mailpit (`localhost:8025`) shows verification email; click link → user verified; log in → redirected to `/acme/dashboard` showing "Welcome". Confirm a `consent_records` row exists with the request IP.
</verification>

<success_criteria>
- Better Auth 1.6.16 + next-safe-action 8.5.4 + @hookform/resolvers 5.4.0 + zod 4.4.3 installed at pinned versions
- src/middleware.ts (NOT proxy.ts) resolves tenant slug with SYSTEM_PREFIXES guard; does NOT touch DB (TENA-05 split documented)
- src/lib/actions/consent.ts captures consent IP server-side via next/headers — never trusts client value
- Auth pages: signup (with required LGPD consent), login (uniform error), verify-email, reset-password (uniform request response), 2fa enrollment
- `/[slug]/dashboard` Server Component reads tenant data exclusively via withTenant() — pattern enforced even for Phase 0's no-query case
- Dual-tenant E2E test proves user A's session cannot read tenant B's data even when slug-spoofing
- Server Component isolation test proves singleton db reads return 0 rows (silent-default-deny safety net)
- AUTH-01..05, TENA-05..08, LGPD-01..02 are all backed by passing integration tests
</success_criteria>

<output>
Create `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-04-SUMMARY.md` listing:
- Pinned versions of better-auth, next-safe-action, @hookform/resolvers, zod, react-hook-form
- Auth pages and their consumed Better Auth endpoints
- Middleware behavior summary + SYSTEM_PREFIXES list + the TENA-05 split (header only, no DB)
- recordConsentMetadata Server Action summary — IP captured server-side
- TENA-07 test summary (the 3 isolation assertions)
- TENA-05 server-component-tenant-isolation.test.ts summary (2 assertions documenting silent-fail mode)
- T-0-01, T-0-05, T-0-06, T-0-08 mitigation pointers
- Open items for Plan 05 (consent_records audit table consumed by recordConsentMetadata) and Plan 06 (request_id pino binding consumes middleware's x-request-id)
</output>
