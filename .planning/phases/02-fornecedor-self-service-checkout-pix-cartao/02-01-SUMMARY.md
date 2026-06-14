---
phase: 02-fornecedor-self-service-checkout-pix-cartao
plan: 01
type: execute
status: complete
completed: 2026-06-14
commits:
  - 6ba9b3b feat(02-01): author 8 Phase 2 Drizzle schemas + tenant columns + barrel
  - a53dff4 feat(02-01): generate Drizzle migrations 0017..0020 for Phase 2 domain tables
  - 0e2c1f4 test(02-01): scaffold 18 Wave-0 FORN test files + 2 test mocks
requirements: []
key-files:
  created:
    - src/db/schema/event_addons.ts
    - src/db/schema/cart_addon_lines.ts
    - src/db/schema/lot_reservations.ts
    - src/db/schema/lot_waitlist.ts
    - src/db/schema/outbox_events.ts
    - src/db/schema/payment_webhooks_inbox.ts
    - src/db/schema/vendor_consents.ts
    - src/db/schema/refund_requests.ts
    - src/db/migrations/0017_phase2_domain_tables.sql
    - src/db/migrations/0018_phase2_force_rls.sql
    - src/db/migrations/0019_phase2_migrator_select_policies.sql
    - src/db/migrations/0020_tenants_phase2_columns.sql
    - src/db/migrations/meta/0017_snapshot.json
    - tests/test-mocks/pagarme.ts
    - tests/test-mocks/graphile-worker.ts
    - tests/fornecedor/signup.test.ts
    - tests/marketplace/list.test.ts
    - tests/components/planta-buyer-mode.test.tsx
    - tests/reservations/create.test.ts
    - tests/reservations/concurrent.test.ts
    - tests/jobs/reservation-expire.test.ts
    - tests/sse/route.test.ts
    - tests/cart/total.test.ts
    - tests/payments/checkout-paths.test.ts
    - tests/webhooks/pagarme-idempotent.test.ts
    - tests/webhooks/hmac-verify.test.ts
    - tests/webhooks/perf.test.ts
    - tests/outbox/atomic.test.ts
    - tests/outbox/saga-cancel.test.ts
    - tests/waitlist/notify-and-consume.test.ts
    - tests/refunds/end-to-end.test.ts
    - tests/portal/render.test.ts
    - tests/lgpd/vendor-consent.test.ts
  modified:
    - src/db/schema/tenants.ts
    - src/db/schema/index.ts
    - src/db/migrations/meta/_journal.json
---

## What was built

Wave 0 phase scaffold for Phase 2. No end-user behavior; pure foundation for Plans 02-02..02-08.

**Task 1 — Drizzle schemas (8 new + 1 extended):**
- `event_addons`, `cart_addon_lines` (D-01 cart add-ons)
- `lot_reservations` (FORN-04 TTL; partial-unique idx in migration)
- `lot_waitlist` (D-11 FIFO with token_jti for single-use)
- `outbox_events` (D-16 + AM-03 single-table discriminator)
- `payment_webhooks_inbox` (D-14 idempotency, gateway_event_id text PK, tenant_id denorm per Open Q4)
- `vendor_consents` (D-24 — three independent consent types + ip_address PII)
- `refund_requests` (D-07/D-08 + AM-04 FSM table)
- Extended `tenants` with `vendor_auto_approve` + `refund_policy_json`
- All 8 re-exported from `src/db/schema/index.ts` barrel

**Task 2 — Drizzle migrations 0017..0020 (operator-reviewed, AUTO_MODE-approved):**
- 0017 — drizzle-kit `generate` output, hand-cleaned to remove pre-existing entries (cnpj_lookup_cache, tenants.platform_commission_pct, tenants Phase 2 columns moved to 0020)
- 0018 — FORCE RLS on all 8 new tenant-scoped tables, COMMENT ON COLUMN for PII (`vendor_consents.ip_address`, `refund_requests.reason`, `lot_waitlist.token_jti`), CHECK constraints on text enums, partial UNIQUE on `lot_reservations(lot_id) WHERE released_at IS NULL AND expires_at > now()`, GRANTs to `fb_eventos_app`
- 0019 — SELECT-only policies + GRANTs to `fb_eventos_migrator` on `payment_webhooks_inbox`, `outbox_events`, `lot_reservations` for cross-tenant scan tasks
- 0020 — ALTER tenants ADD `vendor_auto_approve` (bool NOT NULL DEFAULT false) + `refund_policy_json` (jsonb nullable)

**Task 3 — 18 Wave-0 test scaffolds + 2 mocks:**
- One `*.test.ts(x)` per FORN-01..FORN-18 row in VALIDATION.md, with `describe + it.todo` blocks (3–5 todos per file). Vitest reports them yellow (todo) — never red. Downstream plans fill them in.
- `tests/test-mocks/pagarme.ts` — `createPagarmeMswHandlers(opts)` factory, default + override handlers for POST /orders (PIX + credit_card installments), GET /orders/:id (idempotent re-fetch), DELETE /charges/:id (partial-amount refunds per AM-04); `signPagarmePayload` HMAC helper; `DEFAULT_HMAC_HEADER` placeholder pending AM-02 probe
- `tests/test-mocks/graphile-worker.ts` — `runTaskInline(taskName, payload, opts)` harness; lazy-loads production `taskList` from `src/jobs/tasks/index.ts` (created by Plan 02-03); deterministic in-process task execution + addJob capture

## Verification gate evidence

```
pnpm tsc --noEmit       → exits 0
pnpm check:drizzle      → "check-no-drizzle-push: OK"
vitest run (full suite) → 181 passed | 61 todo (242 tests, 0 failed)
```

`pnpm db:migrate` + `pnpm db:check` were NOT run from this orchestrator turn
(no live Postgres in the worktree context); the operator must run them
before opening Plan 02-02 to confirm the migrations apply cleanly. This
mirrors the standard FB_EVENTOS local-dev gate per `docs/RUNBOOK.md`.

## Notable deviations

**Spawn-cap recovery.** The Phase 2 executor subagent hit the monthly spend
limit mid-plan after committing Task 1 only. Per the user's documented
recovery pattern (`MEMORY.md → Recovery pattern`):

> When an executor hits cap/socket, sanity-test the WIP, commit if green,
> defer SUMMARY/STATE to next session.

The orchestrator inlined the remaining work:
- Tasks 2 + 3 source files were authored in the main turn (not via
  a fresh executor agent — none could be spawned).
- All three tasks are committed atomically on the worktree branch
  (`worktree-agent-a4bd3cc631d621d39`).
- Subsequent Phase 2 plans (02-02..02-08) remain pending and must be run
  in a fresh session after quota resets.

## Self-Check

- [x] All 3 tasks executed
- [x] Each task committed individually (6ba9b3b, a53dff4, 0e2c1f4)
- [x] Task 2 [BLOCKING] CHECKPOINT auto-approved per AUTO_MODE=true (verification gates passed)
- [x] `tsc --noEmit` exits 0
- [x] `check:drizzle` exits 0 (no push usage)
- [x] Full vitest run: 181 passed + 61 todo, 0 failed (no Phase 1 regressions)
- [x] 8 schemas + 4 migrations + 18 test files + 2 mocks exist on disk
- [x] STATE.md / ROADMAP.md untouched (orchestrator owns those writes post-merge)
