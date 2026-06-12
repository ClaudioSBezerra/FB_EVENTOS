---
phase: 0
slug: foundation-stack-lock-anti-pitfall-hardening
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-11
updated: 2026-06-11
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit + integration) + Playwright 1.x (E2E) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (Wave 0 installs both) |
| **Quick run command** | `pnpm test:unit` |
| **Full suite command** | `pnpm test && pnpm test:e2e` |
| **Estimated runtime** | ~30 seconds quick / ~3 minutes full |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit`
- **After every plan wave:** Run `pnpm test && pnpm test:e2e`
- **Before `/gsd:verify-work`:** Full suite must be green + CI gates green on PR
- **Max feedback latency:** 30 seconds for unit tests

---

## Per-Task Verification Map

> Populated by the planner during revision iteration 1 (2026-06-11).
> Each row corresponds to one `<task>` block in the Phase 0 plan set.
> "Wave 0" gating column shows whether the task depends on test infra
> (Vitest harness lives in Plan 03 Task 3 — every task numbered after that
> reads `✅ W0` because the harness exists; earlier tasks read `n/a` because
> they don't run automated tests at all OR they stand the harness up).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Wave 0 | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|--------|
| 0-01-01 | 01 | 1 | FOUND-01..04 | — | Next.js 15.5 scaffold boots; TS strict; .env examples placeholder-only | ci-gate | `pnpm tsc --noEmit && pnpm dev` (smoke) | n/a | ⬜ pending |
| 0-01-02 | 01 | 1 | FOUND-05, FOUND-09 | T-0-09 (secret leak) | Husky pre-commit runs gitleaks (binary) + biome + tsc | ci-gate | `bash .husky/pre-commit` against staged fixture | n/a | ⬜ pending |
| 0-01-03 | 01 | 1 | FOUND-06, FOUND-15 | T-0-07 (`:latest` drift) | Multi-stage Dockerfile builds standalone image with semver label; no `:latest` | ci-gate | `docker build -t fb-eventos-web:0.0.1-test docker/ && ! grep ':latest' docker/Dockerfile` | n/a | ⬜ pending |
| 0-02-01 | 02 | 1 | FOUND-07 | T-0-02, T-0-03, T-0-04, T-0-07 | Anti-pitfall shell gates fail on SQLite / drizzle-kit push / fb_apu0[1-9] / `:latest` strings | ci-gate | `bash scripts/ci/check-no-embedded-db.sh && bash scripts/ci/check-no-drizzle-push.sh && bash scripts/ci/check-no-fb-apu0X.sh && bash scripts/ci/check-no-latest-tag.sh` | n/a | ⬜ pending |
| 0-02-02 | 02 | 1 | FOUND-07 | T-0-02..07, T-0-09 | CI workflow has 5 named blocking jobs (anti-pitfall-gates, secrets-scan, lint-typecheck, test, build); gitleaks-action runs on every PR | ci-gate | `act -j anti-pitfall-gates && act -j secrets-scan && act -j lint-typecheck` (or PR dry-run on GH) | n/a | ⬜ pending |
| 0-02-03 | 02 | 1 | FOUND-15 | T-0-07 | Tag-triggered workflow pushes semver tags to GHCR only (no `:latest`); requires CI green | ci-gate | Inspect `.github/workflows/build-and-push.yml`: `! grep -E ':latest\\b' .github/workflows/build-and-push.yml && grep -q 'tags:' .github/workflows/build-and-push.yml` | n/a | ⬜ pending |
| 0-03-01 | 03 | 2 | FOUND-08, FOUND-16, TENA-01, TENA-02 | T-0-01, T-0-04 | docker-compose has postgres:16-alpine (no Redis); Drizzle schema declares pgPolicy + withRLS on every tenant-owned table; drizzle.config uses DATABASE_MIGRATOR_URL | unit + ci-gate | `pnpm tsc --noEmit && test -f docker/compose.yml && grep -q 'postgres:16-alpine' docker/compose.yml && ! grep -E 'redis\|:latest' docker/compose.yml && grep -q 'pgRole.*fb_eventos_app' src/db/schema/roles.ts && grep -q 'withRLS' src/db/schema/auth.ts && grep -q 'DATABASE_MIGRATOR_URL' drizzle.config.ts && ! grep -q 'drizzle-kit push' package.json` | n/a | ⬜ pending |
| 0-03-02 | 03 | 2 | FOUND-16, TENA-01, TENA-02, TENA-03, TENA-04 | T-0-01, T-0-03 | Migrations 0000 (roles+extensions), 0001 (initial), 0002 (FORCE RLS) applied; `fb_eventos_app` has `rolbypassrls=false`; 7 tenant-owned tables have `relforcerowsecurity=true`; pgcrypto + pg_trgm present | integration | `pnpm db:up && sleep 5 && pnpm db:setup-roles && pnpm db:generate && pnpm db:migrate && pnpm db:check && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT count(*) FROM pg_class WHERE relname IN ('user','session','organization','member') AND relforcerowsecurity=true" \| grep -q '^4$' && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'" \| grep -q '^f$'` | n/a (stands up harness) | ⬜ pending |
| 0-03-03 | 03 | 2 | TENA-04, TENA-05 | T-0-01, RESEARCH Pitfall 3 | `withTenant()` uses `set_config('app.current_tenant_id', X, true)` (transaction-local); tests prove BYPASSRLS=false, set_config is tx-local, RLS blocks cross-tenant reads | unit | `pnpm test:unit tests/db/` (3 files: with-tenant.test.ts, rls-forced.test.ts, role-no-bypassrls.test.ts) | n/a (stands up harness) | ⬜ pending |
| 0-04-01a | 04 | 3 | AUTH-01..05, TENA-08, LGPD-01 | T-0-05, T-0-08 | Better Auth wired with Drizzle adapter, org + 2FA plugins, email verification, password reset; `consentVersion`/`consentAt` `required:true`, `consentIp` `required:false` | unit + ci-gate | `pnpm tsc --noEmit && grep -E "consentIp.*required:\\s*false" src/auth/server.ts && grep -q 'twoFactor' src/auth/server.ts && grep -q 'organization' src/auth/server.ts` | ✅ W0 | ⬜ pending |
| 0-04-01b | 04 | 3 | TENA-05, TENA-06, LGPD-01 | T-0-01, T-0-08 | Middleware sets x-tenant-slug + x-request-id headers ONLY (no DB); safe-action chain calls withTenant; recordConsentMetadata captures IP server-side via next/headers; migration 0003 makes consent_ip nullable | unit | `pnpm test:unit tests/middleware/tenant-slug-resolution.test.ts && grep -q "x-forwarded-for" src/lib/actions/consent.ts && grep -q 'inputSchema' src/lib/actions/safe-action.ts && ! grep -q '\\.schema(' src/lib/actions/safe-action.ts` | ✅ W0 | ⬜ pending |
| 0-04-02 | 04 | 3 | AUTH-01..05, TENA-06, LGPD-01, LGPD-02 | T-0-06, T-0-08 | All five auth pages compile; `/[slug]/dashboard` wraps reads in withTenant; signup form requires `z.literal(true)` consent AND calls recordConsentMetadata onSuccess | unit + build | `pnpm build && grep -qE "z\\.literal\\(true" src/components/auth/signup-form.tsx && grep -q 'recordConsentMetadata' src/components/auth/signup-form.tsx && grep -q 'withTenant' "src/app/[slug]/dashboard/page.tsx"` | ✅ W0 | ⬜ pending |
| 0-04-03 | 04 | 3 | AUTH-01..05, TENA-05, TENA-07, LGPD-01 | T-0-01, T-0-06, T-0-08 | TENA-07 dual-tenant proven (3 assertions); TENA-05 silent-fail documented (singleton db = 0 rows; withTenant = 1 row); 17+ test cases across tests/auth + tests/middleware | integration | `pnpm test:unit tests/auth/ && pnpm test:unit tests/auth/tenant-isolation-e2e.test.ts && pnpm test:unit tests/auth/server-component-tenant-isolation.test.ts` | ✅ W0 | ⬜ pending |
| 0-05-01 | 05 | 3 | LGPD-03, LGPD-04, LGPD-06 | T-0-08, LGPD Art. 8 repudiation | audit_log + consent_records tables exist; FORCE RLS on both; REVOKE UPDATE,DELETE on audit_log from fb_eventos_app; ≥8 PII column comments | integration | `pnpm db:migrate && pnpm db:check && PGPASSWORD=fb_dev psql ... grep relforcerowsecurity=true count=2 && has_table_privilege fb_eventos_app audit_log UPDATE = f` (full chain in plan verify) | ✅ W0 | ⬜ pending |
| 0-05-02 | 05 | 3 | LGPD-03, LGPD-04, LGPD-05 | T-0-08 | recordAudit + soft-delete helpers; 4 tests prove (a) audit append-only at GRANT layer, (b) singleton db → RLS rejection (load-bearing for key_links), (c) consent versioning, (d) soft-delete semantics, (e) PII inventory ≥8 | integration | `pnpm test:unit tests/lgpd/` | ✅ W0 | ⬜ pending |
| 0-05-03 | 05 | 3 | LGPD-02, LGPD-06 | T-0-08 | Consent banner persists choice in localStorage `fb_lgpd_consent_v1`; docs/LGPD.md placeholder ships with retention table + legal-review TODOs | ci-gate + manual | `pnpm build && grep -q "'use client'" src/components/consent-banner.tsx && grep -q "fb_lgpd_consent_v1" src/components/consent-banner.tsx && grep -q 'Inventário de tratamento' docs/LGPD.md` + manual smoke (first visit shows banner) | ✅ W0 | ⬜ pending |
| 0-06-01 | 06 | 4 | FOUND-10, FOUND-11 | (FOUND-10/11) | Pino structured JSON + childLogger requestId/tenantId; Sentry server/client/edge config files have correct names (NOT instrumentation-client.ts); redact filter masks password/token/cookie | unit | `pnpm test:unit tests/logging/ && test -f sentry.client.config.ts && test -f sentry.server.config.ts && test -f sentry.edge.config.ts && grep -q 'redact' src/lib/logger.ts` | ✅ W0 | ⬜ pending |
| 0-06-02 | 06 | 4 | FOUND-14 | (FOUND-14) | Graphile-Worker `add_job` SQL signature probed live; signatures pasted into migration 0006 header; user confirms via blocking checkpoint | manual + integration | `pnpm test:unit tests/jobs/add-job-signature-probe.test.ts` + human approval (resume signal) | ✅ W0 | ⬜ pending |
| 0-06-03 | 06 | 4 | FOUND-14, FOUND-16 | RESEARCH Pitfall 8 | Graphile-Worker runner + enqueueJob shipped; ADR-0001 written; 3 outbox semantics tests (COMMIT, ROLLBACK, jobKey dedup); 2 RLS-in-worker tests prove withTenant-required pattern; no Redis | integration | `pnpm test:unit tests/jobs/ && grep -q 'Graphile-Worker' docs/adr/0001-queue-backend.md && ! grep -E '"(bullmq\|ioredis\|redis)"' package.json` | ✅ W0 | ⬜ pending |
| 0-07-01 | 07 | 5 | FOUND-08, FOUND-13 | T-0-07 | /api/health returns 200 with db check; tsconfig.worker.json compiles; docker/Dockerfile.worker has no `:latest`; Playwright config + walking-skeleton spec ship; CI e2e job added | integration + ci-gate | `pnpm tsc --noEmit && pnpm tsc -p tsconfig.worker.json --noEmit && test -f src/app/api/health/route.ts && test -f tsconfig.worker.json && ! grep -E ':latest\\b' docker/Dockerfile.worker && grep -q 'dist-worker' tsconfig.worker.json && grep -q 'e2e:' .github/workflows/ci.yml` | ✅ W0 | ⬜ pending |
| 0-07-02 | 07 | 5 | FOUND-12, FOUND-13 | T-0-07, FOUND-12 risk | Deploy docs ship: COOLIFY.md (deploy/rollback/TLS/checklist), RUNBOOK.md (incidents/Watchtower-banned/FB_APU04 lessons), BACKUP.md (PITR target + pg_dump supplement), 4 docker/coolify/*.md service manifests with no `:latest` | ci-gate | `test -f docs/RUNBOOK.md && test -f docs/deploy/COOLIFY.md && test -f docs/deploy/BACKUP.md && ! grep -rE ':latest\\b' docker/coolify/ && grep -q 'Watchtower' docs/RUNBOOK.md && grep -q '2026-05-07\|FB_APU04' docs/RUNBOOK.md && grep -q 'pg_dump\|PITR' docs/deploy/BACKUP.md` | ✅ W0 | ⬜ pending |
| 0-07-03 | 07 | 5 | FOUND-08, FOUND-12, FOUND-13 | T-0-07, T-0-01 in prod | Production Coolify deploy verified by 10-item human checklist: semver tag (no :latest), /api/health 200, fb_eventos_app rolbypassrls=f, pgcrypto+pg_trgm present, 9 tables FORCE RLS, Pino JSON logs, Sentry test event, Playwright against prod, backup ≥7 days | manual | Human checkpoint — resume signal `approved — all 10 items pass; Phase 0 deploy verified in production` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Coverage summary:**
- 22 tasks total (Plan 04 has 4 tasks after Task 1 split; Plans 06 + 07 each carry one human checkpoint)
- Every task has an `<automated>` verify command OR is explicitly tagged manual/human-checkpoint
- No 3 consecutive autonomous tasks lack automated verification
- Wave 0 harness stands up in 0-03-02 (DB) + 0-03-03 (Vitest); all tasks after that read `✅ W0`
- Plans 01-02 produce CI / pre-commit gates that run on every PR — those tasks have `ci-gate` verify type and require no Vitest harness

---

## Wave 0 Requirements

- [x] `vitest.config.ts` + `src/test/setup.ts` — Vitest bootstrap (Plan 03 Task 3; stands up Postgres harness against docker/compose.yml)
- [x] `playwright.config.ts` + `tests/e2e/fixtures/two-tenants.ts` — Playwright bootstrap with mailpit + two-tenant fixture (Plan 07 Task 1)
- [x] Framework install — Vitest + @vitest/ui via Plan 03 Task 3; Playwright via Plan 03 Task 3 (devDep) or Plan 07 Task 1 (verified)
- [x] CI workflow file (`.github/workflows/ci.yml`) runs `pnpm test:unit` on every PR (Plan 02 Task 2 establishes; Plan 03 Task 3 step 10 removes `--passWithNoTests` once tests exist; Plan 07 Task 1 adds the `e2e` job)

*Foundation phase: no existing infrastructure — Wave 0 stands the test rig up from scratch across Plans 02 (CI) + 03 (Vitest) + 07 (Playwright).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email verification link arrives in inbox | AUTH-02 | Real mailbox delivery is out-of-process; mailpit covers local + Resend webhook covers prod | Sign up locally with mailpit running; check `localhost:8025` shows the verification email and clicking the link verifies the account |
| Coolify deploy publishes semver tag under TLS | FOUND-13 | Coolify dashboard is the source of truth; not scriptable from repo | After CI pushes `fb-eventos-web:0.1.0` to GHCR, trigger Coolify deploy (Plan 07 Task 3 checkpoint), confirm `https://app.fb-eventos.com.br/api/health` returns 200 with valid Let's Encrypt cert |
| LGPD consent text accepted in signup form | LGPD-01 | Visual/legal review — content correctness, not just field presence | Open `/signup`, verify consent checkbox + version label + link to política de privacidade are visible and required |
| Graphile-Worker add_job SQL signature matches RESEARCH assumption | FOUND-14 (Assumption A1) | Live function signature query — needs developer review of probe output | Plan 06 Task 2 blocking checkpoint — review printed signatures + resume with `approved`/`approved with variant <X>` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies or explicit human-checkpoint type
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Vitest in Plan 03 + Playwright in Plan 07 + CI workflow in Plan 02)
- [x] No watch-mode flags (CI must exit, not hang)
- [x] Feedback latency < 30s for unit suite (Vitest singleFork pool keeps DB tests serialized; ~30s budget realistic)
- [x] `nyquist_compliant: true` set in frontmatter after planner populated per-task map (revision iteration 1, 2026-06-11)

**Approval:** ready for execution (pending Wave 0 task completion at runtime)
