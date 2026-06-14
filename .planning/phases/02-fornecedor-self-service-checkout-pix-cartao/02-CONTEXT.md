# Phase 2: Fornecedor Self-Service + Checkout PIX/Cartão - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Habilitar o **Fornecedor** a comprar um espaço de evento ponta-a-ponta **sem intervenção da organizadora**. Self-service signup (Better Auth, já wired em Phase 1) → marketplace interno do tenant → planta 2D em modo comprador (Konva read-only colorido, igual ao dashboard de Phase 1 mas com SSE real-time) → reserva 15 min com `pg_try_advisory_xact_lock(hashtext(...))` → checkout Pagar.me v5 (PIX + cartão até 12x com juros + boleto 3 dias úteis com PIX híbrido) → contrato + recibo. Webhooks Pagar.me **idempotentes em produção** via inbox table com PK em `gateway_event_id` + HMAC signature obrigatória + outbox pattern (business event + side-effects na mesma transação) — endurecendo a versão simples + re-fetch defense de Phase 1.

**O que está IN-SCOPE:**
- Fornecedor signup self-service (extends Phase 1 Better Auth org-by-slug)
- Marketplace interno: `/[slug]/marketplace` lista eventos abertos do tenant
- Planta 2D em modo comprador (Konva `mode='buyer'`) com SSE+`LISTEN/NOTIFY` real-time
- Reserva de lote 15 min com advisory lock (FORN-04 + FORN-05)
- Carrinho com lote principal + add-ons opcionais (`event_addons` table) — FORN-08
- Checkout 3 métodos: PIX + cartão até 12x com juros (Pagar.me calcula) + boleto 3 dias úteis com PIX híbrido (FORN-09)
- Webhook handler com HMAC + inbox + idempotência absoluta (FORN-10/11/12)
- Outbox pattern: `payment.paid` event + jobs (email + PDF + lot.sold) na mesma transação (FORN-13)
- SAGA de cancelamento libera reserva no fail (FORN-14)
- Scheduled job Graphile-Worker expira reservas a cada 1 min (FORN-06)
- Waitlist por lote (FORN-15) — notificação via SMTP/email apenas
- Refund/estorno self-service com política temporal 4-tier (FORN-16) — fornecedor cancela sozinho pelo portal
- Portal do fornecedor: histórico, contratos, segunda via, upload docs (FORN-17)
- Consent granular LGPD (marketing/analytics/dados de pagamento) por fornecedor (FORN-18)

**O que está OUT-OF-SCOPE (Phase 3+):**
- WhatsApp Business API para waitlist (Phase 3 ou 4 se piloto pedir)
- Split de pagamento (Phase 3 — prestadores + comissionamento)
- Subscription da organizadora (Phase 3)
- Marketplace SSR público com white-label (Phase 4)
- PWA + check-in offline (Phase 4)
- Prestadores (Phase 3)
- Ticketing público (Phase 4)

</domain>

<decisions>
## Implementation Decisions

### Post-Research Amendments (2026-06-14, supersede original D-XX where flagged)

Researcher findings (committed `7366856` in `02-RESEARCH.md`) contradicted four CONTEXT.md claims against verified Pagar.me v5 docs + graphile-worker docs + Postgres docs. The user resolved the boleto path; the remaining three are mechanical corrections the planner applies.

- **AM-01 supersedes D-02 + D-04 + D-05 (boleto):** Phase 2 ships **PIX + cartão only**. Boleto is **deferred to Phase 3** (proper Multimeios design with two-charge or Bolepix dashboard verification). D-05 TTL simplifies to: PIX/cartão = 15 min hard, single rule. Refund mechanics matrix (D-08) drops boleto rows. Marketplace checkout UI shows 2 method tiles, not 3. Reasoning: Pagar.me v5 Multimeios doc does not support boleto+PIX hybrid in one charge; PIX is one-shot + instant compensation and already covers the "pay quickly" UX boleto+PIX was meant to deliver.
- **AM-02 supersedes D-13 (HMAC header):** Header name + algorithm are **probe-verified at execute-time** (mirror of Phase 0 Plan 06 add_job signature probe). Planner emits a probe-test task BEFORE writing the webhook handler: hit Pagar.me sandbox with a known payload + valid signature, capture the actual header name (`X-Hub-Signature` vs `X-ME-WEBHOOK-SIGNATURE` vs other) + encoding (hex vs base64). Probe-test outcome is pinned into the handler. Belt-and-suspenders re-fetch defense from Phase 1 stays in addition to HMAC. Secret env name `PAGARME_WEBHOOK_SIGNING_SECRET` confirmed.
- **AM-03 supersedes D-17 (outbox drain cadence):** Graphile-Worker crontab minimum is **1 minute**, not 5s (verified at worker.graphile.org/docs/cron). New design: outbox handlers that need fast UX (lot.status_changed for SSE) bypass the drain entirely — they `pg_notify` directly from the same transaction that inserts the outbox row, via a same-tx inline call. Background side-effects (email, PDF, payment.paid → lot.sold marking) drain @ 1 min. Idempotency unchanged: handlers check state before mutating.
- **AM-04 supersedes D-08 (refund endpoint):** Pagar.me v5 refund/cancel surface is `DELETE /core/v5/charges/{id}` with optional `{ amount }` body for partial refunds — NOT `POST /charges/{id}/refunds` or `POST /charges/{id}/cancel`. Planner uses the verified shape; per-method matrix becomes: PIX → DELETE with amount (one-shot); Cartão authorize (not captured) → DELETE without amount (cancel); Cartão captured → DELETE with amount (partial refund per policy tier). Boleto rows removed per AM-01.
- **AM-05 narrows FORN-17 portal scope (segunda-via boleto deferred):** ROADMAP Success Criterion 5 + FORN-17 in-scope list both mention "segunda via de boleto". Since AM-01 defers all boleto charges to Phase 3, no boleto payments exist in Phase 2's data — the segunda-via UI would always be empty. Phase 2 portal does NOT scaffold a boleto-specific second-copy view; instead, the purchase-detail page conditionally renders only PIX/cartão receipts (contract PDF + Pagar.me receipt link). When Phase 3 reintroduces boleto, segunda-via lands alongside boleto charge creation in the same plan. FORN-17 success in Phase 2 = "histórico + contratos + refund + upload docs + consent" — segunda-via removed from the Phase 2 checklist. ROADMAP success criterion 5 should be updated at Phase 2 ship time to reflect this narrowing.
- **AM-06 supersedes D-03 (installments interest_type probe):** Just as AM-02 probe-verifies the HMAC header name at execute-time, AM-06 probe-verifies the Pagar.me v5 `installments` API param + `interest_type` value (`compound` vs `simple` vs absent) BEFORE the checkout client component renders an installments table to fornecedores. Planner emits the probe-test in 02-05's pre-handler CHECKPOINT (same task as AM-02 HMAC probe) so a single sandbox round-trip pins both the HMAC header AND the installments shape. Probe outcome saved into `src/lib/pagarme/installments-shape.generated.ts` (analogous to `hmac-header-name.generated.ts`). Reason: D-03 claim `interest_type: 'compound'` is unverified by RESEARCH; getting installment math wrong is a financial bug visible to every fornecedor on cartão checkout.

### Cart + Add-ons (FORN-08)
- **D-01:** **Add-ons como produtos separados** com tabela `event_addons` (FK event_id + name + price_brl_cents + max_qty + active). Organizadora define add-ons no painel admin (`Energia R$200`, `Água R$80`, `Lixo R$100`, `Mesa R$50`); fornecedor seleciona via checkbox no checkout. Carrinho = 1 lote + N add-ons. Charge total = lot price (D-09 aditivo de Phase 1) + sum(add-ons). Cada add-on selecionado vira linha em `cart_addon_lines` ligada ao `cart_id` da reserva ativa.

### Pagamento — métodos + parcelas
- **D-02:** **Trinity completa de métodos** — PIX (one-shot, sem parcela), Cartão (até 12x com juros — Pagar.me calcula; fornecedor vê tabela de parcelas no checkout), Boleto (3 dias úteis com PIX híbrido no rodapé do PDF — fornecedor pode pagar como quiser).
- **D-03:** **Cartão de crédito com juros embutidos pelo Pagar.me** (`installments: 1..12`, `interest_type: 'compound'`). Fornecedor vê "R$ 1.200 ou 12x R$ 114". Organizadora recebe valor à vista descontado do MDR (Pagar.me retém parcelas e antecipa se configurado). Sem absorção de juros pela organizadora — fica simples e Pagar.me cuida da matemática.
- **D-04:** **Boleto 3 dias úteis com PIX híbrido.** Pagar.me `payment_method: 'boleto'` com `boleto: { expires_in: 3, business_days: true }` e `pix_qrcode: { enabled: true }` (Pagar.me imprime QR no PDF). Fornecedor escolhe se paga como boleto OU PIX olhando o mesmo PDF.
- **D-05:** **TTL de reserva DIFERE por método de pagamento.** Cartão+PIX = 15 min hard (FORN-04 ROADMAP). Boleto = `expires_at = boleto.expires_at + 1 hora` (tolerance pra compensação chegar). Scheduled job (FORN-06) usa `expires_at` do registro `lot_reservations` — não importa de qual método veio.

### Refund/Estorno (FORN-16)
- **D-06:** **Refund self-service** — fornecedor cancela sozinho pelo portal. Sem aprovação da organizadora. Single click → sistema aplica política temporal automática.
- **D-07:** **Política temporal default 4-tier:**
  - `>30 dias` antes do evento → 100% refund
  - `15-30 dias` antes → 50% refund
  - `7-15 dias` antes → 25% refund
  - `<7 dias` antes → 0% refund (lote libera mas fornecedor não recebe)
  - Configurável por tenant em `tenants.refund_policy_json` (default = essa tabela). Organizadora pode override no painel admin se o piloto pedir.
- **D-08:** **Mechanics por método de pagamento:**
  - PIX → estorno PIX via Pagar.me API (`POST /charges/{id}/refunds`) — one-shot, ~5 min compensação
  - Cartão se ainda em authorize (não capturado) → cancel (`POST /charges/{id}/cancel`), sem custo
  - Cartão capturado → refund (`POST /charges/{id}/refunds`) — pode ser parcial conforme política temporal
  - Boleto se não pago → cancel
  - Boleto pago → refund via PIX (Pagar.me suporta refund cross-method)
- **D-09:** **Lote libera + waitlist notificado** atomicamente na MESMA transação do refund (outbox pattern aplicado também ao refund.created event).

### Waitlist (FORN-15)
- **D-10:** **Email only em Phase 2** via SMTP existente (Phase 1 D-14 swap). Quando lote libera (refund ou reserva expira após sold), top N candidatos na fila recebem email com link valido por 15min pra re-reservar. Sem WhatsApp em Phase 2.
- **D-11:** **Waitlist table** = `lot_waitlist` (lot_id, vendor_id, joined_at, notified_at nullable, position computed). Quando lote libera: job `waitlist.notify-next` pega os top 3 da fila e enfileira `email.send-status-update` event='waitlist_available' com link `https://eventos.fbtax.cloud/{slug}/checkout?lot={lotId}&from=waitlist&token={signed-jwt-15min}`.
- **D-12:** **Position recompute on reserve.** Fila não é FIFO estática — fornecedor pode entrar e sair (cancel da posição). Position = `RANK() OVER (PARTITION BY lot_id ORDER BY joined_at)` filtered `notified_at IS NULL`. Quem aceita o link sai da fila + entra em reserva (advisory lock + TTL 15 min).

### Webhook idempotência + HMAC (FORN-10/11/12)
- **D-13:** **HMAC signature obrigatória** — Pagar.me v5 envia `X-Hub-Signature` (SHA-256). Webhook handler valida via `crypto.timingSafeEqual(received, hmac(secret, body))`. Reject 401 se mismatch. Secret = `PAGARME_WEBHOOK_SIGNING_SECRET` env (novo). Substitui a Basic Auth de Phase 1 (que era belt-and-suspenders simples).
- **D-14:** **Inbox table `payment_webhooks_inbox`** com PK em `gateway_event_id` (TEXT, Pagar.me event id). `INSERT ... ON CONFLICT DO NOTHING`; se conflict, return 200 e exit (idempotência absoluta). Linha contém o payload bruto + received_at + processed_at + processing_status (`pending`/`processed`/`failed`).
- **D-15:** **Webhook responde 200 em <100ms** — só faz: HMAC verify + INSERT inbox + enqueue Graphile-Worker job `payment.process-webhook` com `payload.inbox_id`. Processamento (re-fetch + FSM + outbox emit) acontece no worker, fora do hot path do Pagar.me.

### Outbox + SAGA (FORN-13/14)
- **D-16:** **Tabela `outbox_events`** single-table com discriminator: `event_type` text not null (`payment.paid`, `payment.failed`, `lot.reserved`, `lot.sold`, `lot.released`, `refund.created`), `payload jsonb`, `tenant_id uuid not null`, `aggregate_id uuid` (lot_id ou payment_id conforme tipo), `created_at`, `processed_at nullable`. Cada `event_type` aciona N tasks Graphile-Worker registradas em `src/jobs/outbox/handlers/index.ts`.
- **D-17:** **Drain via polling** (Graphile-Worker scheduled task `outbox.drain` a cada 5s — não LISTEN/NOTIFY pra simplificar Phase 2; LISTEN/NOTIFY já é usado pra SSE no FORN-07). Pega `LIMIT 100 WHERE processed_at IS NULL ORDER BY created_at` + enqueue handlers + UPDATE processed_at na mesma transação. Idempotência: handlers checkam estado antes de mutar (ex: `payment.paid` handler só marca lot=sold se ainda não tá).
- **D-18:** **SAGA de cancelamento** quando `payment.failed` evento entra outbox: handler libera reserva (`UPDATE lot_reservations SET released_at=now() WHERE id=?`), emite `lot.released` event que dispara `waitlist.notify-next`. Atomicidade garantida pelo outbox.

### SSE + Real-time (FORN-07)
- **D-19:** **SSE per-event channel** via Postgres `LISTEN/NOTIFY`. Server Action subscriba ao canal `event:${eventId}:lots`. Quando reserva/sold/released acontece em qualquer lote do evento, INSERT no outbox emite `lot.status_changed` que tem um handler simples `outbox.notify-event-channel(eventId, lotId, newStatus)` que faz `pg_notify('event:${eventId}:lots', json)`. Client SSE reconnect com `Last-Event-ID` (Next.js `EventSource` API).
- **D-20:** **Konva planta editor estende com `mode='buyer'`:** lots `sold` ou `reserved` por outro fornecedor = visualmente bloqueado (cinza + cursor: not-allowed); `available` = clicável (verde). Click em lot available → opens checkout sidebar com cart + add-ons. Recebe SSE updates e re-renderiza colors live (sem refresh).

### Fornecedor Signup + Tenant Discovery
- **D-21:** **Signup self-service por tenant-slug.** URL: `https://eventos.fbtax.cloud/{tenant_slug}/fornecedor/cadastro`. Better Auth org plugin (Phase 0 + 1) já suporta org-by-slug. Form: email + senha + CNPJ (BrasilAPI 2-layer validation, reusa Phase 1 D-16) + dados de contato + comprovantes (vendor_documents pre-signed PUT, reusa Phase 1 D-04/05). Sem invite link em Phase 2 (poder ser adicionado se piloto pedir).
- **D-22:** **CNPJ pode existir em múltiplos tenants** — vendor é tenant-scoped (RLS). Se o MESMO fornecedor (mesmo CNPJ) cadastrar em 2 tenants, são 2 vendor rows independentes. Pattern consistente com Phase 1.
- **D-23:** **Auto-approve = false** — fornecedor entra `status='pending'` por default. Organizadora aprova/rejeita via Phase 1 painel. Configurável por tenant em `tenants.vendor_auto_approve` (default false) se piloto quiser self-service approval.

### Consent LGPD granular (FORN-18)
- **D-24:** **Tabela `vendor_consents`** (vendor_id + consent_type enum: `marketing|analytics|payment_data` + granted_at + revoked_at nullable + ip_address + consent_text snapshot). Consent UI: 3 checkboxes na primeira página do portal pós-signup; vendor pode revoke a qualquer momento via portal settings. recordAudit por mudança. Soft-delete da revoke = keep audit but flag.

### Claude's Discretion
- Internal table structure exact (cart_addon_lines, lot_reservations, lot_waitlist, outbox_events, payment_webhooks_inbox, vendor_consents, event_addons, refund_requests) — researcher + planner define com base nos requirements
- Default refund policy stored as `JSONB tenants.refund_policy_json` — planner decide a shape (array of {min_days, max_days, refund_pct})
- Exact UI layout do marketplace + checkout + portal — UI-phase pode rodar se planner ou você achar útil
- Graphile-Worker scheduled job cadence além dos especificados (D-17 outbox.drain 5s, FORN-06 reservation.expire 60s) — planner decide
- Server-Sent Events keepalive interval — planner default 30s
- Boleto cancellation antes de pago — planner mapeia Pagar.me API
- 2FA opcional pro fornecedor no signup (Better Auth já wired em Phase 0) — planner decide se ativa por default

### Folded Todos
Nenhum todo pendente foi dobrado nesta discussão.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack + Fundação (Phase 0 + 1)
- `.planning/PROJECT.md` — Core value + hard contractual constraints
- `.planning/REQUIREMENTS.md` §FORN-01..FORN-18 — Os 18 requirements desta fase
- `CLAUDE.md` — Stack travada
- `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md` — Patterns + pitfalls do FB_APU04
- `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-04-SUMMARY.md` — Better Auth + org plugin
- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md` — Phase 1 decisions (D-01..D-16) que muitas se aplicam aqui
- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-04-SUMMARY.md` — BrasilAPI + vendor patterns (Phase 2 reusa)
- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-05-SUMMARY.md` — ZapSign webhook re-fetch defense pattern (Phase 2 endurece com HMAC)
- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-06-SUMMARY.md` — Pagar.me v5 simple charges pattern (Phase 2 refatora pra outbox)
- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-08-SUMMARY.md` — D-14 gate procedure + SMTP swap (Phase 2 herda transport)

### Código de Fundação Reusado
- `src/db/with-tenant.ts` — boundary RLS
- `src/lib/actions/safe-action.ts` — withTenantAction chain
- `src/auth/server.ts` — Better Auth + org plugin (Phase 0 + Phase 1 setActiveOrg)
- `src/lib/storage/minio.ts` — pre-signed PUT/GET
- `src/lib/actions/brasilapi.ts` — Phase 1 — CNPJ validation reuse
- `src/lib/actions/payments.ts` — Phase 1 — createCharge (Phase 2 REFATORA com cart + add-ons + outbox)
- `src/app/api/webhooks/pagarme/route.ts` — Phase 1 — Pagar.me webhook (Phase 2 REFATORA com HMAC + inbox + outbox enqueue)
- `src/lib/pagarme/{client,types}.ts` — Phase 1 — Pagar.me REST client (Phase 2 estende com installments + boleto)
- `src/components/eventos/planta-editor.tsx` — Phase 1 — extender com `mode='buyer'`
- `src/lib/email.ts` — Phase 1 D-14 — SMTP transport (waitlist usa)
- `src/jobs/enqueue.ts` + `src/jobs/runner.ts` — Phase 0 — Graphile-Worker (outbox + scheduled jobs)
- `src/lib/audit.ts` — recordAudit (toda mudança de status, refund, consent)
- `docs/adr/0002-e-sign-provider.md` — ZapSign (contrato pós-payment usa)

### ADRs novos a criar
- `docs/adr/0005-webhook-hmac-strategy.md` — HMAC SHA-256 + timingSafeEqual + inbox table (FORN-10/11)
- `docs/adr/0006-outbox-pattern.md` — single outbox_events table + polling drain (FORN-13)
- `docs/adr/0007-refund-policy.md` — 4-tier temporal default + per-tenant JSON override (D-07)

### Externos (researcher confirma)
- Pagar.me v5 docs — Orders + Charges + Refunds + Boleto + Cards + Installments
- Pagar.me v5 webhook HMAC signature spec (exact header name + algorithm + secret rotation)
- Postgres `pg_try_advisory_xact_lock` + `LISTEN/NOTIFY` patterns
- Better Auth org plugin signup-by-slug semantics
- Next.js 15 SSE Route Handler patterns (Server-Sent Events keepalive + Last-Event-ID)
- Konva.js read-only mode + click event filtering (extensão de Phase 1 dashboard mode)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`withTenant(tenantId, fn)`** — boundary RLS pra toda Server Action
- **`createChargeInTenant`** (Plan 01-06) — base pra refatorar com cart + add-ons + outbox emit em vez de direct INSERT payment
- **Pagar.me webhook handler `/api/webhooks/pagarme`** (Plan 01-06) — Phase 2 REFATORA: Basic Auth → HMAC; inline processing → inbox + enqueue; direct UPDATE → outbox emit
- **`planta-editor.tsx`** (Plan 01-03) — extender com `mode='buyer'` (Konva-readonly + click → checkout sidebar)
- **`recordConsentMetadata` Server Action** (Phase 0 LGPD) — base pra FORN-18 consent granular
- **`enqueueJob` + Graphile-Worker `withTenant`** — outbox handlers + scheduled tasks (waitlist.notify-next, reservation.expire, outbox.drain)
- **BrasilAPI 2-layer pattern** — vendor signup CNPJ validation reuse
- **MinIO pre-signed PUT/GET** — vendor_documents upload (Phase 1 D-04/05 same)
- **`sendEmail` SMTP wrapper** (Phase 1 D-14) — waitlist + status updates
- **shadcn primitives** — adicionar `tabs`, `progress`, `tooltip` se necessário (verify availability)

### Established Patterns (de Phases 0 + 1)
- **TENA-05 split** — middleware Edge sem DB; `SET LOCAL` só dentro `withTenant`
- **Pure-helper + thin-action split** — todas as Server Actions Phase 2 seguem
- **Walk-cause-chain catch** para UNIQUE violations em outbox/inbox idempotency (postgres 23505)
- **audit_log FORCE RLS** — toda escrita via `withTenant`; tests usam `appPool.begin + SET LOCAL`
- **RLS-no-worker** — task handlers wrappam em `withTenant(payload.tenant_id)`
- **Webhook re-fetch defense** — Phase 1 pattern; Phase 2 ADICIONA HMAC mas mantém re-fetch belt-and-suspenders pra estados terminais
- **PII COMMENT ON COLUMN** — toda coluna nova sensível
- **PG sysreader bounded function** — Phase 1 pattern para webhook tenant lookup (Phase 2 reusa pra inbox table tenant resolve)

### Integration Points
- **Novas migrations 0016+:** `event_addons`, `cart_addon_lines`, `lot_reservations`, `lot_waitlist`, `outbox_events`, `payment_webhooks_inbox`, `vendor_consents`, `refund_requests`, plus tenant column `vendor_auto_approve bool default false` + `refund_policy_json jsonb`
- **Novas rotas:** `/[slug]/marketplace`, `/[slug]/marketplace/[eventId]`, `/[slug]/marketplace/[eventId]/planta` (buyer mode), `/[slug]/checkout/{cartId}`, `/[slug]/portal/*` (fornecedor portal), `/[slug]/fornecedor/cadastro` (signup)
- **Novos Graphile-Worker tasks:** `outbox.drain`, `reservation.expire`, `waitlist.notify-next`, `payment.process-webhook`, `lot.notify-channel`, `refund.process`
- **SSE Route Handler:** `/api/sse/events/[eventId]/lots`
- **Webhooks:** `/api/webhooks/pagarme` REFATORADA (HMAC + inbox + enqueue)

</code_context>

<specifics>
## Specific Ideas

- **Festa de Trindade piloto continua sendo o organizadora real**; Phase 2 é o que abre o evento dela pra fornecedores reais comprarem self-service. Quando esse fluxo funciona end-to-end com 1 fornecedor real comprando 1 lote por PIX, Phase 2 é considerada done-done (similar ao D-14 gate de Phase 1).
- **Trinity de pagamento** (PIX + cartão até 12x com juros + boleto 3 dias híbrido) é decisão deliberada — quer dar todas as opções de método pro fornecedor BR.
- **Cartão com juros embutidos pelo Pagar.me** (não pela aplicação) — simplifica o cálculo + matemática fica no gateway.
- **Boleto + PIX híbrido** no mesmo PDF é diferencial UX importante — fornecedor recebe boleto, mas se pagar pelo QR já compensa em 5min e ganha o lote rápido.
- **Refund 4-tier** é configurável — Trindade pode override pra política mais agressiva ou conservadora.
- **Waitlist email-only** — WhatsApp adicionado se piloto reclamar de UX.

</specifics>

<deferred>
## Deferred Ideas

### Para Phase 3
- WhatsApp Business API para waitlist + payment confirmation (se piloto demandar)
- Split de pagamento via Pagar.me Recipients
- Subscription da organizadora (cobrança recorrente)
- Comissionamento de prestadores
- Self-service vendor approval automation (auto-approve trusted)

### Para Phase 4
- Marketplace público SSR + white-label
- PWA + check-in offline-first
- LGPD direito ao esquecimento via UI
- Read replica + PgBouncer + cache stampede
- Ticketing público
- Sympla/Eventbrite integração

### Polish / nice-to-have
- 2FA obrigatória pro fornecedor (Better Auth wired; ativar via setting)
- Cart abandonment recovery (email automático após 1h se reserva expira sem pagamento)
- Boleto re-emission self-service (Pagar.me suporta)
- Multi-currency (Phase 2 só BRL)

### Reviewed Todos (not folded)
Nenhum todo pendente revisitado nesta discussão.

</deferred>

---

*Phase: 02-fornecedor-self-service-checkout-pix-cartao*
*Context gathered: 2026-06-14*
