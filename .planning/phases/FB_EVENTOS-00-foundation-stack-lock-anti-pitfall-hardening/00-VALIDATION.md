---
phase: 0
slug: foundation-stack-lock-anti-pitfall-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-11
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x (unit + integration) + Playwright 1.x (E2E) |
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

> Populated by the planner during step 8 of plan-phase. Each task derived from
> the per-plan task lists below will append a row here. See `00-RESEARCH.md`
> `## Validation Architecture` for the per-requirement mapping the planner
> consumes.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 0-XX-YY | XX | N | REQ-XX | T-0-XX / — | (planner) | unit/integration/E2E/ci-gate | `(planner)` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` + `tests/setup.ts` — Vitest bootstrap with Postgres testcontainer hook
- [ ] `playwright.config.ts` + `e2e/fixtures/tenants.ts` — Playwright bootstrap with two-tenant fixture
- [ ] `pnpm add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testcontainers/postgresql playwright @playwright/test` — framework install
- [ ] CI workflow file (`.github/workflows/ci.yml`) runs `pnpm test:unit` on every PR (blocking)

*Foundation phase: no existing infrastructure — Wave 0 stands the test rig up from scratch.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Email verification link arrives in inbox | AUTH-02 | Real mailbox delivery is out-of-process; mailpit covers local + Resend webhook covers prod | Sign up locally with mailpit running; check `localhost:8025` shows the verification email and clicking the link verifies the account |
| Coolify deploy publishes semver tag under TLS | FOUND-13 | Coolify dashboard is the source of truth; not scriptable from repo | After CI pushes `fb-eventos-web:0.0.1` to GHCR, trigger Coolify deploy, confirm `https://app.fb-eventos.com.br/api/health` returns 200 with valid Let's Encrypt cert |
| LGPD consent text accepted in signup form | LGPD-01 | Visual/legal review — content correctness, not just field presence | Open `/signup`, verify consent checkbox + version label + link to política de privacidade are visible and required |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Vitest + Playwright + CI workflow)
- [ ] No watch-mode flags (CI must exit, not hang)
- [ ] Feedback latency < 30s for unit suite
- [ ] `nyquist_compliant: true` set in frontmatter after planner populates per-task map

**Approval:** pending
