---
phase: 02
slug: fornecedor-self-service-checkout-pix-cartao
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `02-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.6.x (existing) + Playwright 1.x (existing, Phase 1 E2E suite) |
| **Config file** | `vitest.config.ts` + `playwright.config.ts` (extend Phase 0/1 patterns) |
| **Quick run command** | `pnpm test --run` (~100s unit/integration) |
| **Full suite command** | `pnpm test --run && pnpm playwright test` (~5 min full E2E) |
| **Estimated runtime** | ~5 min full, ~100s quick |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --run` (≤100s feedback)
- **After every plan wave:** Run `pnpm test --run && pnpm playwright test --project=chromium`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Phase 2 D-14-equivalent gate:** `pnpm playwright test --project=phase2-gate` against Pagar.me sandbox + Trindade tenant must pass green before flipping production webhook auth from Basic Auth → HMAC and env vars
- **Max feedback latency:** ≤120 seconds for quick suite

---

## Phase 2 Requirements → Test Map

> Planner extends this with Task ID + Plan + Wave columns once `*-PLAN.md` files are written.

| REQ ID | Behavior | Test type | Automated Command | File Status |
|--------|----------|-----------|-------------------|-------------|
| FORN-01 | Vendor signup via `/[slug]/fornecedor/cadastro` creates vendor row + Better Auth member row | integration | `pnpm vitest tests/fornecedor/signup.test.ts -x` | ❌ Wave 0 |
| FORN-02 | `/[slug]/marketplace` lists tenant's published events; cross-tenant invisible | integration | `pnpm vitest tests/marketplace/list.test.ts -x` | ❌ Wave 0 |
| FORN-03 | Konva planta `mode='buyer'` blocks sold/reserved lots from click | unit (component) | `pnpm vitest tests/components/planta-buyer-mode.test.tsx -x` | ❌ Wave 0 |
| FORN-04 | Successful reservation creates `lot_reservations` row with `expires_at = now() + 15min` | integration | `pnpm vitest tests/reservations/create.test.ts -x` | ❌ Wave 0 |
| FORN-05 | Concurrent reserve attempts on same lot: exactly 1 wins, 49 × 409 | load test (concurrent) | `pnpm vitest tests/reservations/concurrent.test.ts -x` | ❌ Wave 0 — **load-bearing** |
| FORN-06 | Scheduled task `reservation.expire` releases expired reservations within 1 cron tick | integration | `pnpm vitest tests/jobs/reservation-expire.test.ts -x` | ❌ Wave 0 |
| FORN-07 | SSE Route Handler emits message after pg_notify in another connection | integration | `pnpm vitest tests/sse/route.test.ts -x` | ❌ Wave 0 |
| FORN-08 | Cart add-on lines compute total = lot_price + Σ add-on prices | unit | `pnpm vitest tests/cart/total.test.ts -x` | ❌ Wave 0 |
| FORN-09 | Pagar.me PIX + credit_card (installments 1, 6, 12) charge creation paths *(boleto deferred per AM-01)* | integration (MSW Pagar.me) | `pnpm vitest tests/payments/checkout-paths.test.ts -x` | ❌ Wave 0 |
| FORN-10 | Webhook delivered twice with same `gateway_event_id`: only 1 inbox row, only 1 FSM transition | integration | `pnpm vitest tests/webhooks/pagarme-idempotent.test.ts -x` | ❌ Wave 0 |
| FORN-11 | Valid HMAC accepted (200); invalid rejected (401). Header name pinned by probe-test (AM-02). | unit | `pnpm vitest tests/webhooks/hmac-verify.test.ts -x` | ❌ Wave 0 |
| FORN-12 | Webhook responds <100ms p95 (handler does inbox INSERT + enqueue only) | integration (perf) | `pnpm vitest tests/webhooks/perf.test.ts -x` | ❌ Wave 0 |
| FORN-13 | Outbox row + business write in same tx: rollback ⇒ neither persists | integration | `pnpm vitest tests/outbox/atomic.test.ts -x` | ❌ Wave 0 |
| FORN-14 | `payment.failed` outbox handler releases reservation atomically | integration | `pnpm vitest tests/outbox/saga-cancel.test.ts -x` | ❌ Wave 0 |
| FORN-15 | Waitlist email sent to top 3; JWT valid for 15 min; single-use enforced | integration | `pnpm vitest tests/waitlist/notify-and-consume.test.ts -x` | ❌ Wave 0 |
| FORN-16 | Refund Pagar.me sandbox call (`DELETE /core/v5/charges/{id}`) + outbox event + lot=released cascade | integration | `pnpm vitest tests/refunds/end-to-end.test.ts -x` | ❌ Wave 0 |
| FORN-17 | Portal pages render vendor's purchases + signed download URLs | integration | `pnpm vitest tests/portal/render.test.ts -x` | ❌ Wave 0 |
| FORN-18 | Recording consent inserts `vendor_consents` + audit row; revoke flips `revoked_at` | integration | `pnpm vitest tests/lgpd/vendor-consent.test.ts -x` | ❌ Wave 0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test infrastructure stubs the first plan must install before downstream plans can land. All listed test files are currently MISSING and tracked above.

- [ ] `tests/fornecedor/signup.test.ts` — fornecedor signup integration (FORN-01)
- [ ] `tests/marketplace/list.test.ts` — tenant-scoped event discovery (FORN-02)
- [ ] `tests/components/planta-buyer-mode.test.tsx` — Konva click-filter when `mode='buyer'` (FORN-03)
- [ ] `tests/reservations/create.test.ts` — happy-path reservation row creation (FORN-04)
- [ ] `tests/reservations/concurrent.test.ts` — **load-bearing**: 50 concurrent reserve attempts on same lot, assert exactly 1 win, 49 × 409 (FORN-05)
- [ ] `tests/jobs/reservation-expire.test.ts` — scheduled task releases expired reservations (FORN-06)
- [ ] `tests/sse/route.test.ts` — pg_notify from another tx → SSE client receives event (FORN-07)
- [ ] `tests/cart/total.test.ts` — cart total math (FORN-08)
- [ ] `tests/payments/checkout-paths.test.ts` — Pagar.me PIX + cartão installments (FORN-09)
- [ ] `tests/webhooks/pagarme-idempotent.test.ts` — same gateway_event_id delivered twice → single inbox + single side-effect (FORN-10)
- [ ] `tests/webhooks/hmac-verify.test.ts` — valid/invalid HMAC + header probe outcome pinned (FORN-11 + AM-02)
- [ ] `tests/webhooks/perf.test.ts` — <100ms p95 webhook response (FORN-12)
- [ ] `tests/outbox/atomic.test.ts` — outbox+business write rollback together (FORN-13)
- [ ] `tests/outbox/saga-cancel.test.ts` — payment.failed → reservation release SAGA (FORN-14)
- [ ] `tests/waitlist/notify-and-consume.test.ts` — full FORN-15 fan-out + JWT single-use
- [ ] `tests/refunds/end-to-end.test.ts` — refund call + outbox cascade + lot=released (FORN-16)
- [ ] `tests/portal/render.test.ts` — portal vendor purchases + signed URLs (FORN-17)
- [ ] `tests/lgpd/vendor-consent.test.ts` — vendor_consents insert + audit + revoke (FORN-18)
- [ ] `tests/test-mocks/pagarme.ts` — extend MSW handlers: HMAC signature shape, refund (DELETE), cancel, installments table, PIX response with `qr_code` + `qr_code_url`
- [ ] `tests/test-mocks/graphile-worker.ts` — in-process task runner harness for testing scheduled tasks deterministically
- [ ] `tests/e2e/walking-skeleton.spec.ts` — **extend** Phase 1 spec with D-14-equivalent Phase 2 block: signup fornecedor → marketplace → planta-buyer → reserve → PIX checkout → sandbox payment.paid → recibo email

Existing infrastructure reused from Phase 1: `tests/test-utils/dual-tenant.ts` (TENA-07), MSW server scaffold, Vitest config, Playwright config.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HMAC header name + algorithm + secret-rotation UI in Pagar.me dashboard | AM-02 (D-13 superseded) | External account UI; not scriptable. Phase 0 Plan 06 probe-test pattern captures the header name in a code asset that automates downstream. | Operator: log in to Pagar.me dashboard for FB_EVENTOS account, navigate to Webhooks → Signature settings; screenshot header name + algorithm. Drop into ADR-0005. Provide secret to env `PAGARME_WEBHOOK_SIGNING_SECRET`. |
| Pagar.me account allows boleto deferral verification | AM-01 | Negative confirmation; if account turns out to support Bolepix, AM-01 can be revisited in Phase 3. | Operator: confirm Pagar.me dashboard shows boleto as separate product; confirm no Bolepix toggle exists. |
| Phase 2 D-14-equivalent flip: production webhook auth Basic Auth → HMAC, env vars switched | AM-02 | Production-only side-effect with rollback risk; operator-approved CHECKPOINT mirroring Phase 1 D-14. | Follow `docs/RUNBOOK.md` Phase 2 — D-14 Gate section (created by planner). Run sandbox dress-rehearsal first; flip env vars; confirm one real fornecedor PIX purchase end-to-end on Trindade tenant. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s for quick suite
- [ ] `nyquist_compliant: true` set in frontmatter (planner flips this once per-task verification map is filled)

**Approval:** pending
