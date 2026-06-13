---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 06
type: execute
wave: 4
depends_on:
  - "01-04"
autonomous: true
requirements:
  - ORG-12
requirements_addressed:
  - ORG-12
tags:
  - pagarme
  - charges
  - pix
  - cartao
  - webhook
  - re-fetch
must_haves:
  truths:
    - "Server Action createCharge({contractId, method, amount}) creates Pagar.me v5 Order with 1 Charge (PIX QR + copia-cola OR credit_card transparent checkout); stores pagarme_orders row with request/response payloads + idempotency_key"
    - "Webhook handler at /api/webhooks/pagarme verifies Basic Auth (Pagar.me v5 dashboard-configured), Zod-parses the order.paid event, then RE-FETCHES the order from Pagar.me API as belt-and-suspenders before marking paid (defense against spoofing)"
    - "On confirmed payment: payments.status='paid', payments.paid_at=now; recordAudit + enqueueJob('email.send-status-update', {event: 'pagamento_recebido'}) — Phase 1 keeps the webhook handler simple; Phase 2 will refactor to outbox pattern with HMAC"
    - "Sandbox mode (PAGARME_ENV=sandbox) uses sandbox test cards + sandbox PIX QR codes that auto-pay; production mode uses real endpoints"
    - "Idempotency: pagarme_orders.idempotency_key column UNIQUE prevents duplicate order creation; webhook duplicate delivery (same gateway_event_id) is no-op"
files_modified:
  - src/lib/actions/payments.ts
  - src/lib/pagarme/client.ts
  - src/lib/pagarme/types.ts
  - src/app/api/webhooks/pagarme/route.ts
  - src/app/[slug]/cobrancas/page.tsx
  - src/app/[slug]/cobrancas/[paymentId]/page.tsx
  - src/components/payments/charge-form.tsx
  - src/components/payments/charge-detail.tsx
  - src/components/payments/pix-qr.tsx
  - src/components/contracts/create-charge-button.tsx
  - src/lib/validators/payment.ts
  - tests/payments/pagarme-create.test.ts
  - tests/payments/pagarme-webhook.test.ts
---

<objective>
Vertical slice 5 of Phase 1. After contract signed (Plan 01-05) the organizadora clicks "Criar cobrança" → Pagar.me v5 simple charge (PIX with QR + copia-cola, or credit card transparent checkout) → fornecedor pays → webhook confirms (with API re-fetch defense) → payment marked paid. Delivers ORG-12. NO split, NO subscriptions, NO outbox — those land in Phase 2.
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md (ORG-12 sem split; D-14 gate sandbox→produção)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Pagar.me v5 Orders/Charges + §Webhook Basic Auth (no HMAC in v5 — defense by re-fetch) + §PIX QR shape
- src/db/schema/payments.ts (Plan 01-01 — payments + pagarme_orders tables)
- src/jobs/enqueue.ts
- src/lib/actions/contracts.ts (Plan 01-05 — pattern reference)
</files_to_read>

<task id="1" name="Pagar.me client + types + Server Action createCharge">
<action>
Create `src/lib/pagarme/types.ts` — Zod schemas for Pagar.me v5:
- OrderCreateRequest: customer{name, email, document(cnpj), type}, items[{amount(cents), description, quantity}], payments[{payment_method, pix?{expires_in}, credit_card?{card_token, installments}}]
- OrderResponse: id, code, status, charges[{id, status, last_transaction{...}}]
- ChargeStatus enum: 'pending','paid','failed','canceled','refunded'
- WebhookEvent: type ('order.paid','charge.paid','charge.failed', etc.), data{...}

Create `src/lib/pagarme/client.ts` — typed wrapper:
- Basic Auth = `Buffer.from(PAGARME_SECRET_KEY + ':').toString('base64')` (Pagar.me v5 trailing colon — RESEARCH §Pitfall)
- `createOrder(payload, idempotencyKey)` — POST /core/v5/orders with `X-Idempotency-Key` header
- `getOrder(orderId)` — GET /core/v5/orders/{id} — used for webhook re-fetch
- Base URL switches: `https://api.pagar.me/core/v5` (sandbox uses the same URL but different API key; the env determines which key)

Create `src/lib/validators/payment.ts` Zod schemas:
- createChargeSchema: contractId (uuid), method ('pix' | 'credit_card'), amount_brl_cents (int > 0), card_token (required if method=credit_card)

Create `src/lib/actions/payments.ts` withTenantAction:
- `createCharge(input)` — Zod parse; verify contract in tenant + status='signed' (only paid after signed in Phase 1); compute idempotencyKey = `payment-${contractId}-${cryptoRandom(8)}`; INSERT payments row (status='pending'); INSERT pagarme_orders row with request_payload + idempotency_key; call pagarmeClient.createOrder(payload, idempotencyKey); UPDATE pagarme_orders.response_payload + payments.gateway_order_id + payments.gateway_charge_id; recordAudit('payment.created'); return {paymentId, pix_qr, pix_copy_paste (if pix), checkout_url (if cartão)}
- `listPayments({contractId?})` — RLS-scoped SELECT joining pagarme_orders for QR code retrieval

Write `tests/payments/pagarme-create.test.ts` using external-mocks (Pagar.me MSW):
1. createCharge with method=pix → returns PIX QR + copia-cola; payments row pending; pagarme_orders row with idempotency_key
2. createCharge with method=credit_card → checkout URL returned (or 3DS challenge; sandbox returns success)
3. Duplicate call with same contractId+rapid succession → idempotency_key blocks the second order (UNIQUE constraint surfaced as catchable error)
4. createCharge on contract with status='draft' (not signed) fails
5. Tenant B cannot create charge for tenant A's contract (RLS)
6. PAGARME_ENV=sandbox uses sandbox key; production env uses production key

Commit: `feat(01-06): Pagar.me v5 client + createCharge Server Action with idempotency + PIX/cartão paths`
</action>
<read_first>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Pagar.me v5 (Order/Charge shape, Basic Auth trailing colon, X-Idempotency-Key)
- src/db/schema/payments.ts (payments + pagarme_orders columns)
- src/lib/zapsign/client.ts (Plan 01-05 — pattern reference for external API client wrapper)
- src/lib/env.ts (env validation)
</read_first>
<acceptance_criteria>
- `pnpm test tests/payments/pagarme-create.test.ts` → 6 tests pass
- PAGARME_SECRET_KEY + PAGARME_ENV in .env.example
- Manual sandbox: signed contract → createCharge with PIX → QR code displayed; pay in sandbox; webhook fires (next task)
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
</acceptance_criteria>
</task>

<task id="2" name="Pagar.me webhook handler with re-fetch defense + payment FSM">
<action>
Create `src/app/api/webhooks/pagarme/route.ts` — Route Handler:
- Verify Basic Auth header against PAGARME_WEBHOOK_USER + PAGARME_WEBHOOK_PASS (Pagar.me v5 dashboard config)
- Zod-parse WebhookEvent
- Lookup tenant_id via `SELECT tenant_id FROM pagarme_orders po JOIN payments p ON po.payment_id = p.id WHERE po.gateway_order_id = ?` using migratorPool (RLS bypass for the cross-table lookup)
- Wrap rest in `withTenant(tenant_id, ...)`
- **Belt-and-suspenders re-fetch:** call `pagarmeClient.getOrder(orderId)` against the API; trust THAT status, NOT the webhook payload alone (defense against spoofing per RESEARCH §Pitfall)
- State machine transitions:
  - re-fetched status='paid' AND payments.status='pending' → UPDATE payments SET status='paid', paid_at=now(), gateway_event_id=event_id
  - re-fetched status='failed' → UPDATE payments SET status='failed'
  - re-fetched status='canceled' → UPDATE payments SET status='canceled'
- INSERT pagarme_orders.payload_callback (append the webhook event)
- recordAudit('payment.webhook', {event_type, gateway_event_id, refetched_status})
- On status='paid' (terminal transition): enqueueJob('email.send-status-update', {payment_id, event: 'pagamento_recebido'})
- Idempotency: payments table has UNIQUE on (gateway_order_id, status='paid') — second 'paid' for same order is no-op (catch UNIQUE violation gracefully → still return 200)
- Always return 200 OK to Pagar.me (retries would otherwise loop)

Add PIX QR component `src/components/payments/pix-qr.tsx` — renders QR (using a small QR library like `qrcode-svg` or canvas + `qrcode` lib) + "Copiar código" button for the copia-cola string.

Add `src/components/contracts/create-charge-button.tsx` (shown on the contract-detail page when status='signed') → opens charge-form dialog (method picker + amount precomputed from lot price).

Pages: `/[slug]/cobrancas` (list), `/[slug]/cobrancas/[paymentId]` (detail showing PIX QR / cartão result + status).

Write `tests/payments/pagarme-webhook.test.ts`:
1. Valid Basic Auth + order.paid event + re-fetch confirms paid → payments.status='paid' + email job enqueued
2. Valid Basic Auth + webhook says paid + re-fetch says failed → trust re-fetch (paid NOT recorded)
3. Bad Basic Auth → 401
4. Duplicate delivery (same gateway_event_id) → no double email enqueue, no double audit row
5. Webhook for unknown order → 404 (graceful, not 500)
6. Webhook for tenant A's order delivered → handler resolves tenant via lookup and operates in correct tenant context

Commit: `feat(01-06): Pagar.me webhook with re-fetch defense + payment FSM + PIX QR UI`
</action>
<read_first>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Pagar.me Webhook (Basic Auth, event types, re-fetch defense rationale)
- src/app/api/webhooks/zapsign/route.ts (Plan 01-05 — pattern reference for re-fetch + Basic Auth)
- src/lib/audit.ts
- src/jobs/enqueue.ts
</read_first>
<acceptance_criteria>
- `pnpm test tests/payments/pagarme-webhook.test.ts` → 6 tests pass
- Manual sandbox: pay PIX from sandbox dashboard → webhook fires → payments.status='paid' + paid_at populated + email job in queue
- PAGARME_WEBHOOK_USER + PAGARME_WEBHOOK_PASS in .env.example
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
- All Phase 0 + prior Phase 1 tests still pass
</acceptance_criteria>
</task>

<verification>
After both tasks: tests green. Manual sandbox smoke from contract signed → createCharge PIX → sandbox QR shown → simulate payment in Pagar.me dashboard → webhook fires → payment paid → email job in queue. Plan 01-07 will surface this in the financial dashboard.
</verification>
