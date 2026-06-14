# Phase 2: Fornecedor Self-Service + Checkout PIX/Cartão — Research

**Researched:** 2026-06-14
**Domain:** Vendor self-service checkout marketplace for big-event organizers (BR), Pagar.me v5 trinity (PIX/cartão/boleto), real-time lot reservation via Postgres advisory locks + SSE, outbox/inbox idempotency
**Confidence:** HIGH for advisory-lock + SSE + outbox patterns (Postgres + Graphile-Worker + Next.js 15 well-documented). MEDIUM for Pagar.me v5 webhook HMAC (CONTEXT.md D-13 claim contradicts Phase 1 RESEARCH §A8 — needs operator verification in dashboard). MEDIUM-LOW for Pagar.me boleto + PIX hybrid (NOT a documented Pagar.me product; CONTEXT.md D-04 is an unverified assumption requiring an ALTERNATIVE design).

## Summary

Phase 2 closes the fornecedor self-service loop: signup-by-tenant-slug → marketplace → planta-buyer-mode → 15-min advisory-lock reservation → Pagar.me checkout (PIX + cartão até 12x + boleto) → HMAC + inbox webhook → outbox-emitted side effects → contract + email + lot=sold. All of this layers on top of Phase 1's working Pagar.me-simple-charge flow, hardening it with outbox-pattern idempotency and HMAC verification. The Festa de Trindade pilot tenant is the production gate: when one real fornecedor buys one real lot end-to-end without manual intervention, Phase 2 is done-done (mirror of Phase 1 D-14 gate).

Three findings need explicit user confirmation before planning. **(1) Pagar.me HMAC signature header for v5 is not documented in the public `docs.pagar.me/reference` corpus** — the parent company ME's "Partner Webhooks" doc uses `X-ME-WEBHOOK-SIGNATURE` (HMAC-SHA256 base64), but legacy Pagar.me v5 webhook docs cited in Phase 1 RESEARCH §A8 say Basic Auth only. The CONTEXT.md D-13 "X-Hub-Signature" name is plausibly wrong — operator must check the actual Pagar.me dashboard to confirm header name + secret-management UI. **(2) Pagar.me does NOT natively support boleto+PIX-hybrid (Bolepix)** in one charge per the Multimeios doc (which only allows 2 cards or 1 card + 1 boleto). CONTEXT.md D-04 "boleto 3 dias com PIX QR no PDF" is currently unachievable inside Pagar.me's documented API — alternatives: (a) two parallel charges PIX + boleto, fornecedor chooses to pay one (cancel the other on first paid event); (b) emit boleto only and let fornecedor pay via traditional Pix banking outside our gateway. **(3) Pagar.me boleto uses `due_at` ISO timestamp, NOT `expires_in: 3, business_days: true`** as CONTEXT.md D-04 says. The planner must compute the 3-business-day-future date at request time and pass `due_at: "2026-06-19T23:59:59Z"`.

**Primary recommendation:** Build the FSM around an explicit `lot_reservations` row created inside an advisory-lock-protected transaction, emit `lot.reserved` to `outbox_events` atomically, and let a Graphile-Worker polling job (`outbox.drain` @ 5s) fan out to side-effect handlers (notify-channel via `pg_notify`, email via `email.send-status-update`). Keep Phase 1's belt-and-suspenders re-fetch defense on the webhook; layer HMAC ON TOP, do not replace. Plan the boleto + cartão installment paths as **separate** code paths from PIX (per `payment_method` discriminator already in `src/lib/pagarme/types.ts`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Cart + Add-ons (FORN-08)
- **D-01:** **Add-ons como produtos separados** com tabela `event_addons` (FK event_id + name + price_brl_cents + max_qty + active). Organizadora define add-ons no painel admin (`Energia R$200`, `Água R$80`, `Lixo R$100`, `Mesa R$50`); fornecedor seleciona via checkbox no checkout. Carrinho = 1 lote + N add-ons. Charge total = lot price (D-09 aditivo de Phase 1) + sum(add-ons). Cada add-on selecionado vira linha em `cart_addon_lines` ligada ao `cart_id` da reserva ativa.

#### Pagamento — métodos + parcelas
- **D-02:** **Trinity completa de métodos** — PIX (one-shot, sem parcela), Cartão (até 12x com juros — Pagar.me calcula; fornecedor vê tabela de parcelas no checkout), Boleto (3 dias úteis com PIX híbrido no rodapé do PDF — fornecedor pode pagar como quiser).
- **D-03:** **Cartão de crédito com juros embutidos pelo Pagar.me** (`installments: 1..12`, `interest_type: 'compound'`). Fornecedor vê "R$ 1.200 ou 12x R$ 114". Organizadora recebe valor à vista descontado do MDR (Pagar.me retém parcelas e antecipa se configurado). Sem absorção de juros pela organizadora — fica simples e Pagar.me cuida da matemática.
- **D-04:** **Boleto 3 dias úteis com PIX híbrido.** Pagar.me `payment_method: 'boleto'` com `boleto: { expires_in: 3, business_days: true }` e `pix_qrcode: { enabled: true }` (Pagar.me imprime QR no PDF). Fornecedor escolhe se paga como boleto OU PIX olhando o mesmo PDF. **[FLAG: research contradicts the field names — see Open Questions]**
- **D-05:** **TTL de reserva DIFERE por método de pagamento.** Cartão+PIX = 15 min hard (FORN-04 ROADMAP). Boleto = `expires_at = boleto.expires_at + 1 hora` (tolerance pra compensação chegar). Scheduled job (FORN-06) usa `expires_at` do registro `lot_reservations` — não importa de qual método veio.

#### Refund/Estorno (FORN-16)
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

#### Waitlist (FORN-15)
- **D-10:** **Email only em Phase 2** via SMTP existente (Phase 1 D-14 swap). Quando lote libera (refund ou reserva expira após sold), top N candidatos na fila recebem email com link valido por 15min pra re-reservar. Sem WhatsApp em Phase 2.
- **D-11:** **Waitlist table** = `lot_waitlist` (lot_id, vendor_id, joined_at, notified_at nullable, position computed). Quando lote libera: job `waitlist.notify-next` pega os top 3 da fila e enfileira `email.send-status-update` event='waitlist_available' com link `https://eventos.fbtax.cloud/{slug}/checkout?lot={lotId}&from=waitlist&token={signed-jwt-15min}`.
- **D-12:** **Position recompute on reserve.** Fila não é FIFO estática — fornecedor pode entrar e sair (cancel da posição). Position = `RANK() OVER (PARTITION BY lot_id ORDER BY joined_at)` filtered `notified_at IS NULL`. Quem aceita o link sai da fila + entra em reserva (advisory lock + TTL 15 min).

#### Webhook idempotência + HMAC (FORN-10/11/12)
- **D-13:** **HMAC signature obrigatória** — Pagar.me v5 envia `X-Hub-Signature` (SHA-256). Webhook handler valida via `crypto.timingSafeEqual(received, hmac(secret, body))`. Reject 401 se mismatch. Secret = `PAGARME_WEBHOOK_SIGNING_SECRET` env (novo). Substitui a Basic Auth de Phase 1 (que era belt-and-suspenders simples). **[FLAG: header name "X-Hub-Signature" is unverified — see Open Questions; ME platform docs use `X-ME-WEBHOOK-SIGNATURE` and base64 instead of hex.]**
- **D-14:** **Inbox table `payment_webhooks_inbox`** com PK em `gateway_event_id` (TEXT, Pagar.me event id). `INSERT ... ON CONFLICT DO NOTHING`; se conflict, return 200 e exit (idempotência absoluta). Linha contém o payload bruto + received_at + processed_at + processing_status (`pending`/`processed`/`failed`).
- **D-15:** **Webhook responde 200 em <100ms** — só faz: HMAC verify + INSERT inbox + enqueue Graphile-Worker job `payment.process-webhook` com `payload.inbox_id`. Processamento (re-fetch + FSM + outbox emit) acontece no worker, fora do hot path do Pagar.me.

#### Outbox + SAGA (FORN-13/14)
- **D-16:** **Tabela `outbox_events`** single-table com discriminator: `event_type text not null` (`payment.paid`, `payment.failed`, `lot.reserved`, `lot.sold`, `lot.released`, `refund.created`), `payload jsonb`, `tenant_id uuid not null`, `aggregate_id uuid` (lot_id ou payment_id conforme tipo), `created_at`, `processed_at nullable`. Cada `event_type` aciona N tasks Graphile-Worker registradas em `src/jobs/outbox/handlers/index.ts`.
- **D-17:** **Drain via polling** (Graphile-Worker scheduled task `outbox.drain` a cada 5s — não LISTEN/NOTIFY pra simplificar Phase 2; LISTEN/NOTIFY já é usado pra SSE no FORN-07). Pega `LIMIT 100 WHERE processed_at IS NULL ORDER BY created_at` + enqueue handlers + UPDATE processed_at na mesma transação. Idempotência: handlers checkam estado antes de mutar (ex: `payment.paid` handler só marca lot=sold se ainda não tá).
- **D-18:** **SAGA de cancelamento** quando `payment.failed` evento entra outbox: handler libera reserva (`UPDATE lot_reservations SET released_at=now() WHERE id=?`), emite `lot.released` event que dispara `waitlist.notify-next`. Atomicidade garantida pelo outbox.

#### SSE + Real-time (FORN-07)
- **D-19:** **SSE per-event channel** via Postgres `LISTEN/NOTIFY`. Server Action subscriba ao canal `event:${eventId}:lots`. Quando reserva/sold/released acontece em qualquer lote do evento, INSERT no outbox emite `lot.status_changed` que tem um handler simples `outbox.notify-event-channel(eventId, lotId, newStatus)` que faz `pg_notify('event:${eventId}:lots', json)`. Client SSE reconnect com `Last-Event-ID` (Next.js `EventSource` API).
- **D-20:** **Konva planta editor estende com `mode='buyer'`:** lots `sold` ou `reserved` por outro fornecedor = visualmente bloqueado (cinza + cursor: not-allowed); `available` = clicável (verde). Click em lot available → opens checkout sidebar com cart + add-ons. Recebe SSE updates e re-renderiza colors live (sem refresh).

#### Fornecedor Signup + Tenant Discovery
- **D-21:** **Signup self-service por tenant-slug.** URL: `https://eventos.fbtax.cloud/{tenant_slug}/fornecedor/cadastro`. Better Auth org plugin (Phase 0 + 1) já suporta org-by-slug. Form: email + senha + CNPJ (BrasilAPI 2-layer validation, reusa Phase 1 D-16) + dados de contato + comprovantes (vendor_documents pre-signed PUT, reusa Phase 1 D-04/05). Sem invite link em Phase 2 (poder ser adicionado se piloto pedir).
- **D-22:** **CNPJ pode existir em múltiplos tenants** — vendor é tenant-scoped (RLS). Se o MESMO fornecedor (mesmo CNPJ) cadastrar em 2 tenants, são 2 vendor rows independentes. Pattern consistente com Phase 1.
- **D-23:** **Auto-approve = false** — fornecedor entra `status='pending'` por default. Organizadora aprova/rejeita via Phase 1 painel. Configurável por tenant em `tenants.vendor_auto_approve` (default false) se piloto quiser self-service approval.

#### Consent LGPD granular (FORN-18)
- **D-24:** **Tabela `vendor_consents`** (vendor_id + consent_type enum: `marketing|analytics|payment_data` + granted_at + revoked_at nullable + ip_address + consent_text snapshot). Consent UI: 3 checkboxes na primeira página do portal pós-signup; vendor pode revoke a qualquer momento via portal settings. recordAudit por mudança. Soft-delete da revoke = keep audit but flag.

### Claude's Discretion
- Internal table structure exact (cart_addon_lines, lot_reservations, lot_waitlist, outbox_events, payment_webhooks_inbox, vendor_consents, event_addons, refund_requests) — researcher + planner define com base nos requirements
- Default refund policy stored as `JSONB tenants.refund_policy_json` — planner decide a shape (array of {min_days, max_days, refund_pct})
- Exact UI layout do marketplace + checkout + portal — UI-phase pode rodar se planner ou você achar útil
- Graphile-Worker scheduled job cadence além dos especificados (D-17 outbox.drain 5s, FORN-06 reservation.expire 60s) — planner decide
- Server-Sent Events keepalive interval — planner default 30s
- Boleto cancellation antes de pago — planner mapeia Pagar.me API
- 2FA opcional pro fornecedor no signup (Better Auth já wired em Phase 0) — planner decide se ativa por default

### Deferred Ideas (OUT OF SCOPE)
- WhatsApp Business API para waitlist + payment confirmation (Phase 3 ou 4 se piloto demandar)
- Split de pagamento via Pagar.me Recipients (Phase 3)
- Subscription da organizadora (cobrança recorrente) (Phase 3)
- Comissionamento de prestadores (Phase 3)
- Self-service vendor approval automation (auto-approve trusted) (Phase 3)
- Marketplace público SSR + white-label (Phase 4)
- PWA + check-in offline-first (Phase 4)
- LGPD direito ao esquecimento via UI (Phase 4)
- Read replica + PgBouncer + cache stampede (Phase 4)
- Ticketing público (Phase 4)
- Sympla/Eventbrite integração (Phase 4)
- 2FA obrigatória pro fornecedor (Better Auth wired; ativar via setting) — polish
- Cart abandonment recovery (email automático após 1h se reserva expira sem pagamento) — polish
- Boleto re-emission self-service (Pagar.me suporta) — polish
- Multi-currency (Phase 2 só BRL) — polish
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FORN-01 | Fornecedor cadastra-se self-service (Better Auth) com CNPJ + dados de contato + comprovantes | Better Auth `getFullOrganization({organizationSlug})` + `auth.api.addMember()` server-side pattern verified [CITED: better-auth.com/docs/plugins/organization]; BrasilAPI 2-layer + MinIO pre-signed PUT from Phase 1 D-16/D-04/D-05 |
| FORN-02 | Fornecedor descobre eventos abertos para venda dentro do tenant (página marketplace interna) | Existing `events` table + RLS; new route `/[slug]/marketplace` Server Component reads via withTenant |
| FORN-03 | Fornecedor navega na planta 2D do evento em modo comprador (lotes vendidos visualmente bloqueados) | Extend `PlantaEditor` (src/components/eventos/planta-editor.tsx) with `mode='buyer'` (see §Konva-buyer-mode); SSE-driven color refresh |
| FORN-04 | Reserva de lote com TTL 15 minutos (linha em `lot_reservations` com `expires_at`) | New `lot_reservations` table; computed expires_at = now() + interval per D-05 (15 min for PIX/cartão, boleto.due_at + 1h for boleto) |
| FORN-05 | Advisory lock `pg_try_advisory_xact_lock(hashtext('lot:'\|\|event_id\|\|':'\|\|lot_id))` previne race condition | Pattern verified [VERIFIED: postgresql.org]; lock released at tx end; conflict → returns false (no error); see §Advisory-lock-pattern |
| FORN-06 | Graphile-Worker scheduled job libera reservas expiradas a cada 1 minuto | graphile-worker crontab `* * * * * reservation.expire` (minimum granularity = 1 min) [VERIFIED: worker.graphile.org/docs/cron] |
| FORN-07 | SSE + `LISTEN/NOTIFY` push de mudança de status do lote para outros clientes vendo a mesma planta em tempo real | Next.js 15 Route Handler ReadableStream + req.signal.abort + 30s keepalive + LISTEN/NOTIFY 8000-byte payload limit (use ID-only payload + fetch detail) [VERIFIED: postgresql.org + nextjs.org] |
| FORN-08 | Carrinho com lote principal + add-ons (energia, água, lixo, mesas) | New tables: `event_addons` (catalog) + `cart_addon_lines` (selection per cart). Cart row is the same `lot_reservations` row (D-01 implicit) |
| FORN-09 | Checkout Pagar.me v5 com PIX (QR + copia-cola) e cartão de crédito + boleto | Phase 1 PIX + credit_card paths exist; extend with `installments: 1..12`. Boleto = NEW path (see §Pagar.me-v5-API-research); ⚠️ BOLETO+PIX hybrid not natively supported — see Open Questions |
| FORN-10 | Webhook handler Pagar.me com inbox table `payment_webhooks_inbox` (PK no `gateway_event_id` + `ON CONFLICT DO NOTHING`) — idempotência absoluta | INSERT pattern via migratorPool BEFORE entering withTenant; refactor of current src/app/api/webhooks/pagarme/route.ts |
| FORN-11 | HMAC signature do webhook Pagar.me verificada em toda request | ⚠️ Header name unverified — see Open Questions Q1. Pattern: `crypto.timingSafeEqual(Buffer.from(received, 'base64'), hmac.update(rawBody).digest())` |
| FORN-12 | Webhook handler retorna 200 rápido e enfileira processamento via Graphile-Worker (não processa inline) | After inbox INSERT, `enqueueJob(migratorPool, 'payment.process-webhook', {inbox_id})` (no tenant scope yet); worker resolves tenant + does re-fetch + FSM |
| FORN-13 | Outbox pattern: gravação de business event + enfileiramento de side-effects (email confirmação, PDF contrato, marcação do lote como `sold`) na MESMA transação | Single `outbox_events` table + polling `outbox.drain` @ 5s task |
| FORN-14 | SAGA de cancelamento: falha de pagamento libera a reserva automaticamente | `payment.failed` outbox handler emits `lot.released` → `waitlist.notify-next` cascade |
| FORN-15 | Lista de espera por lote (waitlist) quando lote está vendido — notificação via email | `lot_waitlist` table + signed-JWT 15min re-reserve link + single-use jti enforcement |
| FORN-16 | Refund/estorno via Pagar.me (PIX one-shot — modelado como estorno PIX; cartão é authorize+capture com cancel) | Refund matrix table — see §Refund-mechanics-matrix; `POST /charges/{id}/refunds` (full or partial via `amount` param) [VERIFIED: docs.pagar.me/reference/cancelar-cobrança DELETE pattern + amount param] |
| FORN-17 | Portal do fornecedor: histórico de compras, contratos baixáveis, segunda via de boleto, upload de docs adicionais | New route group `/[slug]/portal/*` (Server Components); reusa MinIO pre-signed GET (Phase 1 D-06 — 15min TTL) |
| FORN-18 | Consent granular do fornecedor (compliance LGPD): marketing, analytics, dados de pagamento | New `vendor_consents` table (enum consent_type) + 3-checkbox UI + recordAudit on each change |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fornecedor signup (FORN-01) | API/Backend (Server Action + auth.api.addMember) | Database (vendors + member rows) | Auth is sensitive — never trust the browser to set membership; tenant resolution from URL slug must happen server-side |
| Marketplace browsing (FORN-02) | Frontend Server (Server Component) | Database (events + lots SELECT via withTenant) | Tenant-scoped read; SSR is the right tier — fast TTI, RLS at DB layer |
| Buyer-mode planta (FORN-03/07) | Browser (Konva canvas) + Frontend Server (initial paint) + API/Backend (SSE Route Handler) | Database (LISTEN/NOTIFY) | Canvas is browser; live updates need a long-lived server connection (SSE Route Handler), but mutation source-of-truth is DB |
| Lot reservation (FORN-04/05) | API/Backend (Server Action wrapping advisory lock + INSERT) | Database (advisory lock + RLS) | Lock semantics MUST be DB-side; never simulate with app-layer mutex |
| Reservation expiry (FORN-06) | Background worker (Graphile-Worker scheduled task) | Database (UPDATE lot_reservations) | At-least-once delivery + retry semantics belong in the worker, not the web server |
| Cart + checkout (FORN-08/09) | API/Backend (Server Action mints Pagar.me order) | External (Pagar.me v5 REST) | Card tokenization happens in browser (Pagar.me JS SDK); order creation happens server-side with X-Idempotency-Key |
| Webhook ingestion (FORN-10/11/12) | API/Backend (Route Handler at /api/webhooks/pagarme) | Background worker (downstream FSM transition + outbox emit) | Webhook hot path is fast-200; processing is moved to worker for retry+idempotency |
| Outbox drain (FORN-13) | Background worker (scheduled `outbox.drain`) | Database (SELECT + UPDATE outbox_events row + enqueue handler jobs in same tx) | Polling cadence runs in worker; transactional drain prevents at-most-once leak |
| SAGA cancel (FORN-14) | Background worker (`payment.failed` handler) | Database (advisory lock + UPDATE lot_reservations) | Compensation logic belongs with the failure handler, not the original happy path |
| Waitlist (FORN-15) | Background worker (`waitlist.notify-next` triggered by outbox `lot.released`) | API/Backend (`/checkout?token=jwt` route validates JWT + advisory-lock-reserves) | Notify via email/SMTP (worker); JWT-token consumer is the web tier with single-use enforcement |
| Refund (FORN-16) | API/Backend (Server Action calls Pagar.me refund + emits outbox event) | External (Pagar.me v5 REST) + Background worker (`refund.process` handler frees lot + waitlist notify) | Self-service trigger from portal; downstream cleanup is async |
| Portal (FORN-17) | Frontend Server (Server Components) | Database + Object storage (MinIO pre-signed GET) | Static-ish UI, tenant-scoped reads, file links via short-TTL pre-signed URLs |
| LGPD consent (FORN-18) | API/Backend (Server Action) | Database (vendor_consents + audit_log) | Compliance-sensitive — every change MUST audit; UI consent form posts to Server Action |

## Standard Stack

### Core (already locked in Phase 0 + 1)
| Library | Version (locked) | Purpose | Provenance |
|---------|------------------|---------|------------|
| `next` | `15.4.x` | Web framework + Route Handler SSE + Server Actions | [VERIFIED: package.json + CLAUDE.md] |
| `drizzle-orm` | `0.45.2` | Type-safe ORM | [VERIFIED: package.json] |
| `postgres` | `3.4.x` | Driver supporting LISTEN/NOTIFY + SET LOCAL | [VERIFIED: package.json] |
| `better-auth` | `1.6.x` (+ organization plugin) | Auth + tenant membership via `addMember` | [CITED: better-auth.com/docs/plugins/organization] |
| `graphile-worker` | `0.16.6` | Background jobs + crontab scheduled tasks | [VERIFIED: package.json + worker.graphile.org/docs/cron] |
| `konva` + `react-konva` | `10.3.x` + `19.2.x` | 2D planta canvas (extend with `mode='buyer'`) | [VERIFIED: Phase 1 ship] |
| `zod` | `4.4.x` | Webhook payload + Server Action input validation | [VERIFIED: package.json] |
| `next-safe-action` | `7.x` | Server Action chain (withTenantAction) | [VERIFIED: src/lib/actions/safe-action.ts] |
| `@react-pdf/renderer` | `3.x` | Recibo PDF generation (Phase 1 contract pattern reused) | [VERIFIED: Phase 1 ship] |

### New for Phase 2
| Library | Recommended Version | Purpose | When to use |
|---------|---------------------|---------|-------------|
| `jose` | `~5.x` | Signed JWT for waitlist 15-min re-reserve link (jti single-use) | [ASSUMED — slopcheck unavailable; planner adds checkpoint:human-verify] |

**Note on Pagar.me SDK:** CLAUDE.md prescribes "no SDK — call REST directly with typed fetch wrappers + Zod". Phase 1 already followed this. Phase 2 extends `src/lib/pagarme/client.ts` with: `cancelCharge(chargeId, {amount?})` + `refundCharge(chargeId, {amount?})` + boleto path in `createOrder` (boleto schema in types.ts) + installments path in credit_card schema. **No new npm dependency needed for Pagar.me.**

**Version verification:**
```bash
# Already verified during Phase 1; planner re-checks before install:
npm view jose version   # ~5.x current
```

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Polling outbox @ 5s (D-17) | LISTEN/NOTIFY for outbox drain | LISTEN already used by SSE — two channels OK, but polling is simpler and 5s latency is fine for email/PDF/lot=sold side effects. KEEP D-17. |
| `jose` for JWT | `jsonwebtoken` | jose is ESM-first + Web-Crypto-API native (matches Next.js 15 runtime); jsonwebtoken is older Node-only. Prefer jose. |
| Advisory lock with `hashtext()` | Advisory lock with two int4 keys (event_id::int4, lot_id::int4) | UUIDs aren't int4 — hashing is required. Using `hashtext(event_id || ':' || lot_id)` is the documented pattern. |
| Pagar.me Multimeios for boleto+PIX | Two parallel charges OR Bolepix via different gateway | Multimeios only supports 2x cards or card+boleto, NOT boleto+pix. See Open Questions Q2. |

## Package Legitimacy Audit

> slopcheck was **not available** in this research environment. All new packages tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task per the gsd-phase-researcher policy.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `jose` | npm | ~7 yrs (panva/jose) | ~30M/wk | github.com/panva/jose | [ASSUMED] | Approved pending operator confirmation (very well-known JOSE library by @panva) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Note:** All other Phase 2 work uses libraries already audited and shipping in production (Phase 0 + 1).

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────── BROWSER ────────────────────────────────────┐
│                                                                            │
│   /[slug]/fornecedor/cadastro    /[slug]/marketplace/[eventId]/planta     │
│   ┌──────────────────────┐       ┌──────────────────────────────────┐    │
│   │  Signup form         │       │  Konva canvas mode='buyer'        │    │
│   │  CNPJ + docs + senha │       │  ─ green = available (clickable)  │    │
│   │                      │       │  ─ grey  = reserved/sold (blocked)│    │
│   └────────┬─────────────┘       │  Click → checkout sidebar         │    │
│            │                     │  (cart + add-ons)                 │    │
│            │                     └───────────┬──────────────────────┘    │
│            │                                 │                            │
│            │             ┌───────────────────┴────── EventSource (SSE) ─┐ │
│            │             │ GET /api/sse/events/[eventId]/lots             │ │
│            ▼             ▼                                                │ │
└────────────┼─────────────┼────────────────────────────────────────────────┘ │
             │             │                                                   │
             ▼             ▼                                                   │
┌─────────── NEXT.JS 15 SERVER ──────────────────────────────────────────────┐│
│                                                                            ││
│   Server Action: signup        Route Handler (SSE):                       ││
│   1. getFullOrgBySlug(slug)    1. authenticate session                    ││
│   2. addMember(userId, orgId)  2. LISTEN event:${id}:lots                 ││
│   3. INSERT vendor (pending)   3. ReadableStream + heartbeat 30s           ││
│   4. enqueueJob email          4. req.signal.abort → UNLISTEN              ││
│                                                                            ││
│   Server Action: reserveLot                                                ││
│   1. withTenant(tenantId, async (db) => {                                  ││
│        const key = hashtext(`lot:${eventId}:${lotId}`)                     ││
│        const locked = pg_try_advisory_xact_lock(key)                       ││
│        if (!locked) → throw ConflictError                                  ││
│        const reservation = INSERT lot_reservations RETURNING *             ││
│        INSERT outbox_events ('lot.reserved', {lot_id, vendor_id})          ││
│        return reservation                                                  ││
│      })                                                                    ││
│                                                                            ││
│   Server Action: checkout                                                  ││
│   1. validate reservation belongs to vendor, not expired                   ││
│   2. POST /core/v5/orders (Pagar.me) with installments OR pix OR boleto    ││
│      └─ idempotency_key minted; X-Idempotency-Key header                   ││
│   3. INSERT payment + pagarme_orders (request_payload + response_payload)  ││
│   4. INSERT outbox_events ('payment.created', {payment_id})                ││
│   5. Return PIX QR / boleto URL / card next-step                           ││
│                                                                            ││
│   Route Handler: POST /api/webhooks/pagarme                                ││
│   1. Verify HMAC signature (X-?-SIGNATURE header)  ← see Open Q1           ││
│   2. INSERT payment_webhooks_inbox (gateway_event_id PK)                   ││
│      └─ ON CONFLICT DO NOTHING → return 200 (duplicate ack)                ││
│   3. enqueueJob('payment.process-webhook', {inbox_id})                     ││
│   4. Respond 200 in <100ms                                                 ││
└─────┬───────────────────────────────────────────────────┬──────────────────┘│
      │                                                   │                   │
      ▼                                                   ▼                   │
┌──── POSTGRES 16 ──────────┐               ┌──── PAGAR.ME v5 ────┐          │
│                           │               │                     │          │
│  tenants                  │               │  POST /orders       │          │
│  events / lots            │               │  POST /charges/.../ │          │
│  lot_reservations         │               │     refunds         │          │
│  cart_addon_lines         │               │  DELETE /charges/id │          │
│  payments + pagarme_orders│               │  Webhook callbacks  │          │
│  payment_webhooks_inbox   │               │                     │          │
│  outbox_events            │               └─────────────────────┘          │
│  lot_waitlist             │                                                 │
│  vendor_consents          │               ┌──── SMTP ───────────┐          │
│  event_addons             │               │   waitlist email    │          │
│  audit_log                │               │   payment confirm   │          │
│                           │               │   refund issued     │          │
│  RLS: tenant_isolation    │               └─────────────────────┘          │
│       on EVERY table      │                                                 │
│                           │                                                 │
│  LISTEN/NOTIFY channel:   │                                                 │
│    event:${id}:lots ──────┼─────► (SSE Route Handler subscribes)           │
└───────────────────────────┘                                                 │
                                                                              │
┌──── GRAPHILE-WORKER (separate Node process) ──────────────────────────────┐│
│                                                                            ││
│   Scheduled tasks (crontab):                                               ││
│   ─ outbox.drain          @ */1m (every 1 min — closest cron granularity)  ││
│     polls outbox_events WHERE processed_at IS NULL → enqueues handlers     ││
│   ─ reservation.expire    @ */1m                                            ││
│     UPDATE lot_reservations SET released_at=now() WHERE expires_at < now() ││
│     and released_at IS NULL                                                ││
│                                                                            ││
│   Event handlers (one per outbox event_type):                              ││
│   ─ payment.paid     →  mark lot=sold, enqueue email + pdf.generate-recibo ││
│   ─ payment.failed   →  release reservation → emit lot.released            ││
│   ─ lot.reserved     →  pg_notify('event:${id}:lots', ...)                 ││
│   ─ lot.sold         →  pg_notify(...)                                     ││
│   ─ lot.released     →  pg_notify(...) + enqueue waitlist.notify-next      ││
│   ─ refund.created   →  enqueue refund.process + email                     ││
│                                                                            ││
│   On-demand tasks:                                                         ││
│   ─ payment.process-webhook  re-fetch order, transition FSM, emit outbox   ││
│   ─ waitlist.notify-next     top 3 of lot_waitlist → email with JWT link   ││
│   ─ refund.process           POST refunds, emit refund.* outbox events     ││
└────────────────────────────────────────────────────────────────────────────┘
```

> **Note on graphile-worker cron granularity:** Crontab minimum is 1 minute [VERIFIED: worker.graphile.org/docs/cron]. CONTEXT.md D-17 says "outbox.drain @ 5s" — this is **not achievable via crontab**. Options: (a) run drain @ 1 min via crontab (acceptable for email/PDF latency, NOT for SSE — but SSE uses pg_notify directly, not outbox), OR (b) run drain via setInterval in a long-running task — graphile-worker has no native sub-minute scheduler. **Recommend (a) for D-17 simplicity**; SSE latency is satisfied because the `lot.reserved/sold/released` events do their `pg_notify` from inside the original transaction via a DB trigger, not via outbox drain. Planner decision required.

### Component Responsibilities

| File / Module | Responsibility | Phase 2 status |
|---------------|----------------|----------------|
| `src/lib/pagarme/client.ts` | Pagar.me REST wrapper | EXTEND: cancelCharge, refundCharge, boleto path, installments |
| `src/lib/pagarme/types.ts` | Pagar.me Zod schemas | EXTEND: boleto schema, refund response shape, webhook event subtypes |
| `src/lib/pagarme/hmac.ts` | NEW: HMAC verify helper | NEW: `verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean` |
| `src/app/api/webhooks/pagarme/route.ts` | Pagar.me webhook handler | REFACTOR: replace Basic Auth with HMAC; inbox INSERT; enqueue worker job; 200 in <100ms |
| `src/lib/actions/payments.ts` | createCharge | REFACTOR: cart + add-ons aggregator; outbox emit instead of direct INSERT |
| `src/lib/actions/reservations.ts` | NEW: reserveLot, releaseReservation | NEW |
| `src/lib/actions/cart.ts` | NEW: addAddonToCart, removeAddonFromCart, totalCart | NEW |
| `src/lib/actions/checkout.ts` | NEW: checkoutCart (PIX/cartão/boleto branch) | NEW |
| `src/lib/actions/refunds.ts` | NEW: requestRefund (4-tier policy) | NEW |
| `src/lib/actions/waitlist.ts` | NEW: joinWaitlist, leaveWaitlist, consumeWaitlistToken | NEW |
| `src/lib/actions/signup-fornecedor.ts` | NEW: signupFornecedor (slug → addMember) | NEW |
| `src/lib/actions/vendor-consents.ts` | NEW: recordConsent, revokeConsent | NEW |
| `src/lib/outbox/emit.ts` | NEW: emitOutboxEvent(db, eventType, aggregateId, payload) | NEW — inside tx |
| `src/lib/outbox/handlers/*.ts` | NEW: one handler per event_type | NEW |
| `src/lib/waitlist/jwt.ts` | NEW: signWaitlistToken / verifyWaitlistToken (jose) | NEW |
| `src/lib/refund/policy.ts` | NEW: computeRefundPct(event_starts_at, refund_policy_json) | NEW |
| `src/jobs/tasks/outbox-drain.ts` | NEW: scheduled task | NEW |
| `src/jobs/tasks/reservation-expire.ts` | NEW: scheduled task | NEW |
| `src/jobs/tasks/payment-process-webhook.ts` | NEW: re-fetch + FSM + emit | NEW |
| `src/jobs/tasks/waitlist-notify-next.ts` | NEW: top-3 fan-out email | NEW |
| `src/jobs/tasks/refund-process.ts` | NEW: POST refund to Pagar.me + emit | NEW |
| `src/jobs/tasks/lot-notify-channel.ts` | NEW: pg_notify wrapper | NEW |
| `src/components/eventos/planta-editor.tsx` | Konva planta | EXTEND: add `mode='buyer'` + click filtering + SSE subscription |
| `src/components/checkout/checkout-sidebar.tsx` | NEW: cart + add-ons + method picker | NEW |
| `src/components/checkout/installments-table.tsx` | NEW: 12x preview | NEW |
| `src/components/portal/*` | NEW: vendor portal | NEW |
| `src/app/api/sse/events/[eventId]/lots/route.ts` | NEW: SSE Route Handler | NEW |
| `src/app/[slug]/fornecedor/cadastro/page.tsx` | NEW: signup form | NEW |
| `src/app/[slug]/marketplace/page.tsx` | NEW: event list | NEW |
| `src/app/[slug]/marketplace/[eventId]/planta/page.tsx` | NEW: buyer planta | NEW |
| `src/app/[slug]/checkout/page.tsx` | NEW: cart + payment | NEW |
| `src/app/[slug]/portal/*` | NEW: portal pages | NEW |

### Pattern 1: Advisory-lock reservation
**What:** Inside a transaction, attempt `pg_try_advisory_xact_lock(hashtext(...))`. If `false`, another tx holds the lock — reject with 409. If `true`, INSERT reservation row + outbox event in same tx. Lock auto-releases at COMMIT/ROLLBACK.

**When to use:** Any time two concurrent requests might race to claim the same finite resource (lot, ticket, slot).

**Example:**
```typescript
// src/lib/actions/reservations.ts
// Source: postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
export const reserveLot = withTenantAction
  .inputSchema(reserveLotSchema)
  .action(async ({ ctx, parsedInput }) => {
    const { eventId, lotId } = parsedInput
    const { db, tenantId, userId } = ctx
    // db is already inside a withTenant transaction.
    // hashtext returns int4; we cast to bigint and combine event_id + lot_id.
    const lockKey = sql`hashtext(${`lot:${eventId}:${lotId}`})::bigint`
    const locked = await db.execute(
      sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS got`
    )
    if (!locked.rows[0].got) {
      throw new Error('Lote já reservado por outro fornecedor — atualize a página.')
    }
    // Re-verify lot status under the lock (defense against a TOCTOU sneak):
    const lotRow = await db.select().from(lots)
      .where(and(eq(lots.id, lotId), eq(lots.status, 'available')))
      .limit(1)
    if (lotRow.length === 0) {
      throw new Error('Lote indisponível.')
    }
    // INSERT reservation
    const reservation = await db.insert(lotReservations).values({
      tenantId, lotId, vendorId: ctx.vendorId,
      expiresAt: sql`now() + interval '15 minutes'`,
    }).returning()
    // INSERT outbox event in same tx (SSE → pg_notify pickup)
    await emitOutboxEvent(db, 'lot.reserved', lotId, {
      reservation_id: reservation[0].id,
      vendor_id: ctx.vendorId,
    })
    return reservation[0]
  })
```

### Pattern 2: Outbox emission inside transaction
**What:** Wrap the business write + outbox-event INSERT in one `withTenant` transaction. Side-effects (email, PDF, lot status flip) happen async via worker.

**Example:**
```typescript
// src/lib/outbox/emit.ts
export async function emitOutboxEvent(
  db: TenantDb,
  eventType: OutboxEventType,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(outboxEvents).values({
    tenantId: sql`current_setting('app.current_tenant_id', true)::uuid`,
    eventType,
    aggregateId,
    payload,
  })
}
```

### Pattern 3: SSE Route Handler with LISTEN/NOTIFY
**Example:**
```typescript
// src/app/api/sse/events/[eventId]/lots/route.ts
// Source: pedroalonso.net SSE pattern + pagarme.helpjuice.com
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest, { params }: { params: { eventId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session) return new Response('Unauthorized', { status: 401 })
  const tenantId = await resolveTenantForEventId(params.eventId)  // sysreader bounded fn
  if (!tenantId || !sessionBelongsTo(session, tenantId)) return new Response('Forbidden', { status: 403 })
  const channel = `event:${params.eventId}:lots`
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      // Heartbeat every 30s — keeps the connection alive across proxies.
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch { clearInterval(heartbeat) }
      }, 30_000)
      // Reserve a dedicated postgres.js connection for LISTEN.
      // CRITICAL: this connection lives outside withTenant — purely transports
      // notifications. NO tenant-scoped queries on this connection; if you need
      // to fetch a lot detail, do it via a separate withTenant tx using db.
      const conn = await reservePgListenConnection()
      await conn.listen(channel, (payload: string) => {
        // payload is the JSON we passed to pg_notify; typically just IDs (see Pitfall 3).
        try { controller.enqueue(encoder.encode(`data: ${payload}\n\n`)) } catch {}
      })
      // Replay missed events via Last-Event-ID (optional Phase 2 polish):
      const lastEventId = req.headers.get('last-event-id')
      if (lastEventId) {
        const missed = await fetchOutboxEventsSince(tenantId, params.eventId, lastEventId)
        for (const ev of missed) {
          controller.enqueue(encoder.encode(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`))
        }
      }
      req.signal.addEventListener('abort', async () => {
        clearInterval(heartbeat)
        try { await conn.unlisten(channel) } catch {}
        try { await conn.end() } catch {}
        try { controller.close() } catch {}
      })
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',  // disable nginx buffering (Coolify Traefik should be fine but harmless)
    },
  })
}
```

### Pattern 4: Webhook HMAC verify (Pagar.me v5)
```typescript
// src/lib/pagarme/hmac.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify the HMAC signature on a Pagar.me v5 webhook. The exact header
 * name is configured per the operator's dashboard (see Open Question Q1).
 *
 * Algorithm: HMAC-SHA256 over the raw request body, then base64.
 * (Verified for the ME parent platform `X-ME-WEBHOOK-SIGNATURE`; the legacy
 *  Pagar.me v5 may differ — operator MUST verify in the dashboard before flip.)
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false
  const computed = createHmac('sha256', secret).update(rawBody).digest()
  let received: Buffer
  try { received = Buffer.from(signatureHeader, 'base64') } catch { return false }
  if (received.length !== computed.length) return false
  return timingSafeEqual(computed, received)
}
```

> The Route Handler MUST read `await req.text()` (or `await req.arrayBuffer()`) and verify BEFORE `JSON.parse` — any normalization (whitespace, key order) breaks HMAC. See Pitfall 1.

### Anti-Patterns to Avoid
- **Reservation without advisory lock.** Two clients clicking the same lot race-INSERT two reservations; both think they won; one Pagar.me order succeeds, both get email.
- **Outbox event emitted AFTER COMMIT.** A crash between commit and outbox INSERT leaks the event. Always emit inside the same tx as the business write.
- **Webhook handler does the work inline.** Pagar.me has a 10s timeout (verified for ME platform); a slow webhook handler triggers retries and amplifies load.
- **LISTEN on a pooled connection.** `LISTEN` is connection-scoped; pooled connections recycle and lose the listener. Use a dedicated long-lived connection (the SSE Route Handler reserves one per client).
- **NOTIFY payload with full row.** Postgres caps NOTIFY payload at 8000 bytes [VERIFIED]. Send IDs only; the client fetches detail via Server Action.
- **JWT without `jti` single-use check.** A waitlist re-reserve link replayed within 15min would let one person hold 2 reservations. Store `jti` consumption in a `waitlist_token_uses` table or include the token in the reservation row.
- **`SET` (not `SET LOCAL`) for tenant context.** Phase 0's invariant — never break.
- **Trust the webhook payload for FSM transition.** Phase 1's belt-and-suspenders re-fetch is non-negotiable; Phase 2 layers HMAC ON TOP.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distributed lock for reservation | Redis `SETNX` / `SET EX NX` / row-level UPDATE+WHERE | `pg_try_advisory_xact_lock(hashtext(...))` | Postgres advisory lock is auto-released on tx end; no orphan locks on crash. No new infrastructure. |
| Job retry + backoff | Custom retry table + cron | Graphile-Worker's built-in exponential backoff (25 attempts ~3 days default) [VERIFIED: worker.graphile.org/docs] | The library does this correctly; rewriting is a Phase 1 pitfall. |
| HMAC signature compare | `==` string compare | `crypto.timingSafeEqual` [VERIFIED: nodejs.org/api/crypto] | Variable-time comparison leaks bits via timing side-channel. |
| JWT signing | Manual `crypto.createHmac` + base64 | `jose` (panva/jose) — `SignJWT` / `jwtVerify` | jose handles alg negotiation, jti, exp, nbf, kid correctly. |
| Cron parser | Re-implement crontab | Graphile-Worker built-in cron syntax | Already wired in `startWorker({ crontab: '...' })`. |
| SSE framing | Manual `:keepalive` + reconnect | Standard SSE: `id:`, `data:`, `\n\n` framing + EventSource API on client | EventSource auto-reconnects with Last-Event-ID header. Just use it. |
| Refund policy tiers | hardcoded if/else | `tenants.refund_policy_json` JSONB array `[{min_days, max_days, refund_pct}]` | Override per tenant without redeploy. |
| Outbox table | Multiple tables per event_type | Single `outbox_events` with `event_type` discriminator + JSONB payload | Phase 2 has ~6 event types; one table + index is simpler and easier to drain in order. |

**Key insight:** Most of Phase 2's "novel" infrastructure (locks, queues, retry, JWT) is already standard Postgres + Graphile-Worker + jose. The Phase 2 work is **integration**, not invention. Resist building custom primitives.

## Runtime State Inventory

> Phase 2 is greenfield with respect to runtime state (no rename/refactor of existing data). Phase 1 fixtures (Trindade tenant + lots + vendors) carry forward. No data migration needed; only schema additions (new tables for reservations / outbox / inbox / waitlist / addons / consents / refund_requests + 2 columns on tenants).

| Category | Items found | Action required |
|----------|-------------|------------------|
| Stored data | None — Phase 2 adds new tables and columns, doesn't rename | n/a |
| Live service config | Pagar.me dashboard webhook URL points to `/api/webhooks/pagarme`. **Phase 2 may need to update webhook event subscription list** (add `charge.refunded`, `charge.partial_canceled`, `order.canceled`) AND **configure the HMAC signing secret** (currently Basic Auth only). | Operator action — see D-14-equivalent gate runbook addendum |
| OS-registered state | None | n/a |
| Secrets / env vars | NEW: `PAGARME_WEBHOOK_SIGNING_SECRET`, `WAITLIST_JWT_SECRET` (separate from BETTER_AUTH_SECRET to avoid blast radius). Keep `PAGARME_WEBHOOK_USER`/`PAGARME_WEBHOOK_PASS` for transition: deploy with both, flip Pagar.me dashboard, drop the Basic Auth check. | Add to `src/lib/env.ts` + `.env.example` + `.env.production.example`; document in Phase 2 RUNBOOK section |
| Build artifacts | None | n/a |

## Common Pitfalls

### Pitfall 1: HMAC mismatch due to body normalization
**What goes wrong:** Handler reads `req.json()` (parses + reserializes), then computes HMAC over `JSON.stringify(parsed)` — the canonical form does NOT match what Pagar.me signed (different whitespace, key ordering). Every webhook fails 401.
**Why it happens:** `req.json()` parses, you lose the raw bytes.
**How to avoid:** Read `await req.text()` (or `arrayBuffer`) FIRST, compute HMAC on the exact bytes, THEN `JSON.parse`.
**Warning signs:** All Pagar.me webhooks return 401 in production after switching from Basic Auth.

### Pitfall 2: Webhook retry storm during outage
**What goes wrong:** Your DB is down for 5 min; Pagar.me retries (10s timeout × 13 attempts over 7 days) — when DB comes back, thousands of webhooks hit at once and amplify load.
**Why it happens:** Naive handler does the FSM work inline and only returns 200 after success.
**How to avoid:** D-15 fast-200 — accept the inbox INSERT (with `ON CONFLICT DO NOTHING`), enqueue worker job, return 200 in <100ms. Even during partial outage, you absorb the storm: duplicate deliveries collapse on the inbox PK.
**Warning signs:** Spike in `payment_webhooks_inbox` rows with same `gateway_event_id` (acceptable — but ALSO spike in `processing_status='pending'` not draining → worker concurrency issue).

### Pitfall 3: LISTEN/NOTIFY payload size limit (8000 bytes)
**What goes wrong:** You `pg_notify('event:X:lots', JSON.stringify(fullRow))` — works in dev with small rows, fails silently in prod when payload grows.
**Why it happens:** Postgres caps NOTIFY payload at 8000 bytes [VERIFIED: postgresql.org]. Postgres throws SQLSTATE 22023 if exceeded.
**How to avoid:** **Send IDs only**: `pg_notify('event:X:lots', JSON.stringify({lot_id, new_status, event_id}))`. SSE subscriber fetches detail via a Server Action (or just renders the new status directly — for lot color, the status is all you need).
**Warning signs:** `payload string too long for notification` errors in Postgres log.

### Pitfall 4: SSE connection leak (no abort on disconnect)
**What goes wrong:** Client disconnects; server keeps the LISTEN connection open + heartbeat interval running. Memory leak grows over hours.
**Why it happens:** Forgot `req.signal.addEventListener('abort', cleanup)`.
**How to avoid:** Always wire `req.signal.abort` to `clearInterval(heartbeat)` + `await conn.end()` + `controller.close()`. Pattern 3 above shows the full structure.
**Warning signs:** Postgres `pg_stat_activity` shows hundreds of idle `LISTEN`-state connections; pg pool exhaustion within hours of release.

### Pitfall 5: Advisory lock hashtext collision
**What goes wrong:** `hashtext()` returns int4 (32 bits) [VERIFIED: postgresql wiki]. Two distinct `lot:${eventId}:${lotId}` strings can hash to the same int — both lock attempts return false, neither vendor reserves, both think they lost.
**Why it happens:** 32-bit space has ~4B values; with millions of (event, lot) pairs across the system, birthday-paradox collisions are non-zero (sub-millisecond serialization is the cost).
**How to avoid:** **Acceptable** for Phase 2 piloto Trindade scale (~thousands of lots). For Phase 4, switch to two int4 keys: `pg_try_advisory_xact_lock(event_id_int4_hash, lot_id_int4_hash)` (separate 32-bit key spaces — two distinct (a,b) tuples don't collide even if individual hashes match the other's). Document as known scale limit; add a contract test that warns at >10M lots per tenant.
**Warning signs:** Two clients both see "Lote já reservado" but no reservation row exists.

### Pitfall 6: Cart abandonment with outbox event already emitted
**What goes wrong:** Vendor reserves lot → `outbox_events` row inserted with `lot.reserved` → email task enqueued → reservation expires without payment → email already sent.
**Why it happens:** `lot.reserved` outbox handler enqueues a "reservation confirmed" email too eagerly.
**How to avoid:** Don't send "reservation confirmed" email at `lot.reserved` time — wait for `payment.created` event (after Pagar.me POST succeeds). Use `lot.reserved` only for SSE pg_notify (no email side-effect). Document handler-by-handler what fires.

### Pitfall 7: Cross-tenant CNPJ vendor_email collision
**What goes wrong:** Two tenants seed the same `vendor.email` as Better Auth user — second signup fails on UNIQUE.
**Why it happens:** Better Auth `user.email` is GLOBAL UNIQUE by default (not tenant-scoped).
**How to avoid:** Document D-22 explicitly: in Better Auth `user` table, email IS global; if the same human signs up at 2 tenants, Better Auth re-uses the same `user` row + creates 2 `member` rows (one per org). `vendor` rows are independent — keep `vendors.email` tenant-scoped (RLS) and unique within tenant only: `UNIQUE (tenant_id, email)`. Same applies to CNPJ.
**Warning signs:** "Email já cadastrado" on signup when user IS legit; check if existing Better Auth user can be re-used + add a member row.

### Pitfall 8: Refund applied after `lot.sold` already emitted
**What goes wrong:** Vendor pays → `payment.paid` outbox → handler emits `lot.sold` → vendor refunds → handler tries to release lot, but the lot status flow is `available → reserved → sold → ???`. There's no `sold → available` transition documented.
**Why it happens:** State machine not designed for refund-after-sold.
**How to avoid:** Document the lot FSM explicitly with refund transitions: `sold → released` (when refund.created); update `lots.status` directly in the `refund.process` outbox handler inside withTenant + advisory lock to avoid race with a fresh waitlist re-reserve. Emit `lot.released` event AFTER status update succeeds.

### Pitfall 9: Boleto PDF cached at CDN edge
**What goes wrong:** Pagar.me boleto PDF URL is short-lived; CDN caches it; vendor visits later and sees a stale or 404 boleto.
**Why it happens:** Default Vercel/Coolify Traefik caches `application/pdf` aggressively.
**How to avoid:** Boleto PDF is served via Pagar.me's own URL — we just embed the link. Add `Cache-Control: no-store` on our portal page that displays the boleto link, and refresh the link from Pagar.me API on each portal visit (boleto.line / boleto.url fields). Don't pre-render.

### Pitfall 10: JWT replay attack on waitlist link
**What goes wrong:** Vendor receives waitlist email → forwards to friend → friend opens link → reserves the lot. Original vendor opens too → "token already used".
**Why it happens:** No single-use enforcement on the JWT.
**How to avoid:** Include `jti` (UUID) in the JWT payload. Server-side, on `/checkout?token=X` GET, the server: (1) verify JWT signature + exp, (2) INSERT into `waitlist_token_uses(jti, consumed_at)` with PK on `jti`, (3) on UNIQUE violation, reject "link já usado". Atomically with the reservation INSERT.

### Pitfall 11: Graphile-Worker outbox.drain stuck job
**What goes wrong:** One bad outbox row causes the handler to throw; graphile-worker retries with backoff; subsequent rows wait behind it (depending on lock semantics).
**Why it happens:** Drain task pulls a batch and processes serially; a poison row blocks progress.
**How to avoid:** Drain task does `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100` so a worker that's stuck on one row doesn't block another worker. After N failed attempts (configurable), mark `processing_status='failed'` and SKIP — alert via Sentry. Document the dead-letter recovery path in RUNBOOK.

### Pitfall 12: Multi-instance SSE on same tenant — fan-out semantics
**What goes wrong:** Coolify scales to 2 web instances; vendor A's reservation triggers pg_notify → BOTH instances receive the NOTIFY → only the instance with vendor B's SSE connection forwards the message. Easy bug: if instances reconnect on different cycles, NOTIFY can be missed.
**Why it happens:** LISTEN/NOTIFY in Postgres is a FAN-OUT — every connection LISTENing on a channel receives every NOTIFY.
**How to avoid:** **Document as INVARIANT**: every web instance LISTENs on every channel that has an active SSE client; pg_notify naturally fans out; no extra coordination needed. The risk is only if a connection drops mid-NOTIFY → use Last-Event-ID replay (Pattern 3) to backfill from `outbox_events`.
**Warning signs:** Vendor sees stale lot status because their SSE was on instance A but the NOTIFY was sent while their connection was on instance B. (Solution: heartbeat + reconnect.)

### Pitfall 13: Boleto+PIX hybrid does not exist in Pagar.me v5
**What goes wrong:** D-04 assumes Pagar.me v5 supports `boleto: { expires_in: 3, business_days: true }, pix_qrcode: { enabled: true }` — this is NOT in the documented API.
**Why it happens:** CONTEXT.md was drafted from a hypothetical reading of "BoletoPix" (a Brazilian banking product) — but Pagar.me's Multimeios only supports 2-cards or card+boleto, NOT boleto+pix in one charge.
**How to avoid:** Plan one of three alternatives (operator decides — see Open Question Q2):
- **(A) Boleto-only with `due_at` 3 business days out** — fornecedor pays traditional boleto OR pays via their bank's PIX from the boleto barcode (banking-side, not Pagar.me-side). Simpler. **Recommended for Phase 2 MVP.**
- **(B) Two parallel charges (PIX + boleto)** with different `code` fields tying both to same cart. First-paid wins; cancel the other on `charge.paid` webhook. Complex orchestration.
- **(C) Single PIX with 3-day expiry** — `pix.expires_in: 259200` (3 days in seconds). Skip boleto entirely. Lose the "physical boleto for old-school fornecedor" UX but cleanest. **Trindade pilot demographic may or may not need physical boleto.**

## Code Examples

### Common Operation 1: Reserve lot with advisory lock + outbox emit
See Pattern 1 above (full code).

### Common Operation 2: Webhook handler with HMAC + inbox INSERT + enqueue
```typescript
// src/app/api/webhooks/pagarme/route.ts (Phase 2 refactor)
import { verifyWebhookSignature } from '@/lib/pagarme/hmac'
import { migratorPool } from '@/db/migrator-pool'
import { enqueueJob } from '@/jobs/enqueue'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = Buffer.from(await req.arrayBuffer())
  const sig = req.headers.get('x-hub-signature')  // ⚠️ header name pending Open Question Q1
  const secret = process.env.PAGARME_WEBHOOK_SIGNING_SECRET
  if (!secret) {
    log.error('PAGARME_WEBHOOK_SIGNING_SECRET not configured')
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 })
  }
  if (!verifyWebhookSignature(rawBody, sig, secret)) {
    log.warn('invalid HMAC signature')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // Parse AFTER signature verify
  let event: PagarmeWebhookEvent
  try {
    const parsed = JSON.parse(rawBody.toString('utf8'))
    event = pagarmeWebhookEventSchema.parse(parsed)
  } catch {
    return NextResponse.json({ ok: true, ignored: 'invalid_payload' }, { status: 200 })
  }
  // INSERT inbox (idempotent via PK)
  try {
    await migratorPool`
      INSERT INTO payment_webhooks_inbox
        (gateway_event_id, event_type, payload, received_at)
      VALUES (${event.id}, ${event.type}, ${rawBody.toString('utf8')}::jsonb, now())
      ON CONFLICT (gateway_event_id) DO NOTHING
    `
  } catch (err) {
    log.error({ err }, 'inbox insert failed')
    return NextResponse.json({ error: 'inbox_failed' }, { status: 500 })
  }
  // Enqueue worker (NOT inside withTenant — tenant unknown at this layer)
  await enqueueJob(migratorPool, 'payment.process-webhook', {
    inbox_id: event.id,
  })
  return NextResponse.json({ ok: true }, { status: 200 })
}
```

### Common Operation 3: outbox.drain task
```typescript
// src/jobs/tasks/outbox-drain.ts
export const outboxDrain: Task = async (_payload, helpers) => {
  // No tenant context — drain across all tenants via migrator role.
  // Each handler invocation wraps its body in withTenant(row.tenant_id).
  await migratorPool.begin(async (tx) => {
    const rows = await tx<Array<OutboxRow>>`
      SELECT id, tenant_id, event_type, aggregate_id, payload
        FROM outbox_events
       WHERE processed_at IS NULL
       ORDER BY created_at
       LIMIT 100
       FOR UPDATE SKIP LOCKED
    `
    for (const row of rows) {
      // Enqueue the per-event-type handler — payload includes tenant_id
      // so the handler can re-enter withTenant correctly.
      const taskName = handlerForEventType(row.event_type)  // map event_type → task name
      await enqueueJob(tx, taskName, {
        tenant_id: row.tenant_id,
        outbox_id: row.id,
        aggregate_id: row.aggregate_id,
        payload: row.payload,
      })
      await tx`UPDATE outbox_events SET processed_at = now() WHERE id = ${row.id}`
    }
  })
}
```

### Common Operation 4: Compute refund pct from policy
```typescript
// src/lib/refund/policy.ts
const DEFAULT_POLICY: RefundTier[] = [
  { min_days_before_event: 30, refund_pct: 100 },
  { min_days_before_event: 15, refund_pct: 50 },
  { min_days_before_event: 7,  refund_pct: 25 },
  { min_days_before_event: 0,  refund_pct: 0 },
]

export function computeRefundPct(
  eventStartsAt: Date,
  policy: RefundTier[] = DEFAULT_POLICY,
  now: Date = new Date(),
): number {
  const daysBefore = (eventStartsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  // Tiers are inclusive at the lower bound; sort desc by min_days_before_event.
  const sorted = [...policy].sort((a, b) => b.min_days_before_event - a.min_days_before_event)
  for (const tier of sorted) {
    if (daysBefore >= tier.min_days_before_event) return tier.refund_pct
  }
  return 0
}
```

### Common Operation 5: Sign and verify waitlist JWT
```typescript
// src/lib/waitlist/jwt.ts
import { SignJWT, jwtVerify } from 'jose'

const ALG = 'HS256'
function getKey() { return new TextEncoder().encode(process.env.WAITLIST_JWT_SECRET ?? '') }

export async function signWaitlistToken(opts: {
  tenant_id: string; vendor_id: string; lot_id: string; ttl_seconds?: number
}): Promise<string> {
  const jti = crypto.randomUUID()
  return await new SignJWT({ ...opts, jti })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${opts.ttl_seconds ?? 900}s`)
    .setJti(jti)
    .sign(getKey())
}

export async function verifyWaitlistToken(token: string): Promise<{
  tenant_id: string; vendor_id: string; lot_id: string; jti: string;
}> {
  const { payload } = await jwtVerify(token, getKey(), { algorithms: [ALG] })
  return payload as never
}
```

## State of the Art

| Old approach (would do in 2018-2022) | Current approach (2026 stack) | Impact |
|--------------------------------------|-------------------------------|--------|
| Redis distributed lock + retry logic | `pg_try_advisory_xact_lock` | One fewer infra dependency; lock auto-released on tx end |
| Sidecar job processor (Sidekiq, BullMQ, Celery) | Graphile-Worker (Postgres-backed) | Phase 0 ADR-0001 decision; no Redis needed |
| WebSockets for real-time | SSE + LISTEN/NOTIFY | Phase 0 decision; no sticky sessions, no WS server, scales horizontally via pg_notify fan-out |
| Polling every 5s for status | SSE push from Postgres triggers | <500ms latency from DB write to client paint |
| Multipart-form-upload via server | Pre-signed PUT direct browser → MinIO | Server doesn't touch the bytes; Phase 1 D-05 pattern |
| Custom JWT impl with `crypto.createHmac` | `jose` (panva/jose) | Audit-grade lib; standardized alg negotiation |
| Outbox event = trigger on table | Outbox event = explicit INSERT in same tx | Easier to test, no PG trigger black magic |
| Sync API call to Pagar.me from Server Action | Same — Pagar.me is synchronous and idempotent via X-Idempotency-Key | (no change — Pagar.me API is sync; queue only the SIDE-EFFECTS) |

**Deprecated / outdated:**
- Bare `SET app.current_tenant_id = ...` (without LOCAL) — banned in this codebase since Phase 0.
- Webhook handlers that do FSM work inline + return 200 only after success — replaced with fast-200 + worker.
- Pagar.me v3/v2 API surface (still alive but legacy; we lock on v5).

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Pagar.me v5 webhook HMAC header name is `X-Hub-Signature` and algo SHA-256 hex (CONTEXT D-13) | Webhook handler | If wrong (e.g. it's `X-ME-WEBHOOK-SIGNATURE` base64 — see ME platform docs), all webhooks reject 401 in prod after the cutover. **MUST verify in Pagar.me dashboard before D-14-equivalent flip.** |
| A2 | Pagar.me supports boleto+PIX hybrid via `boleto.expires_in/business_days` + `pix_qrcode.enabled` (CONTEXT D-04) | Pagar.me schema | Documentation contradicts: Pagar.me uses `due_at` ISO date for boleto and has no documented `pix_qrcode` toggle on boleto. **Mitigation: Plan one of Pitfall 13 alternatives (A/B/C).** |
| A3 | Pagar.me cartão installments parameter accepts `interest_type: 'compound'` (CONTEXT D-03) | Credit card schema | Unverified — public Pagar.me docs only show `installments: 1..12`; the interest configuration appears to be set in the Pagar.me dashboard per merchant, not per request. **Mitigation: Test in sandbox; if not per-request, fornecedor sees pre-configured installments only.** |
| A4 | `jose` library is the correct JWT choice + slopcheck unavailable to verify | Stack | If a malicious package squat exists with similar name, install would import unverified code. **Mitigation: planner adds `checkpoint:human-verify` before `pnpm add jose`.** |
| A5 | graphile-worker crontab supports `*/1m` granularity for outbox.drain (D-17 says 5s) | Scheduled jobs | Verified that minimum is 1 min — **D-17 5s target is unachievable via crontab. Mitigation: drain @ 1 min via crontab; SSE doesn't depend on drain (uses pg_notify directly).** |
| A6 | LISTEN/NOTIFY payload 8000-byte limit applies to NOTIFY string only (not channel name overhead) | SSE | Channel name + payload combined counts. Sending lot_id only is safe. **Mitigation: enforce in code — only IDs in payload.** |
| A7 | Better Auth `addMember` is server-only and respects RLS via existing Phase 0 tenant_isolation policies on `member` table | Signup | Verified [CITED: better-auth.com/docs/plugins/organization]; member table already has tenant_isolation RLS policy from Phase 0 Migration 0001. |
| A8 | The same Better Auth user can be a member of multiple orgs (CNPJ → 2 vendor rows in 2 tenants — D-22) | Signup | Confirmed: Better Auth org plugin explicitly supports multi-membership per user. |
| A9 | Postgres `hashtext()` collision rate is acceptable for Phase 2 piloto scale | Advisory lock | OK for Trindade (~5000 lots); document scale limit per Pitfall 5. |
| A10 | Pagar.me refund endpoint is `DELETE /core/v5/charges/{id}` with optional `amount` body for partial refunds (NOT `POST /charges/{id}/refunds` as D-08 states) | Refund | Verified [CITED: docs.pagar.me/reference/cancelar-cobrança] — actual endpoint shape is DELETE not POST. **Mitigation: update payments.ts to match real endpoint.** |
| A11 | Pagar.me supports cross-method refund (boleto paid → refund via PIX) | Refund | NOT directly verified in public docs; CONTEXT D-08 claims this. **Mitigation: Test in sandbox; if not supported, refund-via-PIX needs operator to issue bank transfer instead.** |

## Open Questions

### Q1. ⚠️ HIGH PRIORITY — Pagar.me v5 webhook HMAC header name + algorithm
- **What we know:** ME parent platform uses `X-ME-WEBHOOK-SIGNATURE` (HMAC-SHA256 base64). Phase 1 RESEARCH §A8 documented (correctly, at the time) that legacy Pagar.me v5 used Basic Auth only. CONTEXT.md D-13 claims `X-Hub-Signature` SHA-256 — this header name is **not corroborated** by any public Pagar.me v5 documentation I found.
- **What's unclear:** Is the HMAC actually shipped on legacy `api.pagar.me/core/v5` webhooks? Is the header `X-Hub-Signature`, `X-ME-WEBHOOK-SIGNATURE`, `Webhook-Signature`, or something else? Hex or base64 encoding? Is the signing secret managed in the merchant dashboard or via a separate API call?
- **Recommendation:** **TRY IN SANDBOX FIRST.** Configure a test webhook in the Pagar.me dashboard, point it to a logging endpoint, post a sample transaction, capture all headers, and document the exact name + algorithm. Alternatively, **ASK USER** to share a screenshot of the Pagar.me dashboard webhook signature configuration UI. Phase 2 plan must include a probe-test task (mirroring Phase 0 Plan 06 add_job signature probe) that asserts the configured header name + format matches what arrives.

### Q2. ⚠️ HIGH PRIORITY — Boleto+PIX hybrid feasibility
- **What we know:** Pagar.me Multimeios doc explicitly lists supported combinations: 2x cards OR 1 card + 1 boleto. Boleto+PIX is NOT listed. Boleto endpoint uses `due_at` ISO timestamp, not `expires_in/business_days`. No `pix_qrcode` toggle documented on the boleto.
- **What's unclear:** Is there an undocumented Pagar.me feature ("BoletoPix" or similar) for PSP-tier merchants? Or is the user's intent "boleto with PIX rendered alongside on a single PDF" which would require either two parallel charges or a third-party PDF compositor?
- **Recommendation:** **ASK USER** to choose among:
  - (A) **Boleto-only with 3-business-day `due_at`** (recommended — simplest).
  - (B) **Two parallel charges PIX + boleto** with a "first paid wins" SAGA (complex, but matches D-04 intent).
  - (C) **Drop boleto entirely**, use PIX with 3-day `expires_in: 259200`.
  - (D) **Confirm Pagar.me dashboard has a "Bolepix" toggle** (some PSP integrations of Stone/Pagar.me support this; ASK ACCOUNT MANAGER).

### Q3. ⚠️ MEDIUM — Pagar.me credit_card interest_type semantics
- **What we know:** Documented `installments: 1..12` exists. CONTEXT D-03 `interest_type: 'compound'` is plausible but unverified in v5 docs.
- **What's unclear:** Is interest configured per-request, per-merchant-dashboard, or via the recipient's MDR? Does Pagar.me v5 expose an `installments_table` or similar shape in the response showing the calculated juros for the buyer UI?
- **Recommendation:** **TRY IN SANDBOX** — create a credit_card charge with various installment values and inspect the response. The Phase 2 checkout UI must show "12x R$ 114" — that requires either the Pagar.me API echoing per-installment amount OR our app computing it from a static rate. Document the verified pattern.

### Q4. MEDIUM — Should `payment.process-webhook` task wrap in withTenant or stay sysreader?
- **What we know:** Phase 1 webhook handler resolves tenant via `migratorPool` then enters `withTenant`. For Phase 2 we move processing to a worker task — same pattern OK, but graphile-worker tasks already need to wrap their body in withTenant per Phase 0 invariant.
- **What's unclear:** Does the task receive `tenant_id` in payload? Current sketch passes `{inbox_id}` only — that means the task must re-resolve tenant from `payment_webhooks_inbox` via migrator pool (or denormalize tenant_id into the inbox row at INSERT time).
- **Recommendation:** **Denormalize**: when the webhook handler does the inbox INSERT, also resolve tenant_id via the existing `fb_lookup_tenant_for_pagarme_order` sysreader function and store it in the inbox row. Worker then has `tenant_id` in payload — clean withTenant entry. Planner decision.

### Q5. LOW — Outbox drain cadence in production
- **What we know:** D-17 says 5s; graphile-worker crontab min is 1 min.
- **What's unclear:** Is 1-min latency on email/PDF generation acceptable for Phase 2 piloto?
- **Recommendation:** Yes — Phase 1 Resend emails arrive in seconds because the JobInsert→worker pickup→render→send chain is sub-second from queue. The 1-min drain pull is only the worst-case "row sits unprocessed before drain finds it"; in practice the drain task often runs within seconds of cron tick if worker is idle. Document as acceptable for Phase 2; Phase 3+ may add NOTIFY-driven instant drain.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Pagar.me API (api.pagar.me/core/v5) | All checkout/refund paths | ✓ (Phase 1 verified) | v5 | No fallback — checkout blocked |
| PostgreSQL 16 (advisory locks, LISTEN/NOTIFY, JSONB) | Everything | ✓ | 16-alpine | None — hard contractual |
| Graphile-Worker (cron + retry) | Scheduled tasks + outbox | ✓ (Phase 0 Plan 06) | 0.16.6 | None — already wired |
| Better Auth org plugin | Fornecedor signup (FORN-01) | ✓ (Phase 0 Plan 04) | 1.6.x | None |
| MinIO (pre-signed PUT/GET) | Vendor docs upload (FORN-01) + recibo PDF download (FORN-17) | ✓ (Phase 1) | 8.x | None |
| SMTP (nodemailer transport) | Waitlist + payment + refund email (FORN-15) | ✓ (Phase 1 D-14 swap) | nodemailer | None |
| @react-pdf/renderer | Recibo PDF for FORN-17 | ✓ (Phase 1) | 3.x | None |
| `jose` (JWT) | Waitlist 15-min link (FORN-15) | ✗ — new dep | needs install | None — required for D-11 secure link |
| BrasilAPI | CNPJ validation on fornecedor signup (FORN-01) | ✓ (Phase 1 D-16) | v1 | 7-day cache + degrade-with-warning (Phase 1 pattern reused) |
| ZapSign | Recibo of payment is OPTIONAL (no contract re-sign needed for refund) | ✓ (Phase 1) | sandbox/prod | n/a |

**Missing dependencies with no fallback:** None — all blocking deps already shipped.
**Missing dependencies needing install:** `jose` (1 npm package).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.6.x (existing); Playwright 1.x (existing for E2E) |
| Config file | `vitest.config.ts` + `playwright.config.ts` (Phase 0 + 1 patterns) |
| Quick run command | `pnpm test --run` (unit/integration ~100s) |
| Full suite command | `pnpm test --run && pnpm playwright test` (full E2E ~5min) |

### Phase Requirements → Test Map
| REQ ID | Behavior | Test type | Automated command | File status |
|--------|----------|-----------|-------------------|-------------|
| FORN-01 | Vendor signup via `/[slug]/fornecedor/cadastro` creates vendor row + Better Auth member row | integration | `pnpm vitest tests/fornecedor/signup.test.ts -x` | ❌ Wave 0 |
| FORN-02 | `/[slug]/marketplace` lists tenant's published events; cross-tenant invisible | integration | `pnpm vitest tests/marketplace/list.test.ts -x` | ❌ Wave 0 |
| FORN-03 | Konva planta `mode='buyer'` blocks sold/reserved lots from click | unit (component) | `pnpm vitest tests/components/planta-buyer-mode.test.tsx -x` | ❌ Wave 0 |
| FORN-04 | Successful reservation creates `lot_reservations` row with `expires_at = now() + 15min` | integration | `pnpm vitest tests/reservations/create.test.ts -x` | ❌ Wave 0 |
| FORN-05 | Concurrent reserve attempts on same lot: exactly 1 wins, others get 409 | load test (concurrent) | `pnpm vitest tests/reservations/concurrent.test.ts -x` | ❌ Wave 0 — **load-bearing** |
| FORN-06 | Scheduled task `reservation.expire` releases expired reservations within 1 cron tick | integration | `pnpm vitest tests/jobs/reservation-expire.test.ts -x` | ❌ Wave 0 |
| FORN-07 | SSE Route Handler emits message after pg_notify in another connection | integration | `pnpm vitest tests/sse/route.test.ts -x` | ❌ Wave 0 |
| FORN-08 | Cart add-on lines compute total = lot_price + Σ add-on prices | unit | `pnpm vitest tests/cart/total.test.ts -x` | ❌ Wave 0 |
| FORN-09 | Pagar.me PIX, credit_card with installments (1, 6, 12), boleto charge creation paths | integration (MSW Pagar.me) | `pnpm vitest tests/payments/checkout-paths.test.ts -x` | ❌ Wave 0 |
| FORN-10 | Webhook delivered twice with same `gateway_event_id`: only 1 inbox row, only 1 FSM transition | integration | `pnpm vitest tests/webhooks/pagarme-idempotent.test.ts -x` | ❌ Wave 0 |
| FORN-11 | Valid HMAC accepted (200); invalid rejected (401) | unit | `pnpm vitest tests/webhooks/hmac-verify.test.ts -x` | ❌ Wave 0 |
| FORN-12 | Webhook responds <100ms p95 (handler does inbox INSERT + enqueue only) | integration (perf assertion) | `pnpm vitest tests/webhooks/perf.test.ts -x` | ❌ Wave 0 |
| FORN-13 | Outbox row + business write in same tx: rollback ⇒ neither persists | integration | `pnpm vitest tests/outbox/atomic.test.ts -x` | ❌ Wave 0 |
| FORN-14 | `payment.failed` outbox handler releases reservation atomically | integration | `pnpm vitest tests/outbox/saga-cancel.test.ts -x` | ❌ Wave 0 |
| FORN-15 | Waitlist email sent to top 3; JWT valid for 15 min; single-use enforced | integration | `pnpm vitest tests/waitlist/notify-and-consume.test.ts -x` | ❌ Wave 0 |
| FORN-16 | Refund Pagar.me sandbox call + outbox event + lot=released cascade | integration | `pnpm vitest tests/refunds/end-to-end.test.ts -x` | ❌ Wave 0 |
| FORN-17 | Portal pages render vendor's purchases + signed download URLs | integration | `pnpm vitest tests/portal/render.test.ts -x` | ❌ Wave 0 |
| FORN-18 | Recording consent inserts `vendor_consents` + audit row; revoke flips `revoked_at` | integration | `pnpm vitest tests/lgpd/vendor-consent.test.ts -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test --run`
- **Per wave merge:** `pnpm test --run && pnpm playwright test --project=chromium`
- **Phase gate (Phase 2 D-14-equivalent):** Full suite + `pnpm playwright test --project=phase2-gate` against Pagar.me sandbox + Trindade tenant — must pass green before flipping production.

### Wave 0 Gaps
- [ ] `tests/fornecedor/signup.test.ts` — fornecedor signup integration
- [ ] `tests/reservations/concurrent.test.ts` — **load-bearing**: 50 concurrent reserve attempts on same lot, assert exactly 1 win, 49 × 409 errors. This is the proof artifact for FORN-05 + advisory lock semantics.
- [ ] `tests/webhooks/pagarme-idempotent.test.ts` — deliver same webhook twice; assert single side-effect chain
- [ ] `tests/outbox/atomic.test.ts` — assert outbox+business write rollback together
- [ ] `tests/sse/route.test.ts` — pg_notify from another tx → SSE client receives event
- [ ] `tests/waitlist/notify-and-consume.test.ts` — full FORN-15 fan-out + JWT single-use
- [ ] `tests/refunds/end-to-end.test.ts` — Pagar.me refund call + outbox cascade + lot=released
- [ ] `tests/components/planta-buyer-mode.test.tsx` — Konva click filtering when `mode='buyer'`
- [ ] `tests/e2e/walking-skeleton.spec.ts` — extend with D-14-equivalent block: signup fornecedor → marketplace → planta-buyer → reserve → PIX checkout → sandbox payment.paid → recibo email
- [ ] MSW handlers in `tests/test-mocks/pagarme.ts` need to model: HMAC signature, refund endpoint, cancel endpoint, installments table, boleto path
- [ ] `tests/test-mocks/graphile-worker.ts` — in-process task runner harness for testing scheduled tasks deterministically
- [ ] `tests/test-utils/dual-tenant.ts` — already exists from Phase 1 (TENA-07); reuse

### D-14-Equivalent Gate Test
Mirror of Phase 1 D-14: `describe.serial('Phase 2 gate — fornecedor PIX vertical', () => { ... })` in `tests/e2e/walking-skeleton.spec.ts`. Sub-steps:
1. Fornecedor signs up at `/{slug}/fornecedor/cadastro` (DB-direct fallback: insert vendor row)
2. Fornecedor navigates marketplace → opens event planta → clicks an available lot
3. Cart shows lot + (optional) add-ons; fornecedor picks PIX → checkout posts to Pagar.me sandbox
4. Sandbox webhook simulator delivers `order.paid` with valid HMAC → `payment_webhooks_inbox` row inserted → worker processes → outbox emits → email + recibo
5. Terminal assertion: `payments.status='paid'` AND `lots.status='sold'` AND `outbox_events` has `payment.paid` with `processed_at IS NOT NULL`
6. CHECKPOINT: operator approval required to flip Pagar.me webhook auth from Basic Auth (Phase 1) to HMAC (Phase 2) + flip env vars.

## Security Domain

> Phase 2 has explicit security surface (auth, payments, webhooks, PII). All applicable ASVS categories covered.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Better Auth (Phase 0 wired); 2FA optional via existing config |
| V3 Session Management | yes | Better Auth sessions in Postgres; existing pattern |
| V4 Access Control | yes | RLS-FORCED at DB layer (Phase 0); withTenantAction at app layer; advisory lock for resource access (FORN-05) |
| V5 Input Validation | yes | Zod 4 schemas at every Server Action + webhook payload boundary |
| V6 Cryptography | yes | `crypto.timingSafeEqual` for HMAC; `jose` (panva) for JWT; never hand-roll |
| V7 Error Handling & Logging | yes | Pino structured logs (Phase 0); Sentry tags every event with tenant_id |
| V8 Data Protection | yes | LGPD baseline (Phase 0); vendor PII via `COMMENT ON COLUMN ... 'PII:...'` |
| V9 Communications | yes | TLS via Coolify Traefik (Phase 0 deploy) |
| V10 Malicious Code | yes | Dependency lock + slopcheck gate (gsd-phase-researcher policy) |
| V13 API & Web Service | yes | Webhook HMAC; X-Idempotency-Key on POST; rate limits (next phase) |

### Known Threat Patterns for the FB_EVENTOS stack

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| Webhook spoofing (attacker POSTs to /api/webhooks/pagarme) | Spoofing | HMAC verify FIRST + re-fetch defense (belt-and-suspenders Phase 1 pattern retained) |
| Replay attack on webhook | Tampering | `payment_webhooks_inbox` PK on `gateway_event_id` → ON CONFLICT DO NOTHING |
| Cross-tenant data leak via missing withTenant | Information disclosure | FORCE RLS + non-BYPASSRLS role; integration test `dual-tenant.ts` (Phase 0 TENA-07) |
| Reservation race (TOCTOU) | Tampering | `pg_try_advisory_xact_lock` BEFORE re-read lot status under the lock |
| JWT replay on waitlist link | Replay | `jti` UUID + single-use enforcement table |
| PII in audit log (LGPD breach) | Information disclosure | SHA-256 hash of email/cnpj in payload (Phase 1 D-14 pattern) |
| Refund-from-sold race (vendor refunds while waitlist re-reserves) | Race | Advisory lock during refund + status read-then-update; outbox emits `lot.released` only after status change committed |
| Credit card token exposure | Information disclosure | Pagar.me JS SDK browser-side tokenization; our server NEVER touches raw card data |
| HMAC secret leaked in logs | Information disclosure | Env-only; never log; Sentry data-scrubbing config (Phase 0) |
| SSE auth bypass | Spoofing | Verify Better Auth session + tenant ownership BEFORE opening stream |

## Sources

### Primary (HIGH confidence — verified against authoritative documentation in this session)

- [PostgreSQL Documentation §13.3.5 Advisory Locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) — `pg_try_advisory_xact_lock` semantics, auto-release at tx end, 64-bit single key vs two 32-bit keys
- [PostgreSQL Documentation §NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) + [stacksync.com payload limit deep-dive](https://www.stacksync.com/blog/beyond-listen-notify-postgres-request-reply-real-time-sync) — 8000-byte hard ceiling
- [Graphile-Worker — Recurring tasks (crontab)](https://worker.graphile.org/docs/cron) — cron format spec, 1-minute granularity floor, exponential backoff
- [Better Auth — Organization plugin docs](https://better-auth.com/docs/plugins/organization) — `getFullOrganization`, `addMember`, slug-based lookup, server-only APIs
- [ME (Pagar.me parent) Partner Webhooks](https://developer.me.com.br/en/guides/webhooks) — `X-ME-WEBHOOK-SIGNATURE` HMAC-SHA256 base64; retry policy (13 attempts / 7 days / 10s timeout); IP allowlist `164.152.52.63`
- [Pagar.me v5 PIX reference](https://docs.pagar.me/reference/pix-2) — `pix.expires_in` (seconds), `additional_information`, response shape with `qr_code` (copia-cola) + `qr_code_url`
- [Pagar.me v5 Boleto reference](https://docs.pagar.me/reference/boleto-1) — `boleto.due_at` (ISO 8601), `document_number` 16 chars, `instructions` 256 chars, `interest/fine/discount` PSP-only
- [Pagar.me v5 Cancel charge reference](https://docs.pagar.me/reference/cancelar-cobranca) — `DELETE /core/v5/charges/{id}` with optional `amount` body for partial refunds
- [Pagar.me v5 Webhook events list](https://docs.pagar.me/reference/eventos-de-webhook-1) — full enumeration including `charge.partial_canceled`, `charge.refunded`, `order.canceled`
- [Pagar.me Multimeios doc](https://docs.pagar.me/docs/multimeios) — supported combinations: 2x card OR card+boleto (NOT boleto+pix)
- [Pagar.me Chargeback status doc](https://docs.pagar.me/page/chargeback-novo-status-na-cobranca) — `chargedback` status, PSP-only, terminal state
- [Next.js 15 Streaming docs](https://nextjs.org/docs/app/guides/streaming) + [pedroalonso.net SSE production pattern](https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/) — ReadableStream + AbortSignal + heartbeat + X-Accel-Buffering

### Secondary (MEDIUM confidence — verified via reputable secondary source matching primary intent)

- [klapacz.dev — Solving Concurrency with Postgres Advisory Locks](https://klapacz.dev/blog/0001-solving-concurrency-issues-with-postgresql-advisory-locks/) — hashtext + bigint packing patterns
- [hookdeck.com — SHA256 webhook signature verification](https://hookdeck.com/webhooks/guides/how-to-implement-sha256-webhook-signature-verification) — `crypto.timingSafeEqual` pattern
- [Phase 1 RESEARCH §A8](file:.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md) — Pagar.me v5 Basic Auth pattern + belt-and-suspenders re-fetch defense (load-bearing for Phase 2 carryover)

### Tertiary (LOW confidence — single source, flagged for sandbox verification)

- CONTEXT.md D-13 `X-Hub-Signature` header name — flagged Q1
- CONTEXT.md D-04 `boleto.expires_in/business_days` + `pix_qrcode.enabled` — flagged Q2
- CONTEXT.md D-03 `interest_type: 'compound'` — flagged Q3
- CONTEXT.md D-08 cross-method refund (boleto paid → PIX refund) — flagged A11

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — reuse Phase 0/1 stack; only `jose` is new and well-known
- Advisory lock + outbox + SSE patterns: **HIGH** — Postgres + graphile-worker + Next.js 15 patterns are well-documented and verified in this session
- Better Auth org slug signup: **HIGH** — confirmed via official docs
- Konva `mode='buyer'` extension: **HIGH** — Phase 1 dashboard mode is the direct precedent; same pattern with one additional click filter
- Pagar.me v5 PIX + cancel/refund + webhook events: **HIGH** — primary docs verified
- Pagar.me v5 HMAC signature header name: **MEDIUM-LOW** — CONTEXT D-13 claim unverified in public docs; ME parent platform uses different name. **MUST verify in sandbox before flip.**
- Pagar.me v5 boleto+PIX hybrid: **LOW** — not documented as a Pagar.me product; CONTEXT D-04 assumption is wrong; alternative selection required
- Pagar.me v5 installments `interest_type`: **MEDIUM-LOW** — installments param exists; the `interest_type` configuration mechanism unverified
- Refund matrix (cross-method): **MEDIUM** — primary endpoint shape verified; cross-method capability is CONTEXT claim, not verified in docs
- Validation architecture: **HIGH** — testing pattern is direct extension of Phase 1
- Security threat model: **HIGH** — standard ASVS categories with stack-mapped controls

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (30 days for stable patterns; HMAC + boleto items should be verified in sandbox within 7 days of plan-phase kickoff to unblock implementation).

## RESEARCH COMPLETE
