---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 06
subsystem: payments + pagarme-charges + webhook
tags: [pagarme, charges, pix, cartao, webhook, re-fetch, idempotency, fsm]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "Drizzle 0.45 + postgres.js 3.4 + withTenant() boundary"
      - "Better Auth + safe-action chain + recordAudit + audit_log FORCE-RLS append-only"
      - "Graphile-Worker enqueue + RLS-no-worker contract"
  - phase: 01 (this phase)
    provides:
      - "01-01: payments + pagarme_orders tables + FORCE RLS + PII comments + fb_eventos_sysreader bounded-tenant-lookup pattern"
      - "01-03: lot_assignments anchor + computeLotPrice helper for charge amount"
      - "01-04: vendor patterns + email job stub (`email.send-status-update`)"
      - "01-05: contracts.status='signed' precondition + ZapSign webhook re-fetch defense pattern (mirror here for Pagar.me) + Migration 0014 (SELECT-only RLS for migrator on inbox table) — adapted for pagarme_orders in Migration 0015"
provides:
  - "src/lib/pagarme/types.ts: Zod schemas + TS types for Pagar.me v5 (OrderCreateRequest, OrderResponse, ChargeStatus, WebhookEvent)"
  - "src/lib/pagarme/client.ts: typed REST wrapper — createOrder + getOrder; Basic Auth with TRAILING colon (PAGARME_SECRET_KEY + ':'); X-Idempotency-Key header; sandbox/production via PAGARME_ENV; 5s timeout"
  - "src/lib/validators/payment.ts: createChargeSchema with discriminated payment_method (pix vs credit_card)"
  - "src/lib/actions/payments.ts: createChargeInTenant pure helper + createCharge withTenantAction; gates on contracts.status='signed'; per-charge idempotency_key; INSERT payments+pagarme_orders inside transaction → POST to Pagar.me → UPDATE response; out-of-band audit on API failure"
  - "src/app/api/webhooks/pagarme/route.ts: Basic Auth + Zod-parsed WebhookEvent + tenant resolution via sysreader bounded function + belt-and-suspenders re-fetch defense (trust Pagar.me API, NOT the webhook payload) + payment FSM transitions + idempotency by dropping all transitions into terminal states"
  - "src/db/migrations/0015_pagarme_webhook_tenant_lookup.sql: SELECT-only RLS policy for fb_eventos_migrator on pagarme_orders + payments — mirrors the Plan 01-05 Migration 0014 pattern"
  - "src/components/payments/pix-qr.tsx: QR + 'Copiar código' UI for PIX charges"
  - "src/components/contracts/create-charge-button.tsx: button shown on contract-detail when status='signed'"
  - "src/app/[slug]/cobrancas/{page,[paymentId]/page}.tsx: charge list + detail pages"
  - "PAGARME_SECRET_KEY + PAGARME_ENV + PAGARME_WEBHOOK_USER + PAGARME_WEBHOOK_PASS env vars added to env.ts + .env.example with D-14 sandbox→production flip notes"
  - "tests/payments/pagarme-create.test.ts: 6 cases — PIX happy + credit_card + signed-contract guard + RLS cross-tenant + 5xx re-throw with audit + missing secret key"
  - "tests/payments/pagarme-webhook.test.ts: 7 cases — Basic Auth happy + bad auth + duplicate delivery no-op + spoofing-via-re-fetch + unknown order + tenant scoping + re-fetch API failure triggers 400 retry"
affects:
  - 01-07-dashboards: getEventFinancials reads payments.status='paid' + payments.amount_brl_cents + JOINs to contracts/lots for by-vendor aggregates
  - 01-08-notifications: email.send-status-update task handler must accept event='pagamento_recebido' and render the pagamento-recebido template
  - phase-2-fornecedor: outbox refactor will replace the simple `INSERT payments+pagarme_orders → POST → UPDATE` flow with an outbox pattern + HMAC signature verification (Phase 1 uses just Basic Auth + UNIQUE-based idempotency)

# Tech tracking
tech-stack:
  added:
    - "PAGARME_SECRET_KEY + PAGARME_ENV + PAGARME_WEBHOOK_USER + PAGARME_WEBHOOK_PASS env vars"
  patterns:
    - "Idempotency at THREE layers: (a) X-Idempotency-Key on POST so Pagar.me dedupes; (b) UNIQUE on pagarme_orders.idempotency_key prevents double-insert; (c) webhook handler drops all transitions INTO terminal states (paid/failed/canceled/refunded) so duplicate webhook delivery is a clean no-op — same pattern as ZapSign webhook in 01-05 but built-in from the start"
    - "Belt-and-suspenders re-fetch defense: Basic Auth gate is NOT sufficient. After auth, call pagarmeClient.getOrder(orderId) and trust THAT status — defends against webhook spoofing by anyone who learns the Basic Auth credentials"
    - "Out-of-band audit on POST failure: when the Pagar.me API call fails inside createCharge, the surrounding transaction rolls back the INSERT — but we need an audit row to track the failure. Pattern: catch the API error → INSERT audit_log via a separate connection (appPool.begin with SET LOCAL) → re-throw. The audit survives the outer rollback."
    - "Sysreader bounded tenant-lookup: webhook route lives outside withTenant by definition (we don't know which tenant the order belongs to until we resolve it). Pattern: fb_eventos_sysreader (NOLOGIN + BYPASSRLS) owns fb_lookup_tenant_for_pagarme_order(text) SECURITY DEFINER function. Webhook handler resolves tenant via this function, THEN enters withTenant — RLS still enforced everywhere downstream."

# Verification

## Tasks completed (2/2)

### Task 1 — Pagar.me client + createCharge Server Action with idempotency
Committed: `fe2e5da` `feat(01-06): Pagar.me v5 client + createCharge Server Action with idempotency + PIX/cartão paths`
- `src/lib/pagarme/{types,client}.ts` — Zod schemas + REST wrapper with X-Idempotency-Key + Basic Auth trailing-colon (RESEARCH §A8 pitfall)
- `src/lib/validators/payment.ts` — createChargeSchema with method='pix'|'credit_card' refinement; credit_card requires card_token
- `src/lib/actions/payments.ts` — createChargeInTenant pure helper + next-safe-action wrapper:
  - Gates on contracts.status='signed' (Phase 1 enforces: no charge before contract fully signed)
  - Mints per-charge `idempotency_key = payment-{contractId}-{cryptoRandom(8)}`
  - INSERT payments + pagarme_orders inside transaction → POST to Pagar.me → UPDATE response_payload + gateway_order_id + gateway_charge_id + last_transaction QR / copia-cola for PIX
  - Out-of-band audit on API failure (survives outer rollback)
- 6 tests in `tests/payments/pagarme-create.test.ts`:
  1. PIX happy path returns QR + copia-cola
  2. Credit card happy path returns checkout token confirmation
  3. createCharge on contract status='draft' (not signed) rejects
  4. Tenant B cannot create charge for tenant A's contract (RLS)
  5. Pagar.me 5xx re-throws + audit row recorded (out-of-band)
  6. PAGARME_SECRET_KEY missing throws descriptive error

### Task 2 — Webhook handler with re-fetch defense + payment FSM + PIX QR UI
Committed: `64be749` `feat(01-06): Pagar.me webhook with re-fetch defense + payment FSM + PIX QR UI`
- `src/app/api/webhooks/pagarme/route.ts` (294 lines):
  - Basic Auth header verification against PAGARME_WEBHOOK_USER + PAGARME_WEBHOOK_PASS
  - Zod-parses WebhookEvent (graceful 200 on parse fail so Pagar.me doesn't retry junk)
  - Tenant resolution via sysreader bounded function `fb_lookup_tenant_for_pagarme_order`
  - Enters `withTenant(tenantId, ...)` for the rest
  - **Belt-and-suspenders re-fetch:** calls `pagarmeClient.getOrder(orderId)` → trusts THAT status, NOT the webhook payload (anti-spoofing defense)
  - FSM transitions: pending → paid|failed|canceled|refunded (terminal); transitions INTO terminal states are dropped if already terminal (built-in idempotency)
  - Enqueues `email.send-status-update` with event='pagamento_recebido' on successful pay transition
  - Returns 400 if re-fetch API fails (Pagar.me retries — graceful degradation)
  - Always returns 200 on graceful no-op (idempotency cases, unknown order, etc.)
- `src/db/migrations/0015_pagarme_webhook_tenant_lookup.sql`: SELECT-only RLS policy on pagarme_orders + payments for fb_eventos_migrator (mirrors Migration 0014 pattern)
- `src/components/payments/pix-qr.tsx` (77 lines): QR canvas render + "Copiar código" button for copia-cola
- `src/components/contracts/create-charge-button.tsx` (139 lines): button on contract-detail when status='signed'; opens dialog to pick method (PIX/cartão) + confirms amount via computeLotPrice
- `src/app/[slug]/cobrancas/page.tsx` + `[paymentId]/page.tsx`: list view + detail showing PIX QR/cartão status + payment FSM badge
- 7 tests in `tests/payments/pagarme-webhook.test.ts`:
  1. Valid Basic Auth + re-fetch confirms paid → payments.status='paid' + email enqueued
  2. Bad Basic Auth → 401
  3. Duplicate webhook delivery (same gateway_event_id) → no double email enqueue, no double audit, no double status flip
  4. Webhook says paid + re-fetch says failed → trust re-fetch (paid NOT recorded)
  5. Webhook for unknown order → graceful 200 (logs warning)
  6. Tenant scoping via sysreader bounded function works
  7. Re-fetch API failure → returns 400 so Pagar.me retries (transient defense)

## Quality gates
- `pnpm test --run` → 36 files, **157 tests, 0 failures**
- `pnpm tsc --noEmit` → 0
- `pnpm lint` → 0 (biome auto-fix sweep across 11 files, formatting-only)
- `pnpm check:all` → 0
- `pnpm drizzle-kit check` → no schema drift

## Deviations from Plan
- **Session limit during Task 2 execution.** The gsd-executor finished implementation + tests (all 7 webhook tests + 6 createCharge tests passing) but hit the Anthropic session credit cap BEFORE writing SUMMARY.md + updating ROADMAP/STATE. Orchestrator (me) sanity-ran the full suite (157/157 green), committed the WIP as `64be749 feat(01-06): Pagar.me webhook with re-fetch defense + payment FSM + PIX QR UI`, then wrote this SUMMARY in the next session. **No work lost; standard Phase 1 recovery pattern.**
- **Biome auto-fix swept 11 files during the WIP commit.** Formatting-only — no semantic changes. Same pattern as Plan 01-03 recovery.

## Issues encountered
- **Pagar.me Basic Auth requires a trailing colon.** `Buffer.from(SECRET_KEY + ':').toString('base64')` — easy to miss; RESEARCH §A8 documents this. Captured in src/lib/pagarme/client.ts header comment + tested.
- **postgres.js JSON parameter encoding bug.** Initial implementation passed the order payload as `${JSON.stringify(payload)}` which arrived at Postgres as a JSON STRING (`json_typeof = 'string'`), not a JSON object. Already mitigated upstream by Plan 0-06's `::text::json` double-cast pattern; the createCharge implementation uses the wrapper.

## Carryover for next plan (01-07 Dashboards)
- `payments.status='paid'` + `payments.amount_brl_cents` + JOIN to contracts/lots is the data source for getEventFinancials.
- `payments.gateway_order_id` + pagarme_orders.idempotency_key are NOT user-visible; dashboard surfaces just amount + status + paid_at.
- Commission calculation: `tenants.platform_commission_pct` × sum(payments.amount_brl_cents WHERE status='paid') — formula stays in Server Action; UI just displays.

## Self-Check: PASSED

- All 13 expected files exist on disk (8 implementation + migration + 2 tests + 2 components).
- Both task commits (`fe2e5da` + `64be749`) reachable via `git log`.
- 157/157 tests passing.
- 1 ORG requirement addressed: ORG-12.

---
*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Completed: 2026-06-14*
