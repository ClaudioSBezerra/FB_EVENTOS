---
phase: 01
slug: organizadora-end-to-end-piloto-festa-de-trindade
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-13
source: 01-RESEARCH.md §Validation Architecture
---

# Phase 1 — Validation Strategy

> Per-phase validation contract derived from RESEARCH.md §Validation Architecture.
> Wave 0 = test infrastructure expansion (external API mocks, MinIO test harness, vendor/event factories) BEFORE feature plans land.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 (unit + integration) + @playwright/test 1.60.0 (E2E walking skeleton) |
| **Config file** | `vitest.config.ts` (Phase 0) + `playwright.config.ts` (Phase 0) |
| **Quick run command** | `pnpm test --run` |
| **Full suite command** | `pnpm test --run && pnpm typecheck && pnpm lint && pnpm check:all && pnpm test:e2e` |
| **Estimated runtime** | ~50s Vitest (current 61 tests + ~17 Phase 1 tests projected); ~3 min Playwright walking-skeleton |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test --run`
- **After every plan wave:** Run `pnpm test --run && pnpm typecheck && pnpm lint && pnpm check:all`
- **Before `/gsd:verify-work`:** Full suite green + D-14 walking-skeleton 4-step gate (signup → planta+lote → PIX sandbox paid → contrato sandbox signed)
- **Max feedback latency:** 90 seconds for quick command; 5 min for full

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| ORG-01 | Event create + list scoped to tenant | integration (Vitest) | `pnpm test tests/eventos/event-crud.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-02 | Planta upload (pre-signed PUT URL minted; statObject confirms content-type + size ≤ 25 MB) | integration | `pnpm test tests/eventos/planta-upload.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-03 | Konva editor renders planta — smoke (no pixel-check in CI; canvas presence + tool-bar rendering) | e2e (Playwright) | `pnpm test:e2e tests/e2e/planta-editor.spec.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-04 | Geometry jsonb validates `v1.polygon2d` shape; rejects malformed | integration | `pnpm test tests/lotes/geometry-validation.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-05 | Auto-save Server Action persists geometry per-lot inside `withTenant`; debounce documented in component but tested via API | integration | `pnpm test tests/lotes/auto-save.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-06 | Lot categories CRUD with `base_fixed + per_sqm_rate`; aditivo math `lote.price = base + area_m² × rate` | integration | `pnpm test tests/lotes/categories.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-07 | Vendor list/search/filter by status (pending/approved/rejected) | integration | `pnpm test tests/fornecedores/list.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-08 | Vendor approve/reject FSM → `audit_log` row + email enqueue (Resend job) | integration | `pnpm test tests/fornecedores/approval.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-09 | Lot assignment requires `vendor.status='approved'`; assignment creates audit row | integration | `pnpm test tests/lotes/assignment.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-10 | PDF generation Graphile-Worker job produces buffer + uploads to MinIO mock (template_version stored on contract) | integration | `pnpm test tests/contracts/pdf-gen.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-11 | ZapSign send (mocked HTTP) — request body shape + sequential signer order; webhook callback updates contract FSM | integration | `pnpm test tests/contracts/zapsign-send.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-12 | Pagar.me create order (mocked HTTP) — PIX QR + copia-cola shape; cartão shape; webhook re-fetch confirms `paid` before marking | integration | `pnpm test tests/payments/pagarme-create.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-13 | Occupancy dashboard aggregates correct % vendido R$ + % vendido m² + Konva read-only color mapping | integration | `pnpm test tests/eventos/dashboard-aggregates.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-14 | Financial dashboard aggregates from `payments` table (recebido / a receber / comissão calculada) | integration | `pnpm test tests/eventos/financial-aggregates.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-15 | Vendor doc cofre — pre-signed GET issued (TTL 15min) + audit_log row on download | integration | `pnpm test tests/fornecedores/doc-vault.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-16 | BrasilAPI CNPJ lookup happy path + 404 + 5xx degrade (`cnpj_verified=false` flag); 7-day cache | integration | `pnpm test tests/fornecedores/brasilapi.test.ts` | ❌ Wave 0 | ⬜ pending |
| ORG-17 | Email send queues correct template (5 templates) for each status change | integration | `pnpm test tests/fornecedores/notifications.test.ts` | ❌ Wave 0 | ⬜ pending |
| **D-14 gate** | Walking-skeleton E2E: signup organizadora + planta upload + 1 lot + PIX sandbox paid + contrato sandbox signed | e2e | `pnpm test:e2e tests/e2e/walking-skeleton.spec.ts` | ⚠ Phase 0 file exists; **EXTEND** in Phase 1 | ⬜ pending |

---

## Wave 0 Requirements (Test Infrastructure)

- [ ] `src/test/external-mocks.ts` — Shared MSW (Mock Service Worker) OR in-memory `fetch` interceptor harness for ZapSign + Pagar.me + BrasilAPI
- [ ] `src/test/minio-test.ts` — MinIO test container (testcontainers-node) OR in-memory mock helper that mimics pre-signed PUT/GET + statObject
- [ ] `src/test/factories/event-factory.ts` — `makeEvent(overrides)` builds an event row + minimum lots; respects RLS via `withTenant`
- [ ] `src/test/factories/vendor-factory.ts` — `makeVendor(overrides)` builds a vendor row with CNPJ stub (BrasilAPI mock pre-seeded)
- [ ] `src/test/factories/lot-factory.ts` — `makeLot(overrides)` builds a lot with `geometry: v1.polygon2d` and category
- [ ] `tests/eventos/event-crud.test.ts` — Wave 0 stub for ORG-01 (red GREEN target)
- [ ] `tests/eventos/planta-upload.test.ts` — Wave 0 stub for ORG-02
- [ ] `tests/e2e/planta-editor.spec.ts` — Wave 0 stub for ORG-03 (Playwright canvas presence)
- [ ] `tests/lotes/{geometry-validation,auto-save,categories,assignment}.test.ts` — Wave 0 stubs for ORG-04, 05, 06, 09
- [ ] `tests/fornecedores/{list,approval,doc-vault,brasilapi,notifications}.test.ts` — Wave 0 stubs for ORG-07, 08, 15, 16, 17
- [ ] `tests/contracts/{pdf-gen,zapsign-send}.test.ts` — Wave 0 stubs for ORG-10, 11
- [ ] `tests/payments/pagarme-create.test.ts` — Wave 0 stub for ORG-12
- [ ] `tests/eventos/{dashboard-aggregates,financial-aggregates}.test.ts` — Wave 0 stubs for ORG-13, 14
- [ ] **EXTEND** `tests/e2e/walking-skeleton.spec.ts` with D-14 4-step gate sequence

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual fidelity of Konva polygon editor — actual drawing UX (snap, hover, transformer handles position) | ORG-03, ORG-05 | Canvas-rendered, automated pixel comparison is flaky in CI | Manual: load `/[slug]/eventos/[id]/planta`, draw 3 polygons, move/resize/delete; expect responsive UX < 50ms latency |
| PDF visual layout of generated contract | ORG-10 | @react-pdf/renderer layout differs from preview; needs eyeball check | Manual: trigger contract generation job locally, open PDF in viewer, validate header/clauses/signer-block alignment |
| Resend email rendering across Gmail/Outlook/Apple Mail clients | ORG-17 | Email client variance is notoriously hard to test in CI | Manual via Resend dashboard preview + send to a real test inbox before Phase 1 ships |
| Sandbox → production flip (D-14 gate) | D-14 | Touches real third-party billing endpoints; one-time per piloto | Operator runs walking-skeleton E2E in sandbox, verifies all 4 steps green, flips env vars in Coolify UI |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (17/17 requirements mapped to commands + 1 E2E gate)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (planner must distribute tests across plans)
- [ ] Wave 0 covers all MISSING references (external-mocks, minio-test, 3 factories)
- [ ] No watch-mode flags (all commands use `--run`)
- [ ] Feedback latency < 90s (Vitest quick), < 5min (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — set to `approved YYYY-MM-DD` after gsd-plan-checker green-lights the plans.
