---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 07
type: execute
wave: 5
depends_on:
  - 00-04
  - 00-05
  - 00-06
files_modified:
  - src/app/api/health/route.ts
  - docker/Dockerfile
  - docker/Dockerfile.worker
  - docker/coolify/web.service.md
  - docker/coolify/worker.service.md
  - docker/coolify/postgres.service.md
  - docker/coolify/traefik-labels.md
  - docs/RUNBOOK.md
  - docs/deploy/COOLIFY.md
  - docs/deploy/BACKUP.md
  - playwright.config.ts
  - tests/e2e/walking-skeleton.spec.ts
  - tests/e2e/fixtures/two-tenants.ts
  - tsconfig.worker.json
  - .github/workflows/ci.yml
  - package.json
autonomous: false
requirements:
  - FOUND-08
  - FOUND-12
  - FOUND-13
requirements_addressed:
  - FOUND-08
  - FOUND-12
  - FOUND-13
tags:
  - deploy
  - coolify
  - traefik
  - health
  - playwright
  - walking-skeleton
must_haves:
  truths:
    - "GET /api/health returns 200 with JSON {status, timestamp, version} when Postgres is reachable; returns 503 when DB ping fails"
    - "docker/Dockerfile.worker builds the Graphile-Worker entrypoint as a separate image (NOT the Next.js web image)"
    - "tsconfig.worker.json extends ./tsconfig.json with outDir 'dist-worker' and includes ['src/jobs/**/*', 'scripts/jobs/**/*'] so the worker can be compiled independently of the Next.js build"
    - "Coolify deploy config is documented in docs/deploy/COOLIFY.md with per-service manifests: web, worker, postgres, minio"
    - "Traefik labels documented in docker/coolify/traefik-labels.md cover: host routing for app.fbeventos.com.br, ACME Let's Encrypt, healthcheck integration"
    - "Deploy pipeline runs `runMigrations()` (DDL via fb_eventos_migrator) BEFORE web/worker pods start (one-shot init container or pre-deploy hook documented)"
    - "Production images are semver-tagged via .github/workflows/build-and-push.yml (Plan 02); Coolify pulls explicit version — NO :latest, NO Watchtower"
    - "docs/RUNBOOK.md (FOUND-13) covers: incident drill, rollback steps, read-only-mode flag (placeholder for Phase 4), kill switch, backup restore"
    - "docs/deploy/BACKUP.md documents PITR (>=7 days) configuration with explicit verification steps for Coolify (Open Question A6 / FOUND-12)"
    - "Walking-skeleton Playwright spec exercises the cross-tenant 403 scenario as supplemental smoke confidence only — load-bearing TENA-07 proof lives in Plan 04 tests/auth/tenant-isolation-e2e.test.ts (three Vitest assertions: Alice sees only acme; slug-spoofing rejected; appPool default-deny). The walking-skeleton spec covers signup → email verify → login → dashboard → ONE tenant-scoped entity round-trip + LGPD consent enforcement as supplemental E2E integrated-stack confidence."
    - "Postgres extensions pgcrypto + pg_trgm are confirmed present in Coolify-managed Postgres (FOUND-16; one-time verification step in COOLIFY.md)"
  artifacts:
    - path: "src/app/api/health/route.ts"
      provides: "Liveness + DB-readiness probe"
      contains: "SELECT 1"
    - path: "docker/Dockerfile.worker"
      provides: "Separate worker image (Graphile-Worker entrypoint)"
    - path: "tsconfig.worker.json"
      provides: "TypeScript build config for the worker process (outDir dist-worker)"
      contains: "dist-worker"
    - path: "docs/deploy/COOLIFY.md"
      provides: "Coolify deploy runbook"
    - path: "docs/RUNBOOK.md"
      provides: "Incident + rollback procedures (FOUND-13)"
    - path: "playwright.config.ts"
      provides: "Playwright E2E config"
    - path: "tests/e2e/walking-skeleton.spec.ts"
      provides: "End-to-end signup/login/dashboard smoke + LGPD consent enforcement (TENA-07 supplemental confidence only)"
  key_links:
    - from: "src/app/api/health/route.ts"
      to: "docker/Dockerfile HEALTHCHECK"
      via: "Docker healthcheck queries /api/health"
      pattern: "/api/health"
    - from: ".github/workflows/build-and-push.yml"
      to: "docs/deploy/COOLIFY.md"
      via: "Coolify pulls semver tag pushed by build workflow"
      pattern: "ghcr.io"
    - from: "tests/e2e/walking-skeleton.spec.ts"
      to: "src/middleware.ts + src/lib/actions/safe-action.ts"
      via: "real browser exercises full stack end-to-end (supplemental; not the load-bearing TENA-07 proof)"
      pattern: "walking-skeleton"
---

<objective>
Close Phase 0 by shipping the walking-skeleton deploy pipeline: `/api/health` route, separate worker Dockerfile + `tsconfig.worker.json`, Coolify service manifests + Traefik labels documentation, RUNBOOK + BACKUP docs, and a Playwright E2E smoke test that exercises the integrated stack end-to-end through a real browser (signup → email verify → login → tenant-scoped dashboard with ONE round-trip + LGPD consent enforcement). This is the proof that everything Plans 01-06 built actually integrates into a deployable system.

**Scope clarification (TENA-07):** This plan's Playwright spec exercises the walking-skeleton happy path for integrated confidence, but it is NOT the load-bearing TENA-07 proof. The load-bearing tenant-isolation proof remains Plan 04's `tests/auth/tenant-isolation-e2e.test.ts` (three Vitest assertions: Alice sees only acme; slug-spoofing rejected; appPool default-deny). Plan 07 does not own TENA-07 in its frontmatter — it depends on Plan 04 having shipped TENA-07 correctly. The cross-tenant access scenario inside `walking-skeleton.spec.ts` exists for end-to-end smoke confidence only; if Plan 04's Vitest tests are broken, the phase fails Plan 04 — Plan 07 is not a blocking-dependency proxy.

Purpose: Mitigates T-0-07 (Watchtower :latest — already CI-gated in Plan 02; this plan documents the human deploy procedure that enforces it). Validates the integrated stack from the user's browser. Provides the FOUND-13 runbook FB_APU04 famously lacked (2026-05-07 data loss incident).

Output: health route + worker Dockerfile + `tsconfig.worker.json` + docs/deploy/*.md + docs/RUNBOOK.md + playwright config + walking-skeleton spec + final CI integration. **Autonomous=false:** Two human checkpoints — Coolify deploy verification (cannot be automated) AND optional PITR backup verification.
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
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-04-SUMMARY.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-06-SUMMARY.md

<interfaces>
<!-- Required for Playwright + health endpoint. -->

dependencies (added here):
  @playwright/test:   ~1.60.0
  (already installed in Plan 03 actually — confirm or skip if present)

src/app/api/health/route.ts exports:
  export const dynamic = 'force-dynamic';
  export async function GET(): Promise<NextResponse>
  // Returns { status: 'ok' | 'error', timestamp, version, checks: { db: boolean } }

tsconfig.worker.json shape:
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "outDir": "dist-worker",
      "module": "ESNext",
      "noEmit": false
    },
    "include": ["src/jobs/**/*", "scripts/jobs/**/*", "src/lib/**/*", "src/db/**/*"]
  }
  // Excludes the Next.js app dir so the worker build does not pull in React server components.

# Coolify deploy targets:
  service "fb-eventos-web":   image ghcr.io/<org>/fb-eventos-web:<semver>, port 3000, Traefik labels
  service "fb-eventos-worker": image ghcr.io/<org>/fb-eventos-worker:<semver>, NO port exposure
  service "fb-eventos-postgres": image postgres:16-alpine (managed by Coolify), backup enabled
  service "fb-eventos-minio":  image minio/minio:<pinned>, S3 endpoint exposed to Traefik
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: /api/health route + worker Dockerfile + tsconfig.worker.json + Playwright E2E walking skeleton</name>
  <files>src/app/api/health/route.ts, docker/Dockerfile.worker, tsconfig.worker.json, playwright.config.ts, tests/e2e/walking-skeleton.spec.ts, tests/e2e/fixtures/two-tenants.ts, .github/workflows/ci.yml, package.json</files>
  <read_first>
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (section "Health Check Endpoint", "Pattern 11: Multi-Stage Dockerfile")
    - docker/Dockerfile (Plan 01 Task 3 — the web image)
    - src/db/index.ts (Plan 03)
    - tests/auth/tenant-isolation-e2e.test.ts (Plan 04 — the LOAD-BEARING TENA-07 proof; this plan does not duplicate it)
    - .github/workflows/ci.yml (Plan 02)
  </read_first>
  <behavior>
    - `GET /api/health` queries `SELECT 1` via `db.execute(sql\`SELECT 1\`)`; returns 200 + JSON `{status:'ok', timestamp, version, checks:{db:true}}` on success, 503 + `{status:'error', checks:{db:false}}` on failure.
    - `docker/Dockerfile.worker` is a separate multi-stage image whose runner CMD is `node dist-worker/scripts/jobs/start-worker.js`. The builder stage runs `pnpm tsc -p tsconfig.worker.json` to produce `dist-worker/`.
    - `tsconfig.worker.json` extends `./tsconfig.json`, sets `outDir: "dist-worker"`, and includes only `src/jobs/**/*`, `scripts/jobs/**/*`, `src/lib/**/*`, `src/db/**/*` (excludes the Next.js app dir so no React/JSX leaks into the worker build).
    - Playwright config uses base URL `http://localhost:3000`, headless, 30s timeout per test, retries 1 in CI.
    - `tests/e2e/walking-skeleton.spec.ts` runs an integrated smoke flow: signup as acme owner → mailpit-fetch verification email → click verify → login → reach `/acme/dashboard` → exercise ONE tenant-scoped round-trip (e.g. the dashboard renders the org name read via `withTenant`) → also a separate LGPD-consent-required scenario. Cross-tenant 403 is exercised here only as supplemental smoke; the load-bearing isolation proof is Plan 04's Vitest test.
    - CI `test` job (Plan 02) gets a new `e2e` sibling job that boots the app + runs Playwright.
  </behavior>
  <action>
    1. Create `src/app/api/health/route.ts` per RESEARCH "Health Check Endpoint":
       ```typescript
       import { NextResponse } from 'next/server';
       import { sql } from 'drizzle-orm';
       import { db } from '@/db';
       export const dynamic = 'force-dynamic';
       export async function GET() {
         try {
           await db.execute(sql`SELECT 1`);
           return NextResponse.json({
             status: 'ok',
             timestamp: new Date().toISOString(),
             version: process.env.npm_package_version ?? 'unknown',
             checks: { db: true },
           });
         } catch (err) {
           return NextResponse.json({ status: 'error', checks: { db: false } }, { status: 503 });
         }
       }
       ```
       NOTE: this route does NOT call `withTenant` — it's a global liveness probe, no tenant context. The `db` import is the appPool; `SELECT 1` does not touch any tenant-owned table, so RLS doesn't apply.

    2. Create `tsconfig.worker.json` at repo root (extends `./tsconfig.json`):
       ```json
       {
         "extends": "./tsconfig.json",
         "compilerOptions": {
           "outDir": "dist-worker",
           "module": "ESNext",
           "moduleResolution": "Bundler",
           "noEmit": false,
           "jsx": "preserve"
         },
         "include": [
           "src/jobs/**/*",
           "scripts/jobs/**/*",
           "src/lib/**/*",
           "src/db/**/*",
           "src/auth/server.ts"
         ],
         "exclude": ["src/app/**/*", "src/components/**/*", "src/middleware.ts", "node_modules", "dist-worker", ".next"]
       }
       ```
       Rationale: the worker process doesn't render React, so excluding `src/app/**` keeps the worker build lean and avoids pulling Next.js-only types into the worker output.

    3. Create `docker/Dockerfile.worker`:
       ```dockerfile
       FROM node:22-alpine AS deps
       WORKDIR /app
       COPY package.json pnpm-lock.yaml ./
       RUN corepack enable pnpm && pnpm install --frozen-lockfile

       FROM node:22-alpine AS builder
       WORKDIR /app
       COPY --from=deps /app/node_modules ./node_modules
       COPY . .
       RUN corepack enable pnpm && pnpm tsc -p tsconfig.worker.json

       FROM node:22-alpine AS runner
       WORKDIR /app
       ENV NODE_ENV=production
       COPY --from=builder /app/node_modules ./node_modules
       COPY --from=builder /app/dist-worker ./dist-worker
       COPY --from=builder /app/src/db/migrations ./src/db/migrations
       ARG APP_VERSION
       LABEL org.opencontainers.image.version="$APP_VERSION"
       # NO :latest tag. NO HEALTHCHECK (Coolify polls process state for workers).
       CMD ["node", "dist-worker/scripts/jobs/start-worker.js"]
       ```

    4. Install Playwright if not already present (Plan 03 already added `@playwright/test` to devDependencies — verify; if missing run `pnpm add -D @playwright/test@~1.60.0`).

    5. Create `playwright.config.ts`:
       ```typescript
       import { defineConfig, devices } from '@playwright/test';
       export default defineConfig({
         testDir: './tests/e2e',
         timeout: 30_000,
         retries: process.env.CI ? 1 : 0,
         reporter: process.env.CI ? 'github' : 'list',
         use: { baseURL: 'http://localhost:3000', headless: true, trace: 'on-first-retry' },
         projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
         webServer: {
           command: 'pnpm dev',
           url: 'http://localhost:3000/api/health',
           reuseExistingServer: !process.env.CI,
           timeout: 60_000,
         },
       });
       ```

    6. Create `tests/e2e/fixtures/two-tenants.ts`: helpers `signupViaUI(page, {tenantSlug, email, password, name, orgName})`, `fetchVerificationLink(email)` (queries mailpit API at `localhost:8025/api/v1/messages`), `loginViaUI(page, email, password)`. Mailpit's HTTP API returns recent messages; pull the verification URL from the most recent email matching the recipient.

    7. Create `tests/e2e/walking-skeleton.spec.ts`:
       ```typescript
       import { test, expect } from '@playwright/test';
       import { signupViaUI, fetchVerificationLink, loginViaUI } from './fixtures/two-tenants';

       // NOTE: This spec is INTEGRATED-STACK SMOKE. The load-bearing TENA-07 proof lives in
       // tests/auth/tenant-isolation-e2e.test.ts (Plan 04). If Plan 04's Vitest assertions are
       // broken, the phase fails Plan 04 — Plan 07 does not own TENA-07.
       test('walking skeleton: signup → verify → login → tenant-scoped dashboard round-trip', async ({ page }) => {
         // 1. Signup tenant A
         await signupViaUI(page, { tenantSlug: 'acme', email: 'alice@acme.test', password: 'sup3rsecret!password', name: 'Alice', orgName: 'Acme' });
         // 2. Fetch verification email from mailpit; click link
         const link = await fetchVerificationLink('alice@acme.test');
         await page.goto(link);
         await expect(page.getByText(/verified/i)).toBeVisible();
         // 3. Login
         await loginViaUI(page, 'alice@acme.test', 'sup3rsecret!password');
         // 4. Reach /acme/dashboard and confirm ONE tenant-scoped round-trip succeeds
         //    (dashboard renders the org name resolved via withTenant)
         await expect(page).toHaveURL(/\/acme\/dashboard/);
         await expect(page.getByText(/Welcome.*Acme/i)).toBeVisible();
         // 5. Supplemental cross-tenant smoke (NOT the load-bearing proof — see Plan 04):
         await page.goto('/globex/dashboard');
         await expect(page.locator('body')).toContainText(/403|forbidden|not.*member/i);
       });

       test('LGPD consent required at signup', async ({ page }) => {
         await page.goto('/signup');
         await page.fill('[name=email]', 'noconsent@test.example');
         await page.fill('[name=password]', 'sup3rsecret!password');
         await page.fill('[name=name]', 'No Consent');
         await page.fill('[name=orgName]', 'NoConsent Org');
         await page.fill('[name=orgSlug]', 'noconsent');
         // do NOT check the consent checkbox
         await page.click('button[type=submit]');
         await expect(page.getByText(/consentimento|consent/i)).toBeVisible();
       });
       ```

    8. Update `.github/workflows/ci.yml`: add a new job `e2e` after `build` job:
       ```yaml
       e2e:
         name: E2E (Playwright)
         runs-on: ubuntu-latest
         needs: [build]
         services:
           postgres:
             # same as test job
         steps:
           - uses: actions/checkout@v4
           - uses: pnpm/action-setup@v4
             with: { version: 9 }
           - uses: actions/setup-node@v4
             with: { node-version: 22, cache: pnpm }
           - run: pnpm install --frozen-lockfile
           - run: pnpm exec playwright install --with-deps chromium
           - run: pnpm db:setup-roles
           - run: pnpm db:migrate
           - run: pnpm exec playwright test
             env:
               DATABASE_URL: postgresql://fb_test:fb_test@localhost:5432/fb_eventos_test
               # ... rest of env
       ```

    9. Add npm scripts to `package.json`:
       - `"test:e2e"`: `playwright test`
       - `"test:e2e:ui"`: `playwright test --ui`
       - `"build:worker"`: `tsc -p tsconfig.worker.json`

    Per CLAUDE.md "tests from day 1 (FB_APU04 had zero coverage)": the walking-skeleton spec is the load-bearing proof that the entire phase integrates AS A STACK. Tenant-isolation correctness is a Plan 04 contract.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && pnpm tsc -p tsconfig.worker.json --noEmit && test -f src/app/api/health/route.ts && grep -q 'SELECT 1' src/app/api/health/route.ts && test -f tsconfig.worker.json && grep -q 'dist-worker' tsconfig.worker.json && test -f docker/Dockerfile.worker && ! grep -E ':latest\b' docker/Dockerfile.worker && grep -q 'node:22-alpine' docker/Dockerfile.worker && grep -q 'dist-worker/scripts/jobs/start-worker.js' docker/Dockerfile.worker && test -f playwright.config.ts && test -f tests/e2e/walking-skeleton.spec.ts && grep -q 'acme.*dashboard\|globex\|walking-skeleton' tests/e2e/walking-skeleton.spec.ts && grep -q 'e2e:' .github/workflows/ci.yml</automated>
  </verify>
  <acceptance_criteria>
    - `src/app/api/health/route.ts` exists, exports GET, returns 200 + JSON on DB ok, 503 on fail
    - `tsconfig.worker.json` exists at repo root; extends `./tsconfig.json`; sets `outDir: "dist-worker"`; `include` lists src/jobs, scripts/jobs, src/lib, src/db; excludes src/app
    - `docker/Dockerfile.worker` exists with `node:22-alpine`, no `:latest`, builder step `pnpm tsc -p tsconfig.worker.json`, runner CMD `node dist-worker/scripts/jobs/start-worker.js`
    - `playwright.config.ts` exists with baseURL `http://localhost:3000` and `webServer` config that boots `pnpm dev`
    - `tests/e2e/walking-skeleton.spec.ts` has 2+ test cases (integrated happy path + LGPD consent enforcement); a header comment defers the load-bearing TENA-07 proof to Plan 04
    - `.github/workflows/ci.yml` has new `e2e` job; Playwright runs against the test Postgres service
    - `package.json` has `test:e2e` and `build:worker` scripts
    - `pnpm tsc --noEmit` and `pnpm tsc -p tsconfig.worker.json --noEmit` both exit 0
  </acceptance_criteria>
  <done>Health endpoint, worker image, worker tsconfig, Playwright E2E config, and walking-skeleton spec all shipped; CI runs E2E on every PR; tenant-isolation correctness remains owned by Plan 04.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Coolify deploy manifests, Traefik labels, RUNBOOK, BACKUP docs</name>
  <files>docker/coolify/web.service.md, docker/coolify/worker.service.md, docker/coolify/postgres.service.md, docker/coolify/traefik-labels.md, docs/deploy/COOLIFY.md, docs/RUNBOOK.md, docs/deploy/BACKUP.md, README.md</files>
  <read_first>
    - CLAUDE.md (sections "Reference Architecture vs FB_APU04", "What NOT to Use" → Watchtower entry)
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (section "Open Questions" #2 #3, "Environment Availability")
    - docker/Dockerfile (Plan 01 + 03)
    - docker/Dockerfile.worker (Task 1 above)
    - .github/workflows/build-and-push.yml (Plan 02 Task 3)
  </read_first>
  <action>
    1. Create `docker/coolify/web.service.md` documenting the Coolify service for the Next.js web container:
       - Image: `ghcr.io/<org>/fb-eventos-web:<semver>` (NO `:latest`, NO Watchtower auto-pull)
       - Port: 3000
       - Env vars: list from `.env.production.example` (DATABASE_URL, DATABASE_MIGRATOR_URL — only used by pre-deploy job, BETTER_AUTH_SECRET, BETTER_AUTH_URL, RESEND_API_KEY, MINIO_*, SENTRY_DSN, NEXT_PUBLIC_*, TZ=America/Sao_Paulo, NODE_ENV=production, LOG_LEVEL=info)
       - Healthcheck: HTTP GET `/api/health`, interval 30s, timeout 3s
       - Pre-deploy hook: run `node dist/scripts/migrate.js` (or `pnpm db:migrate` from a one-shot Coolify "Init Container" pattern) using `DATABASE_MIGRATOR_URL`. Document explicitly: this is the ONLY place migrations run; the runtime web container uses `DATABASE_URL` (fb_eventos_app role) and never calls `runMigrations()` itself.

    2. Create `docker/coolify/worker.service.md`:
       - Image: `ghcr.io/<org>/fb-eventos-worker:<semver>` (same semver as web — they ship together)
       - No port exposure
       - Same env vars as web minus `NEXT_PUBLIC_*`
       - Restart policy: `always`
       - Notes citing RESEARCH Pitfall 8: worker uses its own pg pool; tasks handling tenant data invoke `withTenant()` internally (proven by Plan 06's `tests/jobs/worker-without-with-tenant.test.ts`).

    3. Create `docker/coolify/postgres.service.md`:
       - Image: `postgres:16-alpine` (Coolify-managed)
       - Volume: `pg_data` persistent
       - Extensions to verify on first deploy: `pgcrypto`, `pg_trgm` (FOUND-16). Document the SQL: `\dx` after migration should show both. Note RESEARCH Open Question #2 — if extensions are missing, the migration 0000 `CREATE EXTENSION IF NOT EXISTS` runs as the migrator role which may need superuser; if blocked, document Coolify's procedure to enable extensions via dashboard or `coolify-postgres` exec.
       - Roles to verify: `fb_eventos_app`, `fb_eventos_migrator` exist; `fb_eventos_app` has `rolbypassrls=false`.
       - Connection strings format: `DATABASE_URL=postgresql://fb_app_user:<coolify-secret>@<coolify-postgres-internal-host>:5432/fb_eventos_prod`.

    4. Create `docker/coolify/traefik-labels.md` documenting Traefik label patterns for the web service (RESEARCH Open Question A4 / LOW confidence — flag this as needs-verification on first deploy):
       ```
       # Example labels — adjust for actual Coolify naming conventions
       traefik.enable=true
       traefik.http.routers.fb-eventos.rule=Host(`app.fbeventos.com.br`)
       traefik.http.routers.fb-eventos.entrypoints=websecure
       traefik.http.routers.fb-eventos.tls.certresolver=letsencrypt
       traefik.http.services.fb-eventos.loadbalancer.server.port=3000
       traefik.http.services.fb-eventos.loadbalancer.healthcheck.path=/api/health
       traefik.http.services.fb-eventos.loadbalancer.healthcheck.interval=30s
       ```
       Mark with header: `# RESEARCH Open Question A4 / LOW confidence — verify exact Coolify label conventions against the Coolify UI on first deploy. Phase 1 retrospective should confirm.`

    5. Create `docs/deploy/COOLIFY.md` — the load-bearing deploy runbook:
       - Section 1: First-time setup (Coolify URL, GitHub Actions PAT, GHCR access, secret env vars)
       - Section 2: Per-service config (link to docker/coolify/*.md)
       - Section 3: Deploy procedure: `pnpm version patch && git push --follow-tags` → CI runs build-and-push.yml → tagged image arrives at GHCR → Coolify pulls and deploys (semver tag, never :latest; pre-deploy hook runs migrations; rolling restart of web + worker)
       - Section 4: Rollback procedure: in Coolify UI, set image tag back to previous semver; verify /api/health 200 then `pnpm db:check` shows no drift (if migrations were applied, rollback may require down-migration — Phase 0 ships forward-only; document the implication)
       - Section 5: Domain + TLS: Cloudflare/DNS records → Traefik ACME Let's Encrypt → wildcard cert for Phase 4 (`*.fbeventos.com.br`) deferred — Phase 0 uses single host `app.fbeventos.com.br`
       - Section 6: First-deploy verification checklist (post-Task 3 checkpoint): `/api/health` returns 200, signup E2E test passes against the live URL, Pino JSON logs visible in Coolify log stream, Sentry test event arrives, Postgres extensions `\dx` shows `pgcrypto` and `pg_trgm`

    6. Create `docs/RUNBOOK.md` (FOUND-13) — minimal-but-real incident runbook:
       - Section "Incident: Service down" — steps to verify, escalate, rollback
       - Section "Incident: Data corruption suspected" — STOP writes, snapshot DB (`pg_dump`), inspect, rollback to last good migration
       - Section "Incident: Cross-tenant data leak" — STOP, audit_log scan, revoke active sessions, rotate BETTER_AUTH_SECRET, re-deploy
       - Section "Read-only mode kill switch" — placeholder for Phase 4 OPS-05; for Phase 0 document the manual procedure (revoke INSERT/UPDATE/DELETE from fb_eventos_app, leaving SELECT)
       - Section "Backup restore drill" — link to BACKUP.md
       - Section "On-call contact" — placeholder
       - Section "Lessons from FB_APU04" — cite the 2026-05-07 incident, link to PITFALLS.md
       - Section "Watchtower banned" — repeat CLAUDE.md "What NOT to Use" entry so on-call engineers see it during incidents.

    7. Create `docs/deploy/BACKUP.md` (FOUND-12 — RESEARCH Open Question #3 / Assumption A6 — Coolify backup capability is LOW confidence):
       - Section "Target": ≥7 days PITR (Point-In-Time Recovery)
       - Section "Coolify managed Postgres backup": Document the Coolify UI settings to enable; if Coolify only supports snapshot-based backups, supplement with a cron job that runs `pg_dump` to MinIO with 7-day rotation (script template included)
       - Section "Verification drill": monthly procedure to restore the most recent backup to a separate Postgres instance and run `tests/e2e/walking-skeleton.spec.ts` against it
       - Section "Retention vs LGPD": cross-reference docs/LGPD.md retention table — backups containing PII must not exceed the longest retention window
       - Mark with: "RESEARCH Open Question #3 / Assumption A6 — verify Coolify's actual backup tier on first deploy; if snapshot-only, supplement with the pg_dump→MinIO script below."

    8. Update `README.md` with a "Deploy" section linking to docs/deploy/COOLIFY.md and a "Runbook" section linking to docs/RUNBOOK.md.

    Per CLAUDE.md "Reset/Truncate endpoints without confirmation gate": Phase 0 has no DELETE endpoints, but RUNBOOK documents the "read-only mode kill switch" pattern so the muscle memory exists before Phase 1+ adds destructive operations.
  </action>
  <verify>
    <automated>test -f src/app/api/health/route.ts && test -f docs/RUNBOOK.md && test -f docs/deploy/COOLIFY.md && test -f docs/deploy/BACKUP.md && test -f docker/coolify/web.service.md && test -f docker/coolify/worker.service.md && test -f docker/coolify/postgres.service.md && test -f docker/coolify/traefik-labels.md && ! grep -rE ':latest\b' docker/coolify/ && grep -q 'Watchtower' docs/RUNBOOK.md && grep -q 'fb_eventos_app' docker/coolify/postgres.service.md && grep -q 'NOBYPASSRLS\|rolbypassrls' docker/coolify/postgres.service.md && grep -q 'pgcrypto' docker/coolify/postgres.service.md && grep -q '2026-05-07\|FB_APU04' docs/RUNBOOK.md && grep -q 'pg_dump\|PITR' docs/deploy/BACKUP.md</automated>
  </verify>
  <acceptance_criteria>
    - Four files in `docker/coolify/` documenting web, worker, postgres, traefik labels
    - `docs/deploy/COOLIFY.md` covers first-time setup, deploy, rollback, domain/TLS, verification checklist
    - `docs/deploy/BACKUP.md` covers PITR target, Coolify settings, pg_dump supplement, verification drill, LGPD retention cross-ref
    - `docs/RUNBOOK.md` covers incident scenarios + FB_APU04 lessons + on-call placeholder + Watchtower-banned section
    - No `:latest` references anywhere in `docker/coolify/`
    - `README.md` links to RUNBOOK + COOLIFY deploy doc
    - postgres.service.md documents the NOBYPASSRLS verification + extension check
    - traefik-labels.md is marked with the "verify on first deploy" caveat (RESEARCH A4)
  </acceptance_criteria>
  <done>All deploy documentation shipped; no :latest anywhere; runbook + backup procedure documented; postgres service manifest verifies the rolbypassrls=false invariant on every deploy.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: [CHECKPOINT] Coolify deploy validation: publish v0.1.0 tag → confirm /api/health on production URL → run walking-skeleton against deployed URL → confirm Postgres extensions + role flags</name>
  <files>(no files modified — verification activity)</files>
  <what-built>
    Plan 06 Task 1-2 shipped: web Dockerfile, worker Dockerfile, health route, Coolify service manifests, deploy runbook. CI pushes semver-tagged images to GHCR. This checkpoint requires you (the developer) to actually configure Coolify once, trigger the v0.1.0 deploy, and verify the FOUR success criteria from ROADMAP Phase 0 are observable in production:

    Specifically:
    1. Coolify pulls `ghcr.io/<org>/fb-eventos-web:0.1.0` (semver tag — no :latest)
    2. Pre-deploy hook runs migrations using DATABASE_MIGRATOR_URL
    3. Web container starts; healthcheck `/api/health` returns 200
    4. Worker container starts; visible in Coolify logs
    5. Traefik + Let's Encrypt provisions TLS cert for app.fbeventos.com.br (or whatever production host is chosen)
    6. Pino JSON logs visible in Coolify log stream
    7. Sentry test exception arrives

    Pre-checkpoint (Claude prepares):
    1. Run `pnpm version patch` (sets package.json to 0.1.0).
    2. `git push --follow-tags`. This triggers `.github/workflows/build-and-push.yml` (Plan 02 Task 3).
    3. Wait for the workflow to finish (check Actions tab). Image `ghcr.io/<org>/fb-eventos-web:0.1.0` and `ghcr.io/<org>/fb-eventos-worker:0.1.0` should be in GHCR.
    4. Print the deploy URL and the verification checklist below.
  </what-built>
  <how-to-verify>
    Follow `docs/deploy/COOLIFY.md` Section 1-3 to configure Coolify on your existing infra (or sign up; Coolify supports Hetzner, AWS, DigitalOcean). Then verify EACH item below by command or visual check. **Reply only when ALL items pass.**

    1. **Semver tag (T-0-07 mitigation):** In Coolify UI, the configured image tag for the web service is `0.1.0` (NOT `latest`). Screenshot/quote the field value.

    2. **Healthcheck:** `curl -fsSL https://<your-production-host>/api/health` returns HTTP 200 with JSON `{"status":"ok","checks":{"db":true}}`.

    3. **Postgres roles (TENA-03, T-0-01):** Connect to the Coolify-managed Postgres via the Coolify exec console:
       ```sql
       SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('fb_eventos_app','fb_eventos_migrator');
       ```
       Expected: `fb_eventos_app | f` (false) and `fb_eventos_migrator | f` (false — migrator doesn't need bypass either).

    4. **Postgres extensions (FOUND-16):** `\dx` in Coolify Postgres console lists both `pgcrypto` and `pg_trgm`.

    5. **FORCE RLS still active:** `SELECT count(*) FROM pg_class WHERE relname IN ('user','session','account','verification','organization','member','invitation','audit_log','consent_records') AND relforcerowsecurity = true;` returns `9`.

    6. **Pino logs structured:** In Coolify log stream for the web service, the most recent log lines are JSON-formatted with `service: 'fb-eventos-web'`, `level`, `time`, `msg` fields.

    7. **Sentry:** Trigger a test error (e.g. visit `/test-sentry` if you added one, or call `Sentry.captureMessage('deploy-smoke-test')` from a one-off route). Verify it arrives in the Sentry dashboard within 2 minutes.

    8. **Walking skeleton E2E against production:** Update `playwright.config.ts` temporarily (or use a CLI override) with `baseURL: 'https://<your-prod-host>'` and run `pnpm test:e2e tests/e2e/walking-skeleton.spec.ts` — expect both test cases to pass against production. (Don't commit the URL override; just smoke-test.)

    9. **`:latest` reality check:** In Coolify UI, search for `:latest` in any service config. Should return zero matches.

    10. **Backup configured (FOUND-12):** In Coolify Postgres service settings, verify backup is enabled with retention ≥7 days. If Coolify only offers snapshots (RESEARCH Open Question #3), provision the pg_dump→MinIO supplement from docs/deploy/BACKUP.md.
  </how-to-verify>
  <resume-signal>Type one of:
    - `approved — all 10 items pass; Phase 0 deploy verified in production` (Phase 0 closes; ready for Phase 1)
    - `approved with caveats: <list>` (deploy works but some items deferred — document in 00-07-SUMMARY.md and create follow-up issues)
    - `failed: <which items + errors>` (Claude debugs the specific failure; common: Traefik labels need adjustment, Coolify env var paths different from docs)
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GHCR registry → Coolify pull | Image tag pinned to semver in Coolify config; no Watchtower; no :latest |
| Internet → Traefik | TLS via Let's Encrypt ACME (HTTP-01 challenge); rate limiting at edge |
| Traefik → Next.js | Internal HTTP; only port 3000 exposed; healthcheck path /api/health |
| Coolify pre-deploy hook → DATABASE_MIGRATOR_URL | DDL access scoped to migration step; runtime web uses DATABASE_URL (fb_eventos_app) |
| Browser E2E → live deploy | Walking-skeleton test exercises real auth + middleware end-to-end (integrated smoke; not load-bearing TENA-07 proof — see Plan 04) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-0-03 | Tampering | migration discipline in production | mitigate | Coolify pre-deploy hook runs `pnpm db:migrate` using DATABASE_MIGRATOR_URL; runtime web container has no migration capability (different role) |
| T-0-07 | Tampering / EoP | image tag drift to :latest | mitigate | Plan 02 CI grep gate + Plan 07 docs/RUNBOOK.md "Watchtower banned" notice + Task 3 checkpoint item #1 (verify Coolify config uses semver) |
| FOUND-12 risk | Recovery | Postgres backup misconfigured | mitigate | docs/deploy/BACKUP.md explicit verification drill; Task 3 checkpoint item #10 confirms retention ≥7 days OR pg_dump supplement |
| RESEARCH A4/A6 | Configuration drift | Traefik labels, Coolify backup | document | docs/coolify/traefik-labels.md flagged as "verify on first deploy"; A6 mitigated by pg_dump supplement template |
</threat_model>

<verification>
1. `pnpm tsc --noEmit && pnpm tsc -p tsconfig.worker.json --noEmit && pnpm lint && pnpm build` is green.
2. `pnpm test:unit` is green (all of Plans 03-06 tests).
3. `pnpm test:e2e` runs locally (boots `pnpm dev`, runs walking-skeleton spec).
4. Task 3 checkpoint approved by user with all 10 items confirmed.
5. CI `e2e` job green on the PR that ships Plan 07.
</verification>

<success_criteria>
- /api/health route returns 200 + DB-check JSON
- docker/Dockerfile.worker exists as a separate semver-tagged image; tsconfig.worker.json compiles cleanly
- docs/deploy/COOLIFY.md + RUNBOOK.md + BACKUP.md ship as load-bearing operational docs
- Playwright walking-skeleton test covers signup→verify→login→tenant dashboard round-trip + LGPD consent enforcement in a real browser; runs in CI
- Task 3 human checkpoint confirms production deploy meets all 4 ROADMAP Phase 0 success criteria
- Phase 0 closes with the entire end-to-end demo working: CI gates → Postgres RLS → Better Auth → tenant-scoped dashboard → Coolify deploy
- TENA-07's load-bearing proof remains Plan 04's `tests/auth/tenant-isolation-e2e.test.ts` — Plan 07 is supplemental confidence only
</success_criteria>

<output>
Create `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-07-SUMMARY.md` listing:
- Production URL (placeholder until Task 3 checkpoint completes)
- Image tags pushed (web 0.1.0, worker 0.1.0)
- Task 3 verification result with checkpoint resume signal pasted verbatim
- Open items / caveats for Phase 1 (e.g., Traefik wildcard cert deferred, backup tier confirmed/needs-supplement)
- Phase 0 closure: ROADMAP Phase 0 → mark Complete; STATE.md → Phase 1 Ready
- Note: TENA-07 owned by Plan 04; Plan 07 E2E spec is supplemental smoke
</output>
