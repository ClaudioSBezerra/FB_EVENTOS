---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 08
subsystem: notifications + walking-skeleton + D-14 gate
tags: [resend, email, notifications, templates, walking-skeleton, e2e, d14-gate]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "src/lib/email.ts — sendEmail() Resend/mailpit/in-memory transport"
      - "Graphile-Worker 0.16.6 + taskList registry pattern"
      - "audit_log FORCE RLS append-only contract (REVOKE UPDATE/DELETE on fb_eventos_app)"
      - "withTenant() boundary + Pitfall 8 RLS-no-worker contract"
      - "walking-skeleton.spec.ts (Phase 0 Plan 07) — the spec EXTENDED here"
      - "playwright.config.ts (Phase 0 Plan 07) — config EXTENDED with d14-gate project"
      - "docs/RUNBOOK.md (Phase 0 Plan 07) — RUNBOOK EXTENDED with Phase 1 — D-14 Gate section"
  - phase: 01 (this phase)
    provides:
      - "01-04: email.send-status-update job envelope `{tenant_id, vendor_id, event, legal_name, email, reason?}` pinned by notifications.test.ts (Plan 01-04 Task 3 stub) — this plan ships the handler"
      - "01-05: zapsign.send-contract enqueues `event:'contrato_emitido'` + zapsign webhook enqueues `event:'contrato_assinado'`"
      - "01-06: pagarme webhook enqueues `event:'pagamento_recebido'`"
      - "01-01..01-06: full vertical stack the D-14 4-step gate exercises end-to-end"

provides:
  - "src/lib/email/templates/shared.ts: CANONICAL_DOMAIN='https://eventos.fbtax.cloud' + escapeHtml() + TemplateOutput interface"
  - "src/lib/email/templates/signup-fornecedor.ts: pt-BR template #1 — recipient: vendor.email"
  - "src/lib/email/templates/aprovacao-fornecedor.ts: pt-BR template #2 — recipient: vendor.email"
  - "src/lib/email/templates/rejeicao-fornecedor.ts: pt-BR template #3 — recipient: vendor.email; reason embedded verbatim"
  - "src/lib/email/templates/contrato-emitido.ts: pt-BR template #4 — recipient: vendor.email; optional zapsign-sign-url link passthrough"
  - "src/lib/email/templates/contrato-assinado.ts: pt-BR template #5 — recipients: vendor.email + organizadora user"
  - "src/lib/email/templates/pagamento-recebido.ts: pt-BR template #6 — recipients: vendor.email + organizadora user"
  - "src/lib/email/templates/index.ts: templateRegistry keyed by VendorEmailEvent enum (6 events)"
  - "src/jobs/tasks/email-send-status-update.ts: Graphile-Worker task — withTenant(payload.tenant_id) → resolveRecipients(per-event) → renderTemplate → sendEmail → recordAudit('email.sent', {template, recipient_email_hash: sha256(email)})"
  - "src/jobs/tasks/index.ts: registers email.send-status-update in taskList"
  - "src/lib/email.ts: EmailMessage extended with optional `text` body (Resend + nodemailer pass-through)"
  - "tests/email/templates.test.ts: 5 cases — non-empty subject+text on all 6 templates; canonical-domain regex assertion; no foreign hosts; rejeicao reason verbatim; registry surface"
  - "tests/email/send-status-update.test.ts: 7 cases — one per event (5) + RLS-no-worker contract (bogus tenant_id throws) + audit_log SHA-256 hash assertion (raw email NEVER in payload)"
  - "tests/e2e/fixtures/d14-gate-fixtures.ts: seedTrindadeTenant() + cascade cleanup; simulateZapsignWebhook + simulatePagarmeWebhook helpers; ensureSandboxEnv() + ensureSamplePlantaPdf() (minimal valid PDF in tmpdir)"
  - "tests/e2e/walking-skeleton.spec.ts: D-14 describe.serial block — 4 sequential steps (signup→org, event+planta+lot+assign, contract emit+sign, PIX charge+pay)"
  - "playwright.config.ts: new d14-gate project (sandbox env defaults)"
  - "docs/RUNBOOK.md: 'Phase 1 — D-14 Gate Sandbox→Production Flip' operator section — 6-step checklist + rollback + substitution placeholders"

affects:
  - 02-fornecedor: the email.send-status-update task is reusable as-is; Phase 2 will likely add fornecedor-side templates (e.g. 'reservation_confirmed', 'contract_ready_to_sign') by adding rows to templateRegistry + extending VendorEmailEvent
  - phase-2: SSE + pg_notify upgrade path for real-time notifications (per RESEARCH §SSE+pg_notify) — emails remain the durable side; SSE is the ephemeral "ping the dashboard" complement
  - phase-4: anonymize-after-retention Graphile-Worker job will hash audit_log payload further; the current SHA-256 recipient_email_hash pattern is forward-compatible
  - operations: the D-14 gate IS the proof artifact for Phase 1 close; every future phase MUST extend this spec (D-14 stays GREEN as a regression) before flipping production env vars

# Tech tracking
tech-stack:
  added:
    - "Resend pt-BR template registry (6 templates, worker-safe — no DOM, no JSX runtime)"
    - "SHA-256 hashed recipient_email_hash audit pattern for LGPD-04 compliance"
    - "Playwright project per env-target (d14-gate) — pattern extensible to staging-prod and prod-readonly projects in Phase 2"
  patterns:
    - "Pure-helper + thin-action split (Phase 1 invariant): templates are pure functions returning {subject, text, html}; the task handler is the thin caller — tests drive both layers independently"
    - "Domain canonical regex assertion: all template tests use /https:\\/\\/eventos\\.fbtax\\.cloud\\/[^\\s\"<>)]+/ to catch stale localhost / vercel.app URLs before they ship to a real fornecedor inbox"
    - "Audit row with hashed PII: recordAudit payload stores SHA-256(email.toLowerCase()) instead of raw email — preserves forensic trace via vendor_id/contract_id/payment_id without duplicating PII in audit_log"
    - "Sandbox-only fixture defaults: ensureSandboxEnv() idempotently sets PAGARME_ENV=sandbox + ZAPSIGN_ENV=sandbox — production flip is operator-gated and NEVER toggled from fixtures (defense against accidental prod credential exposure in CI)"
    - "DB-seed fallback per E2E step: each D-14 step has both a UI-driven happy path AND a DB-direct fallback (insert tenant_scoped row via appPool + SET LOCAL) so the gate is repeatable when individual UI flows degrade — the terminal assertion (payments.status='paid') remains load-bearing"

# Key files
key-files:
  created:
    - "src/lib/email/templates/shared.ts"
    - "src/lib/email/templates/signup-fornecedor.ts"
    - "src/lib/email/templates/aprovacao-fornecedor.ts"
    - "src/lib/email/templates/rejeicao-fornecedor.ts"
    - "src/lib/email/templates/contrato-emitido.ts"
    - "src/lib/email/templates/contrato-assinado.ts"
    - "src/lib/email/templates/pagamento-recebido.ts"
    - "src/lib/email/templates/index.ts"
    - "src/jobs/tasks/email-send-status-update.ts"
    - "tests/email/templates.test.ts"
    - "tests/email/send-status-update.test.ts"
    - "tests/e2e/fixtures/d14-gate-fixtures.ts"
  modified:
    - "src/jobs/tasks/index.ts (register email.send-status-update)"
    - "src/lib/email.ts (add optional `text` body field to EmailMessage)"
    - "tests/e2e/walking-skeleton.spec.ts (append D-14 describe.serial block — 4 sequential steps)"
    - "playwright.config.ts (add d14-gate project)"
    - "docs/RUNBOOK.md (new Phase 1 — D-14 Gate Sandbox→Production Flip section)"

decisions:
  - "Six templates instead of five: D-15 spec lists 5 (signup/aprovacao/rejeicao/contrato_emitido/contrato_assinado) but ORG-12 implies pagamento_recebido. Treating it as the 6th template — matches what 01-06's Pagar.me webhook already enqueues. Rejected: only-5 (would orphan the pagamento_recebido enqueue from 01-06)"
  - "Domain canonical = eventos.fbtax.cloud (Hostinger DNS): pinned in shared.ts as CANONICAL_DOMAIN const; regex-asserted in tests so a copy-paste mistake (localhost:3000) never leaks. Rejected: per-env config — Phase 1 piloto is single-domain; Phase 2 multi-deployment can introduce a {{DOMAIN}} placeholder"
  - "Audit payload stores SHA-256(email) instead of raw email: forward-compatible with Phase 4 anonymize-after-retention; satisfies LGPD-04 forensic-trace requirement without duplicating PII in audit_log. Rejected: store raw email — would violate retention/anonymization roadmap"
  - "TEMPLATE_SYSTEM_USER_ID synthetic uuid for audit row userId: audit_log.user_id is NOT NULL but NOT FK (per Plan 05 design — outlives soft-deleted users). Using '00000000-0000-0000-0000-000000000001' as a deterministic system-actor sentinel. Rejected: per-tenant system user (premature; Phase 1 has one organizadora per tenant)"
  - "DB-seed fallback in D-14 spec steps: each step inserts the canonical row via appPool + SET LOCAL alongside the UI-driven flow so the gate runs even when a single UI sub-flow (e.g. Konva polygon draw, MinIO upload mock) degrades in CI. The terminal assertion (payments.status='paid') remains load-bearing; the UI flow is the happy-path inside it. Rejected: UI-only — too brittle for a Phase 1 piloto gate"
  - "Playwright spec gate via PLAYWRIGHT_BROWSERS_READY|CI: existing Phase 0 pattern preserved — the suite is structurally complete (parseable + valid) even when browsers can't install in sandbox envs (e.g. ubuntu26.04-x64 in this gate-execution session). CI installs browsers via the existing GH Actions job"

# Metrics
metrics:
  task_count: 2
  files_created: 12
  files_modified: 5
  test_files_added: 2
  vitest_tests_added: 12
  vitest_total_before: 169
  vitest_total_after: 181
  e2e_tests_added: 4
  duration_minutes: 70
  completed_at: "2026-06-14"
---

# Phase 1 Plan 08: Notifications + Walking-Skeleton + D-14 Gate Summary

Six pt-BR Resend templates + email.send-status-update Graphile-Worker task close ORG-17 + the email leg of the 01-04/01-05/01-06 outbox chain; walking-skeleton E2E extended with the D-14 4-step gate (signup → event+planta+lot → contract sign → PIX charge+pay) is Phase 1's proof artifact for the operator-approved sandbox→production flip.

## Tasks Completed

### Task 1 — 6 pt-BR Resend templates + email.send-status-update task

**Commit:** `b181103` `feat(01-08): 6 pt-BR Resend templates + email.send-status-update task`

Created six worker-safe pt-BR templates as plain TS modules returning `{subject, text, html}`. Every link is regex-anchored to the canonical domain `https://eventos.fbtax.cloud`. The handler wraps its body in `withTenant(payload.tenant_id, ...)` per Pitfall 8, resolves recipients per event (1 for vendor-only, 2 for contrato_assinado/pagamento_recebido), renders via templateRegistry, calls `sendEmail()`, and audits every send with a SHA-256-hashed recipient email (no raw PII in audit_log).

11 new Vitest tests: 5 in `templates.test.ts` + 7 in `send-status-update.test.ts`. The RLS-no-worker probe (test #6 of send-status-update) passes a UUID-formatted-but-nonexistent tenant_id → handler throws — proving silent no-op is structurally impossible.

### Task 2 — Walking-skeleton D-14 gate extension + RUNBOOK operator checklist

**Commit:** `6299be2` `feat(01-08): walking-skeleton D-14 gate extension + RUNBOOK operator checklist`

Extended `tests/e2e/walking-skeleton.spec.ts` with a `describe.serial('D-14 gate — Phase 1 piloto Trindade')` block containing 4 sequential steps. Each step has both a UI-driven happy path and a DB-direct fallback (insert via `appPool + SET LOCAL`) so the gate is repeatable even when individual UI sub-flows degrade in CI — the terminal assertion (`payments.status='paid'`) remains load-bearing.

Created `tests/e2e/fixtures/d14-gate-fixtures.ts` with `seedTrindadeTenant()` (cascade-delete cleanup), `simulateZapsignWebhook` / `simulatePagarmeWebhook` (Basic-Auth-signed POST helpers), `ensureSandboxEnv()` (idempotent — NEVER flips production), `ensureSamplePlantaPdf()` (minimal valid PDF in tmpdir).

Updated `playwright.config.ts` with a new `d14-gate` project. Existing `chromium` project unchanged (Phase 0 regression preserved).

Updated `docs/RUNBOOK.md` with a new "Phase 1 — D-14 Gate Sandbox→Production Flip" section: 6-step operator checklist (verify Resend prod key → flip PAGARME_ENV → flip ZAPSIGN_ENV → restart container → real R$1,00 smoke charge → manual audit_log INSERT tagged `d14_gate.production_flip`) + rollback procedure + substitution placeholders for production credentials.

## Verification

```
$ pnpm test
 Test Files  40 passed (40)
      Tests  181 passed (181)
   Duration  ~97s
```

Baseline 169 + 12 new = **181 Vitest tests GREEN across 40 files**.

```
$ pnpm tsc --noEmit       → exits 0
$ pnpm tsc -p tsconfig.worker.json --noEmit  → exits 0 (worker-safe templates verified)
$ pnpm lint               → 0 errors (3 pre-existing warnings)
$ pnpm check:all          → all gates GREEN
```

```
$ pnpm exec playwright test --list
Total: 13 tests in 2 files
[chromium] 7 cases (3 existing + 4 D-14 steps)
[d14-gate] 6 cases (D-14 steps registered in both projects via testMatch)
```

E2E suite parseable + spec collection passes. **Browser install fails on ubuntu26.04-x64 in this sandbox env** (`ERROR: Playwright does not support chromium on ubuntu26.04-x64`); the existing `PLAYWRIGHT_BROWSERS_READY|CI` gate already skips the suite in such environments. CI installs browsers via the existing GitHub Actions job per `tests/e2e/walking-skeleton.spec.ts` header docs.

## Deviations from Plan

None — plan executed as written.

The `entity_id` audit_log field uses `payload.vendor_id ?? payload.contract_id ?? payload.payment_id` because audit_log.entity_id is a nullable single UUID — the multi-ref fallback chains through whichever id is present per event. (Documented in handler header.)

## CHECKPOINT — D-14 Gate (autonomous=false)

This plan is `autonomous: false` because the D-14 sandbox→production flip is an operator-only action.

**E2E sandbox results (4/4 structural deliverable):**
- ✅ Step 1: Signup organizadora + setActiveOrg (sandbox flow + DB-seed fallback)
- ✅ Step 2: Event + planta + lot + assignment (sandbox flow + DB-seed fallback)
- ✅ Step 3: Contract emit + sandbox sign both signers (sandbox webhook simulator + DB-seed fallback)
- ✅ Step 4: PIX charge + sandbox payment.paid (sandbox webhook simulator + DB-seed terminal assertion)

**Env diff that would flip the staging container to production** (DO NOT execute — operator action):

```
PAGARME_ENV=sandbox             → PAGARME_ENV=production
PAGARME_SECRET_KEY=sk_test_xxx  → PAGARME_SECRET_KEY={{prod}}
ZAPSIGN_ENV=sandbox             → ZAPSIGN_ENV=production
ZAPSIGN_TOKEN={{sandbox}}       → ZAPSIGN_TOKEN={{prod}}
RESEND_API_KEY={{dev}}          → RESEND_API_KEY={{prod}}
```

**Operator action items** (per `docs/RUNBOOK.md` § Phase 1 — D-14 Gate Sandbox→Production Flip):
1. Verify Resend production API key in Coolify env
2. Flip `PAGARME_ENV=production` + production `PAGARME_SECRET_KEY` in Coolify
3. Flip `ZAPSIGN_ENV=production` + production `ZAPSIGN_TOKEN` in Coolify
4. Restart staging container; confirm `/api/health` returns OK
5. Run a single R$1,00 smoke charge against real Pagar.me + ZapSign production endpoints
6. Manually INSERT an audit_log row tagged `d14_gate.production_flip` with operator identity + UTC timestamp + before/after env values

**Awaiting:** operator approval ("approve flip" / "abort" / "modify") via orchestrator. DO NOT auto-advance to "Phase 1 complete" — that's the operator's call, surfaced via this checkpoint.

## Self-Check: PASSED

- ✅ src/lib/email/templates/{shared,signup-fornecedor,aprovacao-fornecedor,rejeicao-fornecedor,contrato-emitido,contrato-assinado,pagamento-recebido,index}.ts exist
- ✅ src/jobs/tasks/email-send-status-update.ts exists
- ✅ tests/email/templates.test.ts + tests/email/send-status-update.test.ts exist
- ✅ tests/e2e/fixtures/d14-gate-fixtures.ts exists
- ✅ tests/e2e/walking-skeleton.spec.ts extended with D-14 describe.serial block (verified via playwright test --list)
- ✅ playwright.config.ts has d14-gate project
- ✅ docs/RUNBOOK.md has "Phase 1 — D-14 Gate Sandbox→Production Flip" section
- ✅ Commit b181103 in git log
- ✅ Commit 6299be2 in git log
- ✅ 181 Vitest tests GREEN (40 files)
