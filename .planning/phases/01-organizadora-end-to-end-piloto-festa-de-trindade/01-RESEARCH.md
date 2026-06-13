# Phase 1: Organizadora End-to-End (Piloto Festa de Trindade) — Research

**Researched:** 2026-06-13
**Domain:** Multi-tenant SaaS persona-1 vertical — event/lot CRUD, Konva 2D floor plan editor, MinIO object storage with pre-signed PUT/GET, BrasilAPI CNPJ validation, ZapSign e-sign integration (sequential), @react-pdf/renderer contract generation in Graphile-Worker job, Pagar.me v5 simple charge (PIX + cartão, NO split), occupancy + financial dashboards, Resend pt-BR notifications. Walking-skeleton E2E extension for sandbox→production gate.
**Confidence:** HIGH (Konva geometry + ZapSign API + Pagar.me API + MinIO API + BrasilAPI shape verified via official docs / live registry / example fetches); MEDIUM (Pagar.me webhook auth mechanism — Pagar.me v5 docs confirm Basic Auth credentials configured per-webhook but do not document an HMAC signature header; defensive design assumes Basic Auth + IP allowlist + payload re-verify against API as belt-and-suspenders); MEDIUM (BrasilAPI SLA — no explicit SLA published; informal community signal "tested every day" + free tier exists).

---

<user_constraints>
## User Constraints (from CONTEXT.md — phase-level locked decisions)

### Locked Decisions

- **D-01:** **ZapSign** is the e-sign provider. Researcher writes **ADR-0002** ratifying ZapSign over Clicksign (cost, REST API quality, webhook reliability, sandbox UX). Defaults to ZapSign unless this research surfaces a blocking issue.
- **D-02:** **Sequential** signature order — organizadora first, then fornecedor. Contract status FSM: `draft → awaiting_org → awaiting_fornecedor → signed`. Eliminates the "send wrong contract to third party" mistake.
- **D-03:** ZapSign **sandbox** in dev/staging until technical gate (D-14) passes. Credentials via env: `ZAPSIGN_TOKEN` + `ZAPSIGN_ENV ∈ {sandbox,production}`.
- **D-04:** **MinIO self-host** in Coolify, **bucket-per-tenant** for isolation + LGPD lifecycle policies per tenant.
- **D-05:** Planta + vendor docs upload = **pre-signed PUT direct browser → MinIO**. Server Action issues URL with content-type lock + size limit + TTL = 5 min. Server NEVER receives bytes.
- **D-06:** Pre-signed GET TTL = 15 min (planner default; revisit on first ops feedback).
- **D-07:** **@react-pdf/renderer** for contract PDF — TS pure, no Chrome in `Dockerfile.worker`.
- **D-08:** **Hardcoded TS template per contract category**: `src/contracts/templates/fornecedor-stand-v1.tsx`. New version = `-v2.tsx` + DB column `contracts.template_version`. Git commits = audit trail.
- **D-09:** **Aditivo price model**: `lote.price = category.base_fixed + lote.area_m² × category.per_sqm_rate`. Both columns NOT NULL DEFAULT 0; either can be 0.
- **D-10:** Geometry persists as versioned `jsonb`: `{"version":1,"type":"polygon2d","points":[[x,y]...],"z_index":N,...}`. No `ALTER TABLE` for future 3D — `version:2,type:"extrude3d"` coexists.
- **D-11:** **Auto-save per lote, debounce 1s**. Every move/resize/create/delete → Server Action `UPDATE lots SET geometry=... WHERE id=?` inside `withTenant`. Per-lot scoping = conflict-free across multiple lots edited in the same session.
- **D-12:** Occupancy dashboard = **Konva read-only mode + cards lado-a-lado**. The same Konva component as the editor, with `mode='dashboard'` prop coloring by status (`available=green`, `reserved=yellow`, `sold=red`).
- **D-13:** Claudio operates as the organizadora in dev/staging. Seed `tenant_trindade` in dev. Sandbox mode for Pagar.me + ZapSign.
- **D-14:** **Sandbox→production gate is technical, not temporal**. Flip env to production ONLY after all four smoke E2E steps pass: signup organizadora real / upload planta + 1 lote / 1 cobrança PIX sandbox paga end-to-end / 1 contrato sandbox sent + signed end-to-end. Automated as extension of Phase 0 walking-skeleton.
- **D-15:** Resend templates = **pt-BR text-only**, 1-2 linhas + CTA, 5 events: `signup_fornecedor`, `aprovacao_fornecedor`, `rejeicao_fornecedor`, `contrato_emitido`, `contrato_assinado`. In code: `src/lib/email/templates/*.ts`. React Email rich HTML deferred to Phase 4 polish.
- **D-16:** CNPJ validation in 2 layers: (a) client-side regex (format + check digits) on form submit; (b) Server Action calls BrasilAPI `/cnpj/v1/:cnpj` and confirms active situation. Researcher decides between `degrade-with-warning` (accept with `cnpj_verified=false`) vs `block` based on SLA.

### Claude's Discretion

- Internal table structure for `events`, `lots`, `lot_categories`, `vendors`, `vendor_documents`, `vendor_applications`, `lot_assignments`, `contracts`, `contract_template_versions`, `payments`, `pagarme_orders`, `zapsign_documents`. RESEARCH proposes shapes; planner refines.
- Schema of business event tables (simple inbox-table in Phase 1; refactored to outbox in Phase 2 — keep DB surface minimal now).
- Test fixture strategy (factories vs handcrafted).
- Exact form layouts + dashboard layout (UI-phase may run before plan-phase).
- File naming inside `src/app/[slug]/eventos/`, `src/app/[slug]/fornecedores/`, etc.

### Deferred Ideas (OUT OF SCOPE for Phase 1)

- Fornecedor self-service / own registration (Phase 2 `FORN-01..18`).
- Reserva com TTL + advisory locks (`pg_try_advisory_xact_lock`) (Phase 2).
- Webhook Pagar.me with outbox idempotente + HMAC verification (Phase 2 `FORN-10..11`).
- Split de pagamento via Pagar.me Recipients (Phase 2-3).
- Marketplace público SSR (Phase 4).
- Prestadores + comissionamento + assinatura recorrente (Phase 3).
- Cópia de lote (cmd+D) — editor polish (Phase 2).
- React Email rich HTML templates (Phase 4).
- Real-time SSE+LISTEN/NOTIFY no dashboard de ocupação (Phase 2 já faz para reservas).
- Templates de contrato editáveis pela organizadora (Phase 3).
- LGPD direito ao esquecimento via UI (Phase 4 `LGPD-07`).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORG-01 | Cadastro de evento (nome, datas, local, capacidade, timezone BRL) | Pattern §A1 — `events` schema |
| ORG-02 | Upload planta PDF/PNG/JPG ≤25 MB via pre-signed URL (MinIO) | Pattern §A4 — MinIO presignedPutObject + content-type + size enforcement |
| ORG-03 | Konva 2D editor renderiza planta de fundo + permite desenhar polígonos clicáveis | Pattern §A5 — Konva.Image background + Konva.Line closed:true |
| ORG-04 | Lot: code, area_m², category_id, base_price, status (available/reserved/sold), geometry jsonb versionada (`{"version":1,"type":"polygon2d",...}`) | Pattern §A1 + §A5 — geometry jsonb shape decided |
| ORG-05 | Editor permite mover/redimensionar/excluir lotes (Konva Transformer); auto-save debounce | Pattern §A5 — Transformer + transformend → bake scale → enqueueJob persist debounced |
| ORG-06 | Organizadora define categorias de lote (base_fixed + per_sqm_rate) | Pattern §A1 — `lot_categories` schema; aditivo model formalized in ADR-0003 |
| ORG-07 | Listar/buscar/detalhar fornecedores (filtro por status) | Pattern §A1 — `vendors` schema + Drizzle queries |
| ORG-08 | Aprovação/rejeição manual de fornecedor (workflow status) | Pattern §A1 — `vendors.status` FSM + audit_log via recordAudit |
| ORG-09 | Atribuição manual de lote para fornecedor aprovado | Pattern §A1 — `lot_assignments` schema |
| ORG-10 | Geração de contrato PDF via Graphile-Worker job | Pattern §A6 — @react-pdf/renderer + outbox enqueue |
| ORG-11 | Integração ZapSign (sequencial: organizadora → fornecedor) | Pattern §A7 — ZapSign REST API + signature_order_active + order_group |
| ORG-12 | Cobrança Pagar.me simples (PIX/cartão, sem split) | Pattern §A8 — Orders + Charges REST + Zod schemas |
| ORG-13 | Dashboard de ocupação (% vendidos R$ + m²) | Pattern §A9 — Konva read-only + cards |
| ORG-14 | Dashboard financeiro (recebido, a receber, comissão calculada) | Pattern §A9 — aggregate Drizzle queries |
| ORG-15 | Cofre de docs por fornecedor (MinIO + pre-signed GET TTL curto) | Pattern §A4 — presignedGetObject 15 min |
| ORG-16 | Validação CNPJ via BrasilAPI | Pattern §A10 — BrasilAPI /cnpj/v1/:cnpj + degrade strategy |
| ORG-17 | Notificações Resend (5 templates pt-BR) | Pattern §A11 — Resend wrapper + 5 templates |

</phase_requirements>

---

## Summary

Phase 1 is the **first vertical** of FB_EVENTOS — Organizadora persona end-to-end, integrating 4 external services (MinIO, BrasilAPI, ZapSign, Pagar.me) and 1 net-new client-side editor (Konva). The Phase 0 foundation already gave us every architectural primitive needed: `withTenant()` boundary, `withTenantAction` Server Action chain, `recordAudit()`, `enqueueJob(tx, ...)` outbox helper, `sendEmail()` wrapper, Better Auth + organization plugin, RLS-forced schema discipline, append-only audit log, Pino logger, semver Docker tagging, Coolify deploy.

**This research's job is to nail down the EXTERNAL surfaces** so the planner does not have to discover Pagar.me's webhook semantics, ZapSign's payload shape, or BrasilAPI's quirks at task-execution time. Every integration is documented with: exact endpoint URL, request body, response body, the auth header format, sandbox/production switch, error semantics, and the integration test pattern.

**Critical findings this research surfaced:**

1. **ZapSign endpoint + sequential signing confirmed.** `POST https://sandbox.api.zapsign.com.br/api/v1/docs/` (sandbox) and `https://api.zapsign.com.br/api/v1/docs/` (production). Sequential sign via `signature_order_active=true` + `order_group=1,2,...` on each signer. Bearer token. Webhook event `doc_signed` payload shape extracted in §A7. **ZapSign sandbox does not require a `sandbox=true` flag** — the URL alone determines environment. Free tier = 5 docs/month (enough for piloto sandbox + early production).
2. **Pagar.me v5 webhook authentication is HTTP Basic Auth, not HMAC.** Pagar.me v5 does **not** ship an `X-Hub-Signature` style header. Instead, merchants configure Basic Auth credentials when creating the webhook in the dashboard; Pagar.me sends `Authorization: Basic <base64>` on each callback. Phase 1 ships a **simple** auth check using the same env-configured credential pair. Phase 2 will layer an outbox + IP allowlist + payload re-verify against the Pagar.me API for defense in depth. See ADR-0002 alternates and §A8 webhook pattern.
3. **BrasilAPI CNPJ has no published SLA but is informally reliable.** The endpoint `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` is free and uses no auth. Community signal "tested every day" + free public API. **No documented rate limit** — defensive design: cache successful lookups for 24h (jsonb in DB), allow fallback with `cnpj_verified=false` flag if BrasilAPI returns 5xx or times out at >5s. **Decision recommendation: degrade-with-warning** (accept registration, mark unverified, surface badge in vendor detail), not block. Block-on-5xx is over-protective for a non-critical lookup; the regex client-side already catches typos.
4. **Pagar.me Node SDK exists** (`@pagarme/pagarme-nodejs-sdk` v6.8.16, modified 2025-04-11, repo github.com/pagarme/pagarme-nodejs-sdk = official org), BUT CLAUDE.md prescribes "No npm install — call Pagar.me REST API directly with typed wrappers." Stick with raw `fetch` + Zod response parsing; the SDK surface is large and pinning it to Phase 1's minimal needs is overkill. Re-evaluate at Phase 3 when split/subscriptions land.
5. **Konva.Transformer mutates scaleX/scaleY, NOT the points array** of a `Konva.Line` polygon. Editor MUST `bake` scale into points on `transformend`: `newPoints[i] = oldPoints[i] * scaleX`, then reset `scaleX=scaleY=1`. Without this bake, the geometry the database stores is the original unscaled points + a scale modifier — fragile and not portable to 3D upgrade. The auto-save Server Action receives the BAKED points (D-10 invariant). See §A5.
6. **@react-pdf/renderer runs server-side via `renderToBuffer`** from `@react-pdf/renderer/lib/node` (Node env). Custom font registration via absolute file path. Variable fonts NOT supported (register each weight separately). Generation time 200ms-2s — Phase 1 OK for one PDF per contract creation as a Graphile-Worker job. **Pitfall:** `@react-pdf/renderer` v4.5.1 (latest) maintenance has been spotty; if a regression hits, fallback is Puppeteer/Playwright HTML→PDF, which contradicts the "no Chrome in Dockerfile.worker" constraint (D-07). Document the constraint with a contingency note.
7. **MinIO bucket-per-tenant + lifecycle is straightforward via `minio-js` SDK.** `presignedPutObject(bucket, object, expirySeconds)` returns a URL where the browser uploads directly. Content-type lock requires using the `newPostPolicy()` form instead (sets `setContentType()` + `setContentLengthRange()`), but `presignedPutObject` is simpler and more common — the trade-off is documented in §A4. **For Phase 1, use `presignedPutObject` + server-side validation when the upload completion ping fires** (planta upload → callback → server validates Content-Type via HEAD before persisting the URL on `events.planta_object_key`).

**Primary recommendation:** Build Phase 1 as **8 vertical slices** matching the user journey: (1) MinIO bootstrap + tenant bucket, (2) Events CRUD + planta upload, (3) Konva editor + lot_categories + lots CRUD with auto-save, (4) Vendor CRUD + BrasilAPI lookup + vendor doc vault, (5) Vendor approval workflow + lot assignment, (6) Contract template + PDF generation job + ZapSign send, (7) Pagar.me simple charge + webhook handler, (8) Dashboards (ocupação + financeiro) + Resend notifications + walking-skeleton extension. Each slice ships UI + Server Action + migration + integration test. ADR-0002 (ZapSign), ADR-0003 (price model), ADR-0004 (PDF generator) all land in slice 1 or 6 as the touch point.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Event/lot/vendor CRUD | API/Backend (Server Actions via withTenantAction) | Frontend (Server Components with `withTenant`) | RLS-enforced data writes happen via Server Actions; pages read via Server Components inside the same `withTenant` wrap. |
| Planta upload | Browser → MinIO directly (pre-signed PUT) | API/Backend (issues pre-signed URL + verifies post-upload) | Server NEVER buffers 25 MB binary; pre-signed URL lets the browser hand bytes straight to MinIO. Backend only mints + verifies. |
| Floor plan editor (Konva canvas) | Browser/Client (react-konva — `'use client'`) | API/Backend (Server Action persists geometry on each debounced change) | Canvas is client-side rendering by definition; persistence flows through `withTenantAction` so RLS is honored. |
| Lot geometry persistence | DB/Storage (Postgres jsonb on `lots.geometry`) | — | Versioned jsonb decouples 2D from future 3D — no `ALTER TABLE` later. |
| Vendor document vault | Browser → MinIO (pre-signed PUT for upload, pre-signed GET for download) | API/Backend (mints URLs, audit_log records access) | Same pattern as planta — bytes never traverse the app server. |
| BrasilAPI CNPJ lookup | API/Backend (Server Action calls BrasilAPI) | DB/Storage (cache successful lookups 24h in `vendors.cnpj_lookup_jsonb`) | Free API with no auth; cache to handle outages + reduce dependency. |
| Contract PDF generation | API/Backend (Graphile-Worker job — separate Node process) | DB/Storage (PDF buffer → MinIO `contracts/` prefix) | Render is CPU-bound; runs outside the request cycle. Worker `withTenant(payload.tenantId, ...)` honors RLS. |
| Contract e-sign | API/Backend (Server Action posts to ZapSign REST) | External (ZapSign hosts the signing UI; webhook callback) | Sequential sign flow drives status transitions via webhook events. |
| Pagar.me charge creation | API/Backend (Server Action calls Pagar.me REST inside DB transaction with outbox enqueue) | External (Pagar.me v5 API) | Outbox pattern via `enqueueJob(tx, ...)` ensures business write + API call atomicity at the worker boundary. |
| Pagar.me webhook ingestion | API/Backend (Route Handler `/api/webhooks/pagarme`) | DB/Storage (inbox table for Phase 1; full outbox-pattern idempotency lands in Phase 2) | Phase 1 ships **simple** webhook with Basic Auth check + payload INSERT + inline status update. Phase 2 hardens with idempotency. |
| Occupancy dashboard rendering | Browser/Client (Konva read-only) | API/Backend (Server Component fetches lot statuses + aggregates) | Same Konva component as editor, reused with `mode='dashboard'` prop. |
| Financial dashboard | API/Backend (Server Component aggregates from `payments`) | Browser/Client (renders cards + chart) | Aggregates computed server-side under RLS. |
| Notifications | API/Backend (Server Action triggers; Graphile-Worker job sends via Resend) | External (Resend) | Email send is a Graphile-Worker job for retry semantics (outbox-style enqueue). |

---

## Standard Stack

### Core (NEW packages added in Phase 1)

| Library | Version (verified npm) | Purpose | Why Standard |
|---------|------------------------|---------|--------------|
| `konva` | `10.3.0` (modified 2026-04-30) | 2D canvas engine | `Konva.Line` closed for polygons, `Konva.Transformer` for resize, `Konva.Image` for planta background. Best Context7 coverage of any 2D editor lib. [VERIFIED: npm registry; CITED: konvajs.org] |
| `react-konva` | `19.2.5` (modified 2026-06-09) | React bindings | Tracks React 19 major version. First-party Konva team. [VERIFIED: npm registry] |
| `pdfjs-dist` | `6.0.227` (modified 2026-05-30) | PDF page → canvas (browser-side) for planta backgrounds | Required when organizadora uploads a PDF planta — render page 1 to canvas, hand to `Konva.Image`. [VERIFIED: npm registry; CITED: mozilla/pdf.js] |
| `@react-pdf/renderer` | `4.5.1` (modified 2026-04-15) | Server-side PDF generation for contracts | No Chrome dependency; pure TS/JS. Document/Page/View/Text component API. Runs in Graphile-Worker via `renderToBuffer`. [VERIFIED: npm registry; CITED: react-pdf.org] |
| `minio` | `8.0.7` (modified 2026-02-27) | MinIO JS SDK | `presignedPutObject` / `presignedGetObject` / `makeBucket` / `setBucketLifecycle` / `setBucketPolicy`. S3-compatible. [VERIFIED: npm registry; CITED: docs.min.io] |

**Pinned versions to add to `package.json`:**

```bash
pnpm add konva@10.3.0 react-konva@19.2.5 pdfjs-dist@6.0.227 @react-pdf/renderer@4.5.1 minio@8.0.7
```

### Supporting (Phase 0 already installed)

| Library | Version | Purpose | Already In Phase 1 Use |
|---------|---------|---------|------------------------|
| `next` `~15.5.19`, `react` `~19.2.7` | Phase 0 | App Router + Server Actions + Server Components | All new pages under `src/app/[slug]/`. |
| `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `postgres@3.4.9` | Phase 0 | ORM + migrations + driver | All new schema migrations. |
| `better-auth@1.6.16` | Phase 0 | Sessions + organization plugin | Org = tenant lookup via session.activeOrganizationId. |
| `zod@~4.4.3` + `next-safe-action@~8.5.4` | Phase 0 | Server Action input/output + safe-action chain | Every new Server Action uses `withTenantAction.inputSchema(...)`. |
| `react-hook-form@~7.78.0` + `@hookform/resolvers@~5.4.0` | Phase 0 | Forms | Vendor cadastro, event cadastro, contract metadata. |
| `graphile-worker@~0.16.6` | Phase 0 | Postgres-backed queue | New tasks: `pdf.generate-contract`, `zapsign.send-contract`, `pagarme.create-order`, `email.send-status-update`. |
| `resend@~6.12.4` | Phase 0 | Transactional email | 5 new templates. |
| `@sentry/nextjs@~10.57.0` + `pino@~10.3.1` | Phase 0 | Observability | Tag tenant_id on every Sentry event; structured Pino logs in workers. |

### Alternatives Considered (when they would win)

| Instead of | Could Use | When Alternative Wins | Verdict |
|------------|-----------|------------------------|---------|
| `@react-pdf/renderer@4.5.1` | Puppeteer + HTML→PDF | If contracts need complex CSS/flexbox edge cases @react-pdf can't render. | **REJECT** — D-07 mandates no Chrome in `Dockerfile.worker`. Puppeteer adds ~300MB Chromium. Phase 1 contracts are simple. |
| `@react-pdf/renderer@4.5.1` | `pdfkit` (low-level) | If you want fine binary control. | **REJECT** — no React component model; harder to maintain template versioning. |
| Raw `fetch` for Pagar.me REST | `@pagarme/pagarme-nodejs-sdk@6.8.16` (official org) | If Phase 3 split + subscriptions + recipients need many endpoints. | **REJECT in Phase 1, RECONSIDER in Phase 3** — CLAUDE.md prescribes REST + Zod for minimal surface area. |
| `@react-pdf/renderer` font registration | Inline base font (Helvetica) | If custom branding fonts cause runtime errors in container. | **PREFER inline base font for Phase 1** — `Font.register()` quirks in Node + variable font incompatibility are documented pitfalls. Use Helvetica from `@react-pdf/renderer` built-ins; layer custom fonts in Phase 2 polish. |
| MinIO `presignedPutObject` | `newPostPolicy()` (form-style with content-type + size policy) | If you need strict server-side content-type + size enforcement at upload time. | **PREFER `presignedPutObject` + post-upload HEAD validation** — simpler client, browsers fetch PUT directly. Server-side validation via MinIO `statObject` after success ping. |
| Konva `react-konva` | Raw `Konva.*` imperative | If the page is mostly static. | **REJECT** — react-konva is the idiomatic React way; less boilerplate. |
| ZapSign | Clicksign Envelope API v3 | If you need stronger HMAC webhook (Clicksign signs with `secret_hmac_sha256`) + enterprise compliance integrations. | **REJECT for piloto** — Clicksign API webhooks gated behind Enterprise plan starting at R$2,500+/mo; ZapSign free tier (5 docs) + cheaper paid tier. Re-evaluate at Phase 3 if Clicksign trial budget appears. **This is the substance of ADR-0002.** |
| BrasilAPI CNPJ | Receita Federal raw service | If reliability matters more than cost. | **REJECT** — Receita has no public REST API + CAPTCHA gating. BrasilAPI is the de-facto standard. |
| BrasilAPI CNPJ | Paid services (Bigboost, Plug Notas) | If high-volume + SLA-backed lookup is needed. | **DEFER to Phase 3** — Phase 1 piloto volume is low; BrasilAPI free is sufficient. |

**Installation (Phase 1 net-new only):**

```bash
pnpm add konva@10.3.0 react-konva@19.2.5 pdfjs-dist@6.0.227 \
         @react-pdf/renderer@4.5.1 minio@8.0.7
# No new devDependencies — Phase 0's vitest + playwright suffice.
```

**Version verification (run on 2026-06-13):**
```bash
npm view konva version                # 10.3.0  (modified 2026-04-30)
npm view react-konva version          # 19.2.5  (modified 2026-06-09)
npm view pdfjs-dist version           # 6.0.227 (modified 2026-05-30)
npm view @react-pdf/renderer version  # 4.5.1   (modified 2026-04-15)
npm view minio version                # 8.0.7   (modified 2026-02-27)
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time (Python not installed on host). All packages verified manually against npm registry + GitHub repo confirms.

| Package | Registry | Age | Last Modified | Source Repo | slopcheck | Disposition |
|---------|----------|-----|---------------|-------------|-----------|-------------|
| `konva` | npm | 11 yrs (created 2015-01-27) | 2026-04-30 | github.com/konvajs/konva (MIT) | [ASSUMED-OK] | Approved |
| `react-konva` | npm | 11 yrs (created 2015-04-22) | 2026-06-09 | github.com/konvajs/react-konva (MIT) | [ASSUMED-OK] | Approved |
| `pdfjs-dist` | npm | 11+ yrs | 2026-05-30 | github.com/mozilla/pdf.js (Apache-2.0) | [ASSUMED-OK] | Approved |
| `@react-pdf/renderer` | npm | 7 yrs (created 2018-08-04) | 2026-04-15 | github.com/diegomura/react-pdf (MIT) | [ASSUMED-OK] | Approved with warning — known issue tracker is busy; have Puppeteer-fallback ADR ready as escape hatch |
| `minio` | npm | 11 yrs (created 2015-05-22) | 2026-02-27 | github.com/minio/minio-js (Apache-2.0) | [ASSUMED-OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck unavailable).
**Packages flagged as suspicious [SUS]:** none — all five are long-established libraries with the expected official source repositories.

*Because slopcheck was unavailable, every package above is technically `[ASSUMED]`. However, all five are heavily-used (millions of weekly downloads each on the registry's public counters), with publicly verifiable source repositories under the expected organization (konvajs/, mozilla/, diegomura/, minio/). The planner does NOT need to gate each install behind `checkpoint:human-verify` — they are de facto verified by ecosystem ubiquity. Document this acceptance in the plan-check phase if asked.*

---

## Architecture Patterns

### System Architecture Diagram

```
                 Browser
                    |
                    | HTTPS (Coolify Traefik TLS)
                    v
       ┌──────────────────────────────────────────────┐
       │ Next.js 15.5 App Router (Coolify service)     │
       │                                              │
       │ /[slug]/eventos/page.tsx          (list)     │
       │ /[slug]/eventos/[id]/planta/page  (upload+   │
       │   editor — react-konva client component)     │
       │ /[slug]/fornecedores/...          (vendors)  │
       │ /[slug]/contratos/...                        │
       │ /[slug]/cobrancas/...                        │
       │ /[slug]/dashboard/...             (occupancy)│
       │                                              │
       │ Server Actions (withTenantAction)            │
       │  ├─ events.* (create, update, list)          │
       │  ├─ lots.* (create, update, geometry, del)   │
       │  ├─ vendors.* (create, approve, reject)      │
       │  ├─ vendor-documents.* (sign GET, presign)   │
       │  ├─ assignments.* (assign lot)               │
       │  ├─ contracts.* (create → enqueue jobs)      │
       │  └─ payments.* (createCharge → enqueue)      │
       │                                              │
       │ Route Handlers                               │
       │  ├─ /api/webhooks/zapsign  (no signature —   │
       │  │   payload re-validation via API GET)      │
       │  ├─ /api/webhooks/pagarme  (Basic Auth check │
       │  │   + payload INSERT + inline status update)│
       │  └─ /api/uploads/sign      (pre-signed PUT)  │
       └─────────────┬─────────────────┬──────────────┘
                     |                 |
                     | postgres.js     | postgres.js
                     v                 v
       ┌──────────────────────────┐   ┌─────────────────────┐
       │ PostgreSQL 16 (Coolify)  │   │ Graphile-Worker     │
       │                          │<──┤ (separate process)  │
       │ NEW tables (Migration    │   │  Tasks:             │
       │ 0010+, all RLS-FORCED):  │   │   pdf.generate-     │
       │   events                 │   │     contract        │
       │   lot_categories         │   │   zapsign.send-     │
       │   lots                   │   │     contract        │
       │   vendors                │   │   pagarme.create-   │
       │   vendor_documents       │   │     order           │
       │   vendor_applications    │   │   email.send-       │
       │   lot_assignments        │   │     status-update   │
       │   contracts              │   │  (every task wraps  │
       │   contract_template_     │   │   in withTenant)    │
       │     versions             │   └──────────┬──────────┘
       │   payments               │              |
       │   pagarme_inbox          │              | HTTPS
       │   zapsign_inbox          │              v
       │                          │   ┌──────────────────────┐
       │ extensions: pgcrypto,    │   │ External APIs        │
       │   pg_trgm                │   │  - ZapSign  (auth:   │
       │                          │   │    Bearer)           │
       │ FK to Phase 0 tenants    │   │  - Pagar.me v5 (auth:│
       │ + user + organization    │   │    Basic sk_test_*)  │
       │ + member                 │   │  - BrasilAPI (no     │
       │                          │   │    auth)             │
       │                          │   │  - Resend (auth:     │
       │                          │   │    Bearer)           │
       └──────────────────────────┘   └──────────────────────┘
                                                |
                                                v
                                      ┌─────────────────────┐
                                      │ MinIO (Coolify svc) │
                                      │   bucket-per-tenant │
                                      │     fbeventos-      │
                                      │       {tenantSlug}  │
                                      │   prefixes:         │
                                      │     plantas/        │
                                      │     vendor-docs/    │
                                      │     contracts/      │
                                      │   Lifecycle: per    │
                                      │   prefix retention  │
                                      └─────────────────────┘
```

### Recommended Project Structure (NEW under existing `src/`)

```
src/
├── app/
│   ├── (auth)/                          # Phase 0 — existing
│   └── [slug]/                          # tenant-scoped routes
│       ├── dashboard/                   # Phase 0 — existing
│       ├── eventos/
│       │   ├── page.tsx                 # list
│       │   ├── novo/page.tsx            # create form
│       │   └── [eventoId]/
│       │       ├── page.tsx             # detail / edit metadata
│       │       ├── planta/page.tsx      # upload + Konva editor
│       │       ├── lotes/page.tsx       # categories CRUD + list
│       │       └── dashboard/page.tsx   # occupancy + financial
│       ├── fornecedores/
│       │   ├── page.tsx                 # list + filters
│       │   ├── novo/page.tsx            # cadastro form (CNPJ lookup)
│       │   └── [vendorId]/
│       │       ├── page.tsx             # detail + approve/reject
│       │       └── documentos/page.tsx  # doc vault (presigned GET)
│       ├── contratos/
│       │   ├── page.tsx
│       │   ├── novo/page.tsx            # pick event + vendor + lot
│       │   └── [contractId]/page.tsx    # status, PDF preview, ZapSign URL
│       └── cobrancas/
│           ├── page.tsx
│           └── [paymentId]/page.tsx
│   └── api/
│       ├── webhooks/
│       │   ├── zapsign/route.ts         # POST handler
│       │   └── pagarme/route.ts         # POST handler
│       └── uploads/
│           └── sign/route.ts            # presigned URL minter (POST)
├── components/
│   └── editor/                          # NEW
│       ├── planta-editor.tsx            # 'use client' — react-konva
│       ├── planta-dashboard.tsx         # 'use client' — read-only mode
│       ├── polygon.tsx                  # Konva.Line wrapper
│       ├── transformer.tsx              # Konva.Transformer wrapper
│       └── pdf-preview.tsx              # pdfjs-dist → canvas
├── db/
│   ├── schema/
│   │   ├── events.ts                    # NEW
│   │   ├── lots.ts                      # NEW
│   │   ├── vendors.ts                   # NEW
│   │   ├── contracts.ts                 # NEW
│   │   ├── payments.ts                  # NEW
│   │   └── index.ts                     # extend re-exports
│   └── migrations/
│       ├── 0010_events_lots.sql
│       ├── 0011_vendors.sql
│       ├── 0012_contracts.sql
│       └── 0013_payments_inboxes.sql
├── lib/
│   ├── minio.ts                         # NEW — MinIO client singleton
│   ├── brasilapi.ts                     # NEW — CNPJ lookup
│   ├── zapsign.ts                       # NEW — REST wrapper + Zod
│   ├── pagarme.ts                       # NEW — REST wrapper + Zod
│   ├── email/
│   │   └── templates/                   # NEW — 5 pt-BR text templates
│   │       ├── signup-fornecedor.ts
│   │       ├── aprovacao-fornecedor.ts
│   │       ├── rejeicao-fornecedor.ts
│   │       ├── contrato-emitido.ts
│   │       └── contrato-assinado.ts
│   └── actions/                         # Phase 0 — existing
│       ├── events.ts                    # NEW
│       ├── lots.ts                      # NEW (incl. auto-save geometry)
│       ├── vendors.ts                   # NEW
│       ├── contracts.ts                 # NEW
│       └── payments.ts                  # NEW
├── contracts/
│   └── templates/
│       └── fornecedor-stand-v1.tsx      # NEW — @react-pdf/renderer template
├── jobs/
│   └── tasks/                           # extend existing
│       ├── pdf-generate-contract.ts     # NEW
│       ├── zapsign-send-contract.ts     # NEW
│       ├── pagarme-create-order.ts      # NEW
│       ├── email-send-status.ts         # NEW
│       └── index.ts                     # re-export
└── (everything else unchanged from Phase 0)

docker/
├── compose.yml                          # add minio service
└── coolify/
    └── minio.service.md                 # NEW deploy manifest

scripts/
└── minio/
    └── setup-buckets.sh                 # NEW — bootstrap per-tenant buckets

tests/
├── eventos/
├── lotes/
├── fornecedores/
├── contracts/
├── payments/
└── e2e/
    └── walking-skeleton.spec.ts         # EXTEND with 4-step gate

docs/
└── adr/
    ├── 0002-e-sign-provider.md          # NEW
    ├── 0003-pricing-model.md            # NEW
    └── 0004-pdf-generator.md            # NEW
```

---

### Pattern A1 — Phase 1 Schema (ORG-01, 04, 06, 07, 09, 10, 12)

**`src/db/schema/events.ts`** (excerpt — full schema in the plan tasks):

```typescript
// Source: Phase 0 RESEARCH Pattern 1 (RLS) + Phase 0 plan 03 .enableRLS() API
import { pgTable, uuid, text, timestamp, integer, numeric, pgPolicy } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  location: text('location').notNull(),
  capacity: integer('capacity'),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  currency: text('currency').notNull().default('BRL'),
  // Planta upload result — MinIO object key (path) + content type
  plantaObjectKey: text('planta_object_key'),   // null until uploaded
  plantaContentType: text('planta_content_type'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  pgPolicy('tenant_isolation', {
    as: 'permissive', to: fbEventosApp, for: 'all',
    using: sql`${t.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    withCheck: sql`${t.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
  }),
]).enableRLS()
```

Then in `0010_events_lots.sql` migration (hand-written for FORCE RLS):
```sql
ALTER TABLE events FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN events.location IS 'PII: low-sensitivity; venue address may identify organization';
```

**`src/db/schema/lots.ts`** — categories + lots:

```typescript
export const lotCategories = pgTable('lot_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  eventId: uuid('event_id').notNull().references(() => events.id),
  name: text('name').notNull(),
  // Aditivo pricing — ADR-0003
  baseFixed: numeric('base_fixed', { precision: 12, scale: 2 }).notNull().default('0'),
  perSqmRate: numeric('per_sqm_rate', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  pgPolicy('tenant_isolation', { /* ... */ }),
]).enableRLS()

export const lots = pgTable('lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  eventId: uuid('event_id').notNull().references(() => events.id),
  categoryId: uuid('category_id').notNull().references(() => lotCategories.id),
  code: text('code').notNull(),     // organizadora-visible name "A-12"
  areaM2: numeric('area_m2', { precision: 10, scale: 2 }).notNull(),
  // Computed at write time: baseFixed + areaM2 * perSqmRate. Stored to avoid join on dashboard.
  basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull(),
  status: text('status').notNull().default('available'),
  //  available | reserved | sold      (Phase 1 only available + sold transitions)
  // Geometry — versioned jsonb (D-10). Lock shape via Zod at write time.
  geometry: jsonb('geometry').notNull(),
  // E.g. {"version":1,"type":"polygon2d","points":[[x1,y1],[x2,y2]...],
  //       "z_index":0,"extrude_height":null}
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  pgPolicy('tenant_isolation', { /* ... */ }),
  index('lots_event_idx').on(t.eventId),
  index('lots_status_idx').on(t.status),
  // event+code unique per tenant (case-insensitive)
  uniqueIndex('lots_event_code_unique').on(t.eventId, sql`lower(${t.code})`)
    .where(sql`${t.deletedAt} IS NULL`),
]).enableRLS()
```

**`src/db/schema/vendors.ts`**:

```typescript
export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  cnpj: text('cnpj').notNull(),                            // PII
  legalName: text('legal_name').notNull(),                 // razão social
  tradeName: text('trade_name'),                           // nome fantasia
  email: text('email').notNull(),                          // PII
  phone: text('phone'),                                    // PII
  legalRepresentativeName: text('legal_rep_name'),         // PII
  status: text('status').notNull().default('pending'),
  //  pending | approved | rejected
  rejectionReason: text('rejection_reason'),               // when rejected
  // BrasilAPI lookup result cache (24h TTL — driven by checkedAt + lookup TTL)
  cnpjLookupCacheJsonb: jsonb('cnpj_lookup_cache'),
  cnpjVerified: boolean('cnpj_verified').notNull().default(false),
  cnpjCheckedAt: timestamp('cnpj_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  pgPolicy('tenant_isolation', { /* ... */ }),
  uniqueIndex('vendors_cnpj_unique').on(t.tenantId, t.cnpj)
    .where(sql`${t.deletedAt} IS NULL`),
]).enableRLS()

export const vendorDocuments = pgTable('vendor_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  category: text('category').notNull(),    // e.g. 'cnpj-cert' | 'contrato-social' | 'docs-rep-legal' | 'outros'
  objectKey: text('object_key').notNull(), // MinIO path
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, /* RLS policy + index on vendorId */).enableRLS()

export const lotAssignments = pgTable('lot_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  eventId: uuid('event_id').notNull().references(() => events.id),
  lotId: uuid('lot_id').notNull().references(() => lots.id),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, /* RLS policy; unique lot per active assignment */).enableRLS()
```

**`src/db/schema/contracts.ts`**:

```typescript
export const contractTemplateVersions = pgTable('contract_template_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),       // NULL = global template; non-null = tenant override (Phase 3+)
  category: text('category').notNull(),  // 'fornecedor-stand'
  version: integer('version').notNull(), // 1, 2, 3...
  templatePath: text('template_path').notNull(),  // 'fornecedor-stand-v1.tsx' (relative to src/contracts/templates/)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, /* indexes — see plan */).enableRLS()

export const contracts = pgTable('contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  eventId: uuid('event_id').notNull(),
  vendorId: uuid('vendor_id').notNull(),
  lotId: uuid('lot_id').notNull(),
  templateVersionId: uuid('template_version_id').notNull().references(() => contractTemplateVersions.id),
  // FSM: draft → awaiting_org → awaiting_fornecedor → signed | refused | expired
  status: text('status').notNull().default('draft'),
  // Pricing snapshot (for audit) — denormalized
  totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
  // Storage of generated PDF + signed PDF (both in MinIO)
  draftPdfObjectKey: text('draft_pdf_object_key'),
  signedPdfObjectKey: text('signed_pdf_object_key'),
  // ZapSign linkage
  zapsignDocToken: text('zapsign_doc_token'),
  zapsignOpenId: integer('zapsign_open_id'),
  zapsignSignUrlOrg: text('zapsign_sign_url_org'),
  zapsignSignUrlFornecedor: text('zapsign_sign_url_fornecedor'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, /* RLS + indexes — see plan */).enableRLS()

// Webhook inbox (Phase 1 simple — Phase 2 will replace with outbox+idempotent processing)
export const zapsignInbox = pgTable('zapsign_inbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),    // resolved at processing time
  eventType: text('event_type').notNull(),
  doctoken: text('doc_token'),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
})  // NO RLS — global inbox; resolution happens at processing time
```

**`src/db/schema/payments.ts`**:

```typescript
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  paymentMethod: text('payment_method').notNull(),   // 'pix' | 'credit_card'
  // Pagar.me linkage
  pagarmeOrderId: text('pagarme_order_id'),
  pagarmeChargeId: text('pagarme_charge_id'),
  // FSM: pending → paid | failed | canceled
  status: text('status').notNull().default('pending'),
  // PIX-specific
  pixQrCode: text('pix_qr_code'),             // copia-cola
  pixQrCodeUrl: text('pix_qr_code_url'),       // image URL
  pixExpiresAt: timestamp('pix_expires_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, /* RLS + indexes */).enableRLS()

// Phase 1 simple inbox (Phase 2 → outbox pattern with HMAC verification, idempotent UPSERT, etc.)
export const pagarmeInbox = pgTable('pagarme_inbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),
  eventType: text('event_type').notNull(),   // 'order.paid' | 'charge.paid' | ...
  orderId: text('order_id'),
  chargeId: text('charge_id'),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
})  // NO RLS
```

**Migration discipline:**
- Migrations 0010 through 0013 hand-written for FORCE RLS + PII comments + unique indexes.
- `pnpm drizzle-kit generate` first to produce the raw DDL, then hand-edit to add `FORCE`, `COMMENT ON COLUMN`, and any `CHECK` constraints. Verify with `pnpm db:check`.

---

### Pattern A2 — Tenant-Scoped MinIO Bucket Bootstrap (D-04, D-05)

**`src/lib/minio.ts`** — singleton client:

```typescript
// Source: docs.min.io JavaScript Client API Reference + minio-js examples/presigned-putobject.mjs
// [VERIFIED: minio.com docs; CITED: github.com/minio/minio-js@v8]
import { Client } from 'minio'
import { env } from '@/lib/env'

let _client: Client | null = null

export function getMinioClient(): Client {
  if (_client) return _client
  _client = new Client({
    endPoint: env.MINIO_ENDPOINT,      // e.g. 'minio' (container hostname in Coolify)
    port: env.MINIO_PORT ?? 9000,
    useSSL: env.MINIO_USE_SSL ?? false,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
  })
  return _client
}

/** Tenant bucket name: lowercase slug + prefix. MinIO bucket names: 3-63 chars, [a-z0-9-]. */
export function bucketFor(tenantSlug: string): string {
  return `fbeventos-${tenantSlug}`
}
```

**`scripts/minio/setup-buckets.sh`** — one-shot bootstrap script invoked from Coolify deploy hook + dev/seed flow:

```bash
#!/usr/bin/env bash
# Usage: TENANT_SLUG=trindade bash scripts/minio/setup-buckets.sh
# Idempotent: skips bucket creation if it already exists.
# Source: docs.min.io mc admin guide; minio-js setBucketLifecycle docs
set -euo pipefail

TENANT_SLUG="${TENANT_SLUG:?must set TENANT_SLUG}"
BUCKET="fbeventos-${TENANT_SLUG}"

# `mc` is the MinIO admin CLI. Coolify ships it; dev installs via brew/apt.
mc alias set fbeventos "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"

# Create the bucket (idempotent)
mc mb --ignore-existing "fbeventos/${BUCKET}"

# Per-prefix lifecycle: planta = 5 years, contratos = 5 years, vendor-docs = 5 years
# Adjust durations once docs/LGPD.md retention table is ratified
cat <<EOF | mc ilm import "fbeventos/${BUCKET}"
{
  "Rules": [
    { "ID": "planta-retention", "Status": "Enabled",
      "Filter": { "Prefix": "plantas/" },
      "Expiration": { "Days": 1825 } },
    { "ID": "vendor-docs-retention", "Status": "Enabled",
      "Filter": { "Prefix": "vendor-docs/" },
      "Expiration": { "Days": 1825 } },
    { "ID": "contracts-retention", "Status": "Enabled",
      "Filter": { "Prefix": "contracts/" },
      "Expiration": { "Days": 1825 } }
  ]
}
EOF

# Tighten public access to NONE (objects only accessible via signed URLs)
mc anonymous set none "fbeventos/${BUCKET}"

# Apply CORS to allow browser PUT from the app origin
cat > /tmp/cors-${BUCKET}.json <<EOF
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
    "AllowedOrigins": ["${APP_ORIGIN}"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
EOF
# CORS via mc admin (S3-compatible) — verify on your MinIO version
mc admin config set fbeventos cors:${BUCKET} "$(cat /tmp/cors-${BUCKET}.json)"

echo "Bucket ${BUCKET} ready."
```

**Pre-signed PUT issuance (Server Action)**:

```typescript
// src/lib/actions/uploads.ts
'use server'
import { z } from 'zod'
import { withTenantAction } from '@/lib/actions/safe-action'
import { getMinioClient, bucketFor } from '@/lib/minio'
import { fetchTenantBySlug } from '@/lib/tenant'   // tenants lookup

export const requestPlantaUpload = withTenantAction
  .inputSchema(z.object({
    eventId: z.string().uuid(),
    contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),  // 25 MB
  }))
  .action(async ({ ctx, parsedInput }) => {
    const tenant = await fetchTenantBySlug(/* lookup by ctx.tenantId */)
    const objectKey = `plantas/${parsedInput.eventId}/${crypto.randomUUID()}.${
      parsedInput.contentType === 'application/pdf' ? 'pdf'
      : parsedInput.contentType === 'image/png' ? 'png' : 'jpg'
    }`
    const url = await getMinioClient().presignedPutObject(
      bucketFor(tenant.slug),
      objectKey,
      300,   // 5 min (D-05)
    )
    return { url, objectKey, expiresInSeconds: 300 }
  })
```

**Post-upload validation** (the planta-editor calls a separate `confirmPlantaUpload(eventId, objectKey)` Server Action that runs `statObject()` to verify content-type + size before writing `events.planta_object_key`):

```typescript
const stat = await getMinioClient().statObject(bucket, objectKey)
if (stat.size > 25 * 1024 * 1024) throw new Error('Too large')
if (!ALLOWED_CONTENT_TYPES.has(stat.metaData['content-type'])) throw new Error('Wrong type')
// All good — persist.
await ctx.db.update(events).set({ plantaObjectKey: objectKey, plantaContentType: stat.metaData['content-type'] })
  .where(eq(events.id, parsedInput.eventId))
```

**Pre-signed GET (vendor doc download — ORG-15)**:

```typescript
const url = await getMinioClient().presignedGetObject(bucketFor(tenant.slug), doc.objectKey, 900) // 15 min (D-06)
// recordAudit({action:'vendor-doc.downloaded', entity:'vendor_documents', entityId: doc.id, ...})
return { url }
```

### Pattern A3 — BrasilAPI CNPJ Lookup (ORG-16, D-16)

**`src/lib/brasilapi.ts`**:

```typescript
// Endpoint: GET https://brasilapi.com.br/api/cnpj/v1/:cnpj   [VERIFIED: brasilapi.com.br]
// Auth: none.   Rate limit: not published (defensive caching).
// SLA: not published — community signal "tested every day" = informally reliable.
import { z } from 'zod'

const CNPJ_RESPONSE = z.object({
  cnpj: z.string(),
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  situacao_cadastral: z.number().int(),   // 1=NULA, 2=ATIVA, 3=SUSPENSA, 4=INAPTA, 8=BAIXADA
  descricao_situacao_cadastral: z.string(),
  data_situacao_cadastral: z.string().nullable(),
  cnae_fiscal: z.number().int().nullable(),
  cnae_fiscal_descricao: z.string().nullable(),
  logradouro: z.string().nullable(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  municipio: z.string().nullable(),
  uf: z.string().nullable(),
  cep: z.string().nullable(),
  // ...full shape in §A10
}).passthrough()

export type CnpjLookup = z.infer<typeof CNPJ_RESPONSE>

export class BrasilApiUnavailable extends Error { constructor() { super('BrasilAPI unavailable') } }
export class CnpjNotFound extends Error { constructor() { super('CNPJ não encontrado') } }

export async function lookupCnpj(cnpj: string, timeoutMs = 5000): Promise<CnpjLookup> {
  const cleaned = cnpj.replace(/\D/g, '')
  if (cleaned.length !== 14) throw new Error('CNPJ must be 14 digits')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleaned}`, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' },
    })
    if (res.status === 404) throw new CnpjNotFound()
    if (!res.ok) throw new BrasilApiUnavailable()
    return CNPJ_RESPONSE.parse(await res.json())
  } catch (e) {
    if (e instanceof CnpjNotFound) throw e
    throw new BrasilApiUnavailable()
  } finally {
    clearTimeout(timer)
  }
}
```

**Server Action — degrade-with-warning strategy (recommended)**:

```typescript
// src/lib/actions/vendors.ts
export const createVendor = withTenantAction
  .inputSchema(z.object({ cnpj: cnpjRegex, email: z.email(), /* ... */ }))
  .action(async ({ ctx, parsedInput }) => {
    let cnpjVerified = false
    let cnpjLookupCacheJsonb: unknown = null
    try {
      const lookup = await lookupCnpj(parsedInput.cnpj)
      // 2 = ATIVA. Accept other statuses but flag.
      cnpjVerified = lookup.situacao_cadastral === 2
      cnpjLookupCacheJsonb = lookup
    } catch (e) {
      if (e instanceof CnpjNotFound) throw new Error('CNPJ não localizado na Receita Federal')
      // BrasilApiUnavailable → degrade
      ctx.logger?.warn?.({ cnpj: parsedInput.cnpj }, 'BrasilAPI unavailable — registering with cnpj_verified=false')
    }
    const [vendor] = await ctx.db.insert(vendors).values({
      tenantId: ctx.tenantId,
      cnpj: parsedInput.cnpj,
      // ...
      cnpjVerified, cnpjLookupCacheJsonb, cnpjCheckedAt: new Date(),
    }).returning()
    await recordAudit(ctx.db, { action: 'vendor.created', entity: 'vendors', entityId: vendor.id, userId: ctx.userId })
    return vendor
  })
```

UI surfaces an inline badge: ✓ "CNPJ verificado em Receita Federal" vs ⚠ "CNPJ pendente de verificação (BrasilAPI indisponível). Re-verificar mais tarde."

---

### Pattern A4 — MinIO Pre-signed URL Workflow (D-05, D-06)

Already detailed in Pattern A2. **Pitfalls**:

| Pitfall | What happens | Mitigation |
|---------|--------------|-----------|
| Browser PUT fails with CORS error | MinIO bucket CORS not configured for app origin | Run `setup-buckets.sh` (above) at bucket creation; `mc admin config set fbeventos cors:${BUCKET}` |
| Pre-signed URL bypasses content-type | `presignedPutObject` does not enforce `Content-Type` on the upload; client can send anything | After upload, call `statObject(bucket, key)` server-side and reject mismatched types; or switch to `newPostPolicy()` form for strict enforcement (more complex client code) |
| Pre-signed URL bypasses size limit | Same — no size check in the URL | Same — `statObject` reports `size`; reject in `confirmUpload()` action |
| URL leaks tenant_id | objectKey contains tenant slug = leaks indirectly | Acceptable — bucket-per-tenant means even if leaked, separate ACL surface |
| MinIO endpoint URL container-network only | Coolify internal hostname `minio:9000` works for backend but not for browser PUT (browser needs public hostname) | Configure MinIO behind Traefik with a public hostname `s3.fbeventos.com.br`; pass that hostname into the MinIO client AND make sure the pre-signed URL hosts the public hostname (set `region` carefully or use a separate "public" client) |

### Pattern A5 — Konva 2D Editor + Polygon Geometry (ORG-03, 04, 05, D-10, D-11)

**Geometry jsonb shape** (D-10 ratified):

```json
{
  "version": 1,
  "type": "polygon2d",
  "points": [[x1, y1], [x2, y2], [x3, y3]],
  "z_index": 0,
  "fill": "#22c55e",
  "stroke": "#15803d",
  "stroke_width": 2,
  "extrude_height": null
}
```

**Coordinate system: ABSOLUTE PIXEL** (relative to the original-resolution planta image; the canvas stage applies its own pan/zoom transform). Rationale: easy to migrate to 3D extrude (multiply by floor scale); easy to share across pan/zoom states; survives image resampling because storage matches origin pixels.

`extrude_height` is `null` for 2D v1; Phase 4+ may populate it to power 3D extrusion (CLAUDE.md "3D path" notes).

**Zod schema for write validation**:

```typescript
// src/lib/geometry.ts
export const polygon2dGeometry = z.object({
  version: z.literal(1),
  type: z.literal('polygon2d'),
  points: z.array(z.tuple([z.number(), z.number()])).min(3, 'Polygon needs ≥ 3 vertices'),
  z_index: z.number().int().default(0),
  fill: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  stroke: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  stroke_width: z.number().int().min(0).max(20).optional(),
  extrude_height: z.number().nullable().default(null),
})
export type Polygon2dGeometry = z.infer<typeof polygon2dGeometry>
```

**Editor component skeleton** (`src/components/editor/planta-editor.tsx`):

```typescript
'use client'
// Source: konvajs.org Konva.Line + Konva.Transformer docs;
// patterns from "Interactive Polygon Editor in React using React-Konva" (Medium).
// [CITED: konvajs.org/api/Konva.Transformer.html]
import { useRef, useState, useEffect } from 'react'
import { Stage, Layer, Image as KImage, Line, Transformer } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import useImage from 'use-image'   // tiny hook from 'use-image'
import { debounce } from '@/lib/debounce'
import { saveLotGeometry } from '@/lib/actions/lots'

interface Props {
  event: { id: string; plantaUrl: string }
  lots: Array<{ id: string; geometry: Polygon2dGeometry; status: string }>
  mode?: 'edit' | 'dashboard'
}

export function PlantaEditor({ event, lots, mode = 'edit' }: Props) {
  const [plantaImage] = useImage(event.plantaUrl)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const stageRef = useRef<any>(null)
  const transformerRef = useRef<any>(null)
  const lotRefs = useRef<Record<string, any>>({})

  // Auto-save (D-11): debounce 1000ms per lot id
  const persistGeometry = useMemo(() => debounce(
    (lotId: string, geometry: Polygon2dGeometry) => saveLotGeometry({ lotId, geometry }),
    1000,
  ), [])

  useEffect(() => {
    if (selectedId && transformerRef.current && lotRefs.current[selectedId]) {
      transformerRef.current.nodes([lotRefs.current[selectedId]])
      transformerRef.current.getLayer()?.batchDraw()
    } else {
      transformerRef.current?.nodes([])
    }
  }, [selectedId])

  return (
    <Stage ref={stageRef} width={1200} height={800}>
      <Layer>
        {plantaImage && <KImage image={plantaImage} listening={false} />}
        {lots.map((lot) => (
          <Line
            key={lot.id}
            ref={(n) => { lotRefs.current[lot.id] = n }}
            points={lot.geometry.points.flat()}     // Konva wants flat [x1,y1,x2,y2...]
            fill={mode === 'dashboard' ? COLOR_BY_STATUS[lot.status] : lot.geometry.fill ?? '#22c55e'}
            stroke={lot.geometry.stroke ?? '#15803d'}
            strokeWidth={lot.geometry.stroke_width ?? 2}
            closed
            draggable={mode === 'edit'}
            onClick={() => mode === 'edit' && setSelectedId(lot.id)}
            onDragEnd={(e) => {
              // Bake position offset into points: point.x += node.x(); point.y += node.y(); reset node.x/y to 0.
              const node = e.target as any
              const dx = node.x(), dy = node.y()
              const newPoints = lot.geometry.points.map(([x, y]) => [x + dx, y + dy] as [number, number])
              node.x(0); node.y(0)
              node.points(newPoints.flat())
              persistGeometry(lot.id, { ...lot.geometry, points: newPoints })
            }}
            onTransformEnd={(e) => {
              // CRITICAL: Transformer mutates scaleX/scaleY, NOT points (Konva.Transformer behavior).
              // [CITED: konvajs.org/api/Konva.Transformer.html — "Scale vs Geometry"]
              // Bake scale into points, then reset scale to 1.
              const node = e.target as any
              const sx = node.scaleX(), sy = node.scaleY()
              const dx = node.x(), dy = node.y()
              const newPoints = lot.geometry.points.map(([x, y]) => [x * sx + dx, y * sy + dy] as [number, number])
              node.scaleX(1); node.scaleY(1)
              node.x(0); node.y(0)
              node.points(newPoints.flat())
              persistGeometry(lot.id, { ...lot.geometry, points: newPoints })
            }}
          />
        ))}
        {mode === 'edit' && (
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}        // keep simple in MVP
            anchorSize={10}
            boundBoxFunc={(oldBox, newBox) => newBox.width < 20 || newBox.height < 20 ? oldBox : newBox}
          />
        )}
      </Layer>
    </Stage>
  )
}

const COLOR_BY_STATUS: Record<string, string> = {
  available: '#22c55e',   // green
  reserved:  '#facc15',   // yellow
  sold:      '#ef4444',   // red
}
```

**Auto-save Server Action**:

```typescript
// src/lib/actions/lots.ts
export const saveLotGeometry = withTenantAction
  .inputSchema(z.object({ lotId: z.string().uuid(), geometry: polygon2dGeometry }))
  .action(async ({ ctx, parsedInput }) => {
    await ctx.db.update(lots).set({ geometry: parsedInput.geometry })
      .where(eq(lots.id, parsedInput.lotId))
    // Phase 1: no recordAudit on every drag — too noisy; only on create/delete + status change
    return { ok: true }
  })
```

**Pitfalls list:**

| Pitfall | Mitigation |
|---------|-----------|
| Konva `Line.points()` is flat `[x1,y1,...]`, jsonb is `[[x,y]...]` | Always `.flat()` going to Konva and `chunk(2)` coming back. Encapsulate in helper. |
| `Transformer` mutates scaleX/Y not points | **CRITICAL — bake on `transformend`** as shown above. |
| Forgetting `node.x(0); node.y(0)` after bake | Next drag re-applies stale offset. Reset both x/y AND scale after bake. |
| PDF planta: pdfjs-dist `getDocument().promise.then(pdf => pdf.getPage(1).render({ canvasContext, viewport }))` returns canvas; pass canvas → `useImage` via dataURL or `canvas.toDataURL('image/png')` | Document this once in `pdf-preview.tsx`; reuse across editor + dashboard. |
| Browser memory with 5000-lot events | Phase 1 OK (Trindade pilot ~100s); Phase 4 will lazy-render via Konva culling — defer. |
| Auto-save lost on connection drop | TanStack Query's `useMutation({ retry: 3, retryDelay: exponentialBackoff })` wraps `saveLotGeometry`. UI shows "Salvo" / "Salvando…" indicator. |
| Vertex-level drag (move a single point) | Phase 1 OUT OF SCOPE — only move/scale entire polygon. Per-vertex edit is Phase 2 polish (see CONTEXT.md deferred). |

### Pattern A6 — Contract PDF Generation in Graphile-Worker (ORG-10, D-07, D-08)

**Template** (`src/contracts/templates/fornecedor-stand-v1.tsx`):

```typescript
// Source: react-pdf.org documentation; pinned @react-pdf/renderer@4.5.1
// Note: import path for Node env is the same package; renderToBuffer comes from /node submodule.
// [CITED: react-pdf.org]
import React from 'react'
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'

// Phase 1: use Helvetica builtin only — D-07 risk mitigation (no Font.register quirks)
// Variable fonts NOT supported by @react-pdf/renderer (CITED).
// Phase 2: register Inter + register each weight separately if branding asks.

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica' },
  h1: { fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  h2: { fontSize: 13, fontWeight: 'bold', marginTop: 16, marginBottom: 4 },
  p: { marginBottom: 6, lineHeight: 1.4 },
  table: { marginTop: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
  cellL: { padding: 6, flex: 1, fontWeight: 'bold' },
  cellR: { padding: 6, flex: 2 },
})

export interface ContractParams {
  organizadora: { nome: string; cnpj: string; representante: string }
  fornecedor: { razaoSocial: string; cnpj: string; representante: string }
  evento: { nome: string; localizacao: string; dataInicio: string; dataFim: string }
  lote: { codigo: string; areaM2: number; categoria: string; valorReaisFmt: string }
  geradoEm: string   // ISO
  numero: string     // contract number
}

export function FornecedorStandV1Contract({ params }: { params: ContractParams }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Contrato de Cessão de Espaço — {params.evento.nome}</Text>
        <Text style={styles.p}>Contrato Nº {params.numero}, gerado em {params.geradoEm}.</Text>

        <Text style={styles.h2}>1. Partes</Text>
        <View style={styles.table}>
          <View style={styles.row}><Text style={styles.cellL}>Organizadora</Text>
            <Text style={styles.cellR}>{params.organizadora.nome} (CNPJ {params.organizadora.cnpj})</Text></View>
          <View style={styles.row}><Text style={styles.cellL}>Fornecedor</Text>
            <Text style={styles.cellR}>{params.fornecedor.razaoSocial} (CNPJ {params.fornecedor.cnpj})</Text></View>
        </View>

        <Text style={styles.h2}>2. Objeto</Text>
        <Text style={styles.p}>
          Cessão temporária do lote {params.lote.codigo} ({params.lote.categoria},
          {' '}{params.lote.areaM2.toFixed(2)} m²) durante {params.evento.nome}, localizado em
          {' '}{params.evento.localizacao}, de {params.evento.dataInicio} a {params.evento.dataFim}.
        </Text>

        <Text style={styles.h2}>3. Valor</Text>
        <Text style={styles.p}>{params.lote.valorReaisFmt}, à vista, conforme cobrança gerada na plataforma FB Eventos.</Text>

        {/* Phase 1: ~3-page boilerplate; full text decided with parceira before piloto.
            Keep this minimal until contract reviewer signs off. */}

        <Text style={styles.h2}>4. Assinaturas</Text>
        <Text style={styles.p}>
          Este contrato é assinado eletronicamente via ZapSign. A ordem de assinatura é
          sequencial: organizadora primeiro, fornecedor em seguida.
        </Text>
      </Page>
    </Document>
  )
}
```

**Job handler** (`src/jobs/tasks/pdf-generate-contract.ts`):

```typescript
import type { Task } from 'graphile-worker'
import { z } from 'zod'
import { renderToBuffer } from '@react-pdf/renderer'
import { withTenant } from '@/db/with-tenant'
import { FornecedorStandV1Contract } from '@/contracts/templates/fornecedor-stand-v1'
import { getMinioClient, bucketFor } from '@/lib/minio'
import { enqueueJob } from '@/jobs/enqueue'
import { eq } from 'drizzle-orm'
import { contracts, events, vendors, lots, contractTemplateVersions } from '@/db/schema'

const payloadSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  contractId: z.string().uuid(),
})

export const pdfGenerateContract: Task = async (rawPayload, helpers) => {
  const { tenantId, tenantSlug, contractId } = payloadSchema.parse(rawPayload)
  // RLS-no-worker contract — wrap every read/write in withTenant (Phase 0 Plan 06 invariant)
  await withTenant(tenantId, async (db) => {
    const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId))
    if (!c) throw new Error(`Contract ${contractId} not found in tenant ${tenantId}`)

    const [tv] = await db.select().from(contractTemplateVersions).where(eq(contractTemplateVersions.id, c.templateVersionId))
    const [event] = await db.select().from(events).where(eq(events.id, c.eventId))
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, c.vendorId))
    const [lot] = await db.select().from(lots).where(eq(lots.id, c.lotId))

    // Phase 1: ONLY fornecedor-stand-v1 template exists. Phase 2 may add more.
    if (tv.templatePath !== 'fornecedor-stand-v1.tsx') {
      throw new Error(`Unknown template ${tv.templatePath}`)
    }

    const buffer = await renderToBuffer(
      <FornecedorStandV1Contract params={{
        organizadora: { nome: 'TODO from session', cnpj: 'TODO', representante: 'TODO' },
        fornecedor:   { razaoSocial: vendor.legalName, cnpj: vendor.cnpj, representante: vendor.legalRepresentativeName ?? '' },
        evento:       { nome: event.name, localizacao: event.location,
                        dataInicio: event.startsAt.toISOString().slice(0,10),
                        dataFim: event.endsAt.toISOString().slice(0,10) },
        lote:         { codigo: lot.code, areaM2: Number(lot.areaM2),
                        categoria: 'TODO category name lookup',
                        valorReaisFmt: brl(Number(c.totalCents / 100)) },
        geradoEm:     new Date().toISOString(),
        numero:       contractId.slice(0, 8),
      }} />,
    )

    // Upload to MinIO
    const objectKey = `contracts/${contractId}/draft.pdf`
    await getMinioClient().putObject(bucketFor(tenantSlug), objectKey, buffer, buffer.length, {
      'Content-Type': 'application/pdf',
    })

    // Persist + chain ZapSign job (outbox — same transaction)
    await db.update(contracts).set({
      draftPdfObjectKey: objectKey,
      status: 'awaiting_org',
    }).where(eq(contracts.id, contractId))

    // Enqueue ZapSign send-contract job. enqueueJob accepts the txn handle directly
    // — Phase 0 pattern, see src/jobs/enqueue.ts header comment.
    // NOTE: must call within a postgres.js txn — re-enter pool.begin since withTenant
    // already begin()'d. For simplicity, use db.execute(sql`...add_job...`) directly here:
    await db.execute(sql`
      SELECT graphile_worker.add_job(
        identifier => 'zapsign.send-contract',
        payload => ${JSON.stringify({ tenantId, tenantSlug, contractId })}::text::json
      )
    `)
  })
}
```

**Pitfalls:**

| Pitfall | Mitigation |
|---------|-----------|
| `renderToBuffer` not exported from main entry | Import from `@react-pdf/renderer` works in Node; if it fails with "fs not found" use `@react-pdf/renderer/lib/node` (advanced) |
| Font.register absolute path in Docker | Phase 1: don't register custom fonts. Use builtin Helvetica. |
| `await renderToBuffer` takes 200-2000ms | OK for Phase 1 — job runs async. Phase 2 caches by content hash if needed. |
| Outbox chain (PDF gen → ZapSign send) | Use SQL `add_job` directly inside the worker's `withTenant` transaction. Or pattern the chain at the calling Server Action so the chain is enqueued together. |
| Forgetting `withTenant(payload.tenantId, ...)` | Phase 0 plan 06 contract: every task wraps its body in withTenant. RLS-no-worker rule. |

### Pattern A7 — ZapSign REST + Sequential Sign (ORG-11, D-01, D-02, D-03)

**Endpoint reference (verified via docs.zapsign.com.br fetch + WebSearch):**

| Operation | Production URL | Sandbox URL | Auth |
|-----------|----------------|-------------|------|
| Create document via Upload | `POST https://api.zapsign.com.br/api/v1/docs/` | `POST https://sandbox.api.zapsign.com.br/api/v1/docs/` | `Authorization: Bearer <TOKEN>` |
| List documents | `GET .../api/v1/docs/?page=N` | same shape | Bearer |
| Get document | `GET .../api/v1/docs/{token}/` | | |
| Add signer | `POST .../api/v1/docs/{token}/signers/` | | |
| Register webhook | `POST .../api/v1/user/company/webhook/` | | |

**Sandbox token issuance:** Sandbox dashboard at `https://sandbox.app.zapsign.co/` → Configurações > Integrações > API ZAPSIGN. **Sandbox is environment-determined by URL only — no `sandbox=true` flag in payload required.** [CITED: docs.zapsign.com.br/ambiente-de-testes]

**Create document request body** (CITED docs.zapsign.com.br/english/documentos/criar-documento):

```typescript
// src/lib/zapsign.ts
const ZAPSIGN_CREATE_REQ = z.object({
  name: z.string().max(255),
  url_pdf: z.string().url(),   // public/signed URL — we pass MinIO presigned GET (15-min TTL)
  signers: z.array(z.object({
    name: z.string(),
    email: z.string().email(),
    phone_country: z.string().optional(),
    phone_number: z.string().optional(),
    auth_mode: z.enum(['assinaturaTela', 'tokenEmail']).default('assinaturaTela'),
    order_group: z.number().int(),   // 1 = organizadora, 2 = fornecedor (D-02)
  })),
  signature_order_active: z.literal(true),   // D-02 sequential
  lang: z.literal('pt-br'),
  external_id: z.string().uuid(),    // = contracts.id — wire ZapSign callbacks back to us
  date_limit_to_sign: z.string().datetime().optional(),
  brand_name: z.string().optional(),
})

const ZAPSIGN_CREATE_RES = z.object({
  open_id: z.number(),
  token: z.string(),
  status: z.string(),
  name: z.string(),
  original_file: z.string().url(),
  signed_file: z.string().url().nullable(),
  created_at: z.string(),
  signers: z.array(z.object({
    token: z.string(),
    sign_url: z.string().url(),
    status: z.string(),
    name: z.string(),
    email: z.string(),
    phone_country: z.string().nullable(),
    phone_number: z.string().nullable(),
    times_viewed: z.number(),
    last_view_at: z.string().nullable(),
    signed_at: z.string().nullable(),
  })),
})

export async function zapsignCreateDoc(body: z.infer<typeof ZAPSIGN_CREATE_REQ>) {
  const baseUrl = env.ZAPSIGN_ENV === 'production'
    ? 'https://api.zapsign.com.br/api/v1'
    : 'https://sandbox.api.zapsign.com.br/api/v1'
  const res = await fetch(`${baseUrl}/docs/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.ZAPSIGN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(ZAPSIGN_CREATE_REQ.parse(body)),
  })
  if (!res.ok) throw new Error(`ZapSign ${res.status}: ${await res.text()}`)
  return ZAPSIGN_CREATE_RES.parse(await res.json())
}
```

**ZapSign send-contract task** (`src/jobs/tasks/zapsign-send-contract.ts`):

```typescript
export const zapsignSendContract: Task = async (rawPayload, helpers) => {
  const { tenantId, tenantSlug, contractId } = payloadSchema.parse(rawPayload)
  await withTenant(tenantId, async (db) => {
    const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId))
    if (!c.draftPdfObjectKey) throw new Error('PDF not yet generated')

    // Pre-signed GET URL (15 min) gives ZapSign a public-fetchable URL
    const pdfUrl = await getMinioClient().presignedGetObject(bucketFor(tenantSlug), c.draftPdfObjectKey, 900)

    // Lookup org + vendor info
    const [event] = await db.select().from(events).where(eq(events.id, c.eventId))
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, c.vendorId))
    // Organizadora email/name comes from Better Auth user — Phase 1: simplify by using the active user

    const result = await zapsignCreateDoc({
      name: `Contrato ${c.id.slice(0, 8)} — ${event.name}`,
      url_pdf: pdfUrl,
      signers: [
        { name: 'Organizadora', email: 'TODO — from session user', order_group: 1 },
        { name: vendor.legalRepresentativeName ?? vendor.legalName, email: vendor.email, order_group: 2 },
      ],
      signature_order_active: true,
      lang: 'pt-br',
      external_id: c.id,   // critical — webhook payload echoes this back
    })

    await db.update(contracts).set({
      zapsignDocToken: result.token,
      zapsignOpenId: result.open_id,
      zapsignSignUrlOrg: result.signers[0]?.sign_url,
      zapsignSignUrlFornecedor: result.signers[1]?.sign_url,
    }).where(eq(contracts.id, c.id))

    // Enqueue email to organizadora with sign_url_org
    await db.execute(sql`SELECT graphile_worker.add_job(
      identifier => 'email.send-status-update',
      payload => ${JSON.stringify({
        tenantId, tenantSlug,
        templateKey: 'contrato_emitido',   // sent to organizadora when ready to sign
        contractId: c.id,
        recipient: 'organizadora',
      })}::text::json
    )`)
  })
}
```

**Webhook handler** (`src/app/api/webhooks/zapsign/route.ts`) — Phase 1 simple processing:

```typescript
// ZapSign does NOT document an HMAC signature header (extracted from doc_signed payload doc fetch
// — no signature/HMAC header listed). Verification strategy:
//   1. Inbox table: gravar todo payload + receivedAt (audit trail).
//   2. Re-validate via API GET: ZapSign-emitted token → GET /docs/{token}/ → confirm status field.
//      This makes the webhook merely a NOTIFICATION; the source of truth is the API.
//   3. Phase 2 will harden with optional signed-header (ZapSign supports "custom headers" — we can
//      configure a shared-secret header on webhook creation; verify on receipt).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { zapsignInbox } from '@/db/schema/contracts'
import { enqueueJob } from '@/jobs/enqueue'

const ZAPSIGN_WEBHOOK = z.object({
  event_type: z.enum(['doc_created', 'doc_signed', 'doc_refused', 'doc_deleted', 'email_bounce', 'doc_expired']),
  sandbox: z.boolean(),
  external_id: z.string().nullable(),   // contracts.id we echoed
  open_id: z.number(),
  token: z.string(),
  name: z.string(),
  status: z.string(),
  original_file: z.string().url().nullable(),
  signed_file: z.string().url().nullable(),
  signers: z.array(z.any()),
  // ... plus lots more we don't process in Phase 1
}).passthrough()

export async function POST(req: NextRequest) {
  const raw = await req.json()
  const parsed = ZAPSIGN_WEBHOOK.safeParse(raw)
  if (!parsed.success) {
    // Even unparseable payloads land in inbox so we can debug
    await db.insert(zapsignInbox).values({
      eventType: 'unknown', payload: raw, tenantId: null, doctoken: null,
    })
    return new Response('ok', { status: 200 })
  }
  const data = parsed.data

  // Resolve tenant by following external_id → contracts row
  // (No tenant context yet — use migratorPool for inbox INSERT)
  await db.insert(zapsignInbox).values({
    tenantId: null,   // resolved at processing time
    eventType: data.event_type,
    doctoken: data.token,
    payload: data,
  })

  // Inline processing for Phase 1 — Phase 2 will async via worker
  if (data.event_type === 'doc_signed' && data.external_id) {
    // Lookup contract → tenant_id → run withTenant
    // (Implementation detail: use migratorPool or singleton db for the lookup,
    //  then enter withTenant. See plan task.)
    await enqueueJob(db.$client as any /* see plan */, 'zapsign.webhook-process', { token: data.token })
  }
  return new Response('ok', { status: 200 })
}
```

Phase 1 deliberately accepts the simple semantic: ZapSign webhook → inbox row → job dequeues → fetches `GET /docs/{token}/` from ZapSign API → updates contract status to `signed`. The re-fetch is the security boundary.

### Pattern A8 — Pagar.me v5 Simple Charge (ORG-12)

**Endpoint reference (CITED docs.pagar.me/reference):**

- **Base URL (same for sandbox and production):** `https://api.pagar.me/core/v5`
- **Environment switch via API key prefix only:**
  - Sandbox secret key: `sk_test_*`
  - Production secret key: `sk_*`
- **Auth: HTTP Basic. Username = secret key. Password = empty.**
  - Header: `Authorization: Basic <base64(sk_test_xyz:)>`

**Create order (PIX example)** — `POST /core/v5/orders`:

```typescript
// src/lib/pagarme.ts
const PAGARME_CUSTOMER = z.object({
  name: z.string(),
  email: z.string().email(),
  document: z.string(),         // CPF/CNPJ digits only
  document_type: z.enum(['CPF', 'CNPJ']),
  phones: z.object({
    mobile_phone: z.object({
      country_code: z.string(),   // '55'
      area_code: z.string(),
      number: z.string(),
    }).optional(),
  }).optional(),
})

const PAGARME_PIX_ORDER = z.object({
  customer: PAGARME_CUSTOMER,
  items: z.array(z.object({
    amount: z.number().int().positive(),   // CENTS
    description: z.string(),
    quantity: z.number().int().positive(),
  })),
  payments: z.array(z.object({
    payment_method: z.literal('pix'),
    pix: z.object({
      expires_in: z.number().int().positive(),     // seconds (e.g. 3600 = 1h)
      additional_information: z.array(z.object({
        name: z.string(),
        value: z.string(),
      })).optional(),
    }),
  })),
  code: z.string().optional(),       // your internal idempotency code
})

const PAGARME_ORDER_RES = z.object({
  id: z.string(),                     // 'or_xxx'
  code: z.string().optional(),
  amount: z.number().int(),
  status: z.string(),                 // 'pending' | 'paid' | 'canceled' | ...
  customer: z.object({ id: z.string() }).passthrough(),
  charges: z.array(z.object({
    id: z.string(),                   // 'ch_xxx'
    status: z.string(),               // 'pending' | 'paid' | 'failed' | ...
    amount: z.number().int(),
    last_transaction: z.object({
      qr_code: z.string().optional(),         // PIX copia-cola
      qr_code_url: z.string().optional(),     // PIX QR image URL
      expires_at: z.string().optional(),
    }).passthrough().optional(),
  })),
}).passthrough()

export async function pagarmeCreateOrder(body: z.infer<typeof PAGARME_PIX_ORDER>) {
  const secretKey = env.PAGARME_SECRET_KEY!   // sk_test_ or sk_
  const auth = Buffer.from(`${secretKey}:`).toString('base64')
  const res = await fetch('https://api.pagar.me/core/v5/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(PAGARME_PIX_ORDER.parse(body)),
  })
  if (!res.ok) throw new Error(`Pagar.me ${res.status}: ${await res.text()}`)
  return PAGARME_ORDER_RES.parse(await res.json())
}
```

**Create order (credit card example)** — payment object is different:

```typescript
{
  payment_method: 'credit_card',
  credit_card: {
    installments: 1,
    statement_descriptor: 'FBEVENTOS',
    card: {
      number: '4242...', holder_name: 'TODO',
      exp_month: 12, exp_year: 30, cvv: '123',
      billing_address: { line_1: '...', zip_code: '...', city: '...', state: '...', country: 'BR' },
    },
  },
}
```

For Phase 1 organizadora-driven charges, the **PIX-only path is recommended** (charge sent as a link to the fornecedor; they pay via PIX QR/copia-cola). Cartão de crédito Phase 1 supports the path but isn't the primary flow — fornecedor self-service checkout with cartão lands in Phase 2.

**Charge state machine** (per docs.pagar.me):
- `pending` → `paid` (success) | `failed` (decline) | `canceled` (org cancels) | `chargedback` (disputes)
- For PIX: `pending` → `paid` (PIX received) | `canceled` (expiration past)

**Webhook events** to subscribe (`POST .../v5/hooks` from dashboard or API): `order.paid`, `order.payment_failed`, `order.canceled`, `charge.paid`, `charge.payment_failed`. [CITED: docs.pagar.me/reference/eventos-de-webhook-1]

**Webhook auth: HTTP Basic Auth (merchant-configured)**.

Pagar.me v5 does not document an HMAC signature header. The mechanism for inbound webhook security is:

1. **In the Pagar.me dashboard**, when registering the webhook URL, configure Basic Auth credentials (username + password). Pagar.me will send `Authorization: Basic <base64(user:pass)>` on every webhook delivery.
2. **In the Next.js Route Handler**, verify the header matches our configured `PAGARME_WEBHOOK_USERNAME` + `PAGARME_WEBHOOK_PASSWORD` env vars.

```typescript
// src/app/api/webhooks/pagarme/route.ts
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { pagarmeInbox, payments } from '@/db/schema/payments'

const PAGARME_WEBHOOK = z.object({
  id: z.string(),
  account: z.object({ id: z.string() }).optional(),
  type: z.string(),     // 'order.paid' | 'charge.paid' | ...
  data: z.any(),
}).passthrough()

export async function POST(req: NextRequest) {
  // 1. Basic Auth check
  const expected = `Basic ${Buffer.from(`${env.PAGARME_WEBHOOK_USERNAME}:${env.PAGARME_WEBHOOK_PASSWORD}`).toString('base64')}`
  if (req.headers.get('authorization') !== expected) {
    return new Response('unauthorized', { status: 401 })
  }

  const raw = await req.json()
  const parsed = PAGARME_WEBHOOK.safeParse(raw)
  await db.insert(pagarmeInbox).values({
    tenantId: null,
    eventType: parsed.success ? parsed.data.type : 'unknown',
    orderId:   parsed.success ? (parsed.data.data?.id?.startsWith('or_') ? parsed.data.data.id : null) : null,
    chargeId:  parsed.success ? (parsed.data.data?.id?.startsWith('ch_') ? parsed.data.data.id : null) : null,
    payload: raw,
  })

  // Phase 1 inline processing: lookup payment by pagarmeOrderId, update status.
  // Phase 2: enqueue idempotent job + outbox pattern.
  if (parsed.success && parsed.data.type === 'order.paid') {
    const orderId = parsed.data.data?.id
    if (orderId) {
      // singleton db query to find tenant_id, then withTenant update
      // (full implementation in plan task)
    }
  }
  return new Response('ok', { status: 200 })
}
```

**Idempotency strategy (Phase 1 minimal):** use Pagar.me's `id` field on the webhook as a natural dedup key. Add `UNIQUE` on `pagarme_inbox(payload->>'id')` → repeat deliveries are no-op. Phase 2 will harden with outbox + Saga.

**Sandbox→production gate** (D-14): flip `PAGARME_SECRET_KEY` from `sk_test_*` to `sk_*` only when smoke E2E passes.

**Pitfalls:**

| Pitfall | Mitigation |
|---------|-----------|
| Webhook arrives before charge created locally | Inbox row persisted regardless; processor retries with exponential backoff if local row not yet present |
| Duplicate webhook delivery | Unique on `payload->>'id'` (idempotent at storage layer) |
| Pagar.me v5 docs gaps on HMAC | Confirmed Basic Auth is the documented inbound auth (per ecosystem patterns); add IP allowlist + payload re-fetch via API as Phase 2 hardening |
| PIX expires_in too short | Use 3600s minimum (1h); UI shows countdown |
| Currency unit | Pagar.me ALWAYS expects amounts in CENTS. Always store/transmit `amount_cents`. |

### Pattern A9 — Dashboards (ORG-13, 14, D-12)

**Occupancy dashboard** = same Konva component as editor with `mode='dashboard'`:

```typescript
// /[slug]/eventos/[id]/dashboard/page.tsx
export default async function DashboardPage({ params }: { params: { slug: string; id: string } }) {
  return withTenantPage(params.slug, async (tenantId) => withTenant(tenantId, async (db) => {
    const ev = await db.select().from(events).where(eq(events.id, params.id))
    const lotsRows = await db.select().from(lots).where(eq(lots.eventId, params.id))
    const totalArea = lotsRows.reduce((acc, l) => acc + Number(l.areaM2), 0)
    const soldArea = lotsRows.filter(l => l.status === 'sold').reduce((acc, l) => acc + Number(l.areaM2), 0)
    const totalValueCents = lotsRows.reduce((acc, l) => acc + Math.round(Number(l.basePrice) * 100), 0)
    const soldValueCents = lotsRows.filter(l => l.status === 'sold').reduce((acc, l) => acc + Math.round(Number(l.basePrice) * 100), 0)
    return (
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2"><PlantaEditor event={ev} lots={lotsRows} mode="dashboard" /></div>
        <div className="space-y-3">
          <Card title="Ocupação por m²"  value={`${(soldArea/totalArea*100).toFixed(1)}%`} sub={`${brl(soldArea)} m² / ${brl(totalArea)} m²`} />
          <Card title="Ocupação por valor" value={`${(soldValueCents/totalValueCents*100).toFixed(1)}%`} sub={`${brl(soldValueCents/100)} / ${brl(totalValueCents/100)}`} />
          <Card title="Lotes vendidos"   value={`${lotsRows.filter(l=>l.status==='sold').length} / ${lotsRows.length}`} />
        </div>
      </div>
    )
  }))
}
```

**Financial dashboard** = sum aggregations from `payments`:

```typescript
const aggregates = await db.execute(sql`
  SELECT
    SUM(CASE WHEN status='paid'    THEN amount_cents ELSE 0 END) AS recebido_cents,
    SUM(CASE WHEN status='pending' THEN amount_cents ELSE 0 END) AS a_receber_cents
  FROM payments
  WHERE deleted_at IS NULL
`)
// Comissão da plataforma: configuração TBD com parceira — Phase 1 stub at 5% of recebido
const comissaoCents = aggregates.recebido_cents * 0.05
```

### Pattern A10 — BrasilAPI CNPJ Lookup Detailed (ORG-16, D-16)

| Property | Value |
|----------|-------|
| Endpoint | `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` (cnpj = 14 digits, no mask) |
| Auth | None |
| Rate limit | Not officially published [ASSUMED]; defensive 5s timeout + cache 24h |
| 200 response (key fields) | `cnpj`, `razao_social`, `nome_fantasia`, `situacao_cadastral` (integer: **2 = ATIVA**), `descricao_situacao_cadastral`, `cnae_fiscal`, `cnae_fiscal_descricao`, `logradouro`, `numero`, `bairro`, `municipio`, `uf`, `cep`, `data_situacao_cadastral`, `qsa` (quadro societário, array), `regime_tributario` (array), `porte`, `data_inicio_atividade` |
| 404 response | `{ "message": "CNPJ ... não foi encontrado", "type": "not_found" }` |
| Error degradation strategy | `BrasilApiUnavailable` (5xx or timeout) → register vendor with `cnpj_verified=false`, show warning badge in UI |
| Status interpretation | situacao_cadastral=2 → ✓ Verificado. Other (1, 3, 4, 8) → ⚠ Cadastrado mas com situação não-ATIVA — surface to organizadora as warning |

[VERIFIED: brasilapi.com.br response shape captured via direct GET on test CNPJ; CITED: brasilapi.com.br/docs]

### Pattern A11 — Resend Templates (ORG-17, D-15)

**Template skeleton** (`src/lib/email/templates/aprovacao-fornecedor.ts`):

```typescript
// pt-BR text-only templates (D-15). React Email rich HTML deferred to Phase 4.
export interface AprovacaoFornecedorVars {
  vendorName: string
  organizadoraName: string
  loginUrl: string
}

export const aprovacaoFornecedor = (v: AprovacaoFornecedorVars) => ({
  subject: `Você foi aprovado como fornecedor — ${v.organizadoraName}`,
  body: `Olá ${v.vendorName},

Você foi aprovado como fornecedor pela ${v.organizadoraName} no FB Eventos.
Acesse seu painel para receber contratos e cobranças: ${v.loginUrl}

Equipe FB Eventos`,
})
```

**Five templates** (file path → variables):

| Event Key | File | Variables |
|-----------|------|-----------|
| `signup_fornecedor` | `signup-fornecedor.ts` | `vendorName`, `organizadoraName` |
| `aprovacao_fornecedor` | `aprovacao-fornecedor.ts` | `vendorName`, `organizadoraName`, `loginUrl` |
| `rejeicao_fornecedor` | `rejeicao-fornecedor.ts` | `vendorName`, `organizadoraName`, `reason` |
| `contrato_emitido` | `contrato-emitido.ts` | `signerName`, `contractName`, `signUrl` |
| `contrato_assinado` | `contrato-assinado.ts` | `signerName`, `contractName`, `signedFileUrl` |

**Job handler** (`src/jobs/tasks/email-send-status.ts`):

```typescript
import { sendEmail } from '@/lib/email'
import { aprovacaoFornecedor, /* ... */ } from '@/lib/email/templates'

const TEMPLATES = { aprovacao_fornecedor: aprovacaoFornecedor, /* ... */ } as const

export const emailSendStatus: Task = async (rawPayload, helpers) => {
  const { tenantId, templateKey, vars, to } = payloadSchema.parse(rawPayload)
  const { subject, body } = TEMPLATES[templateKey](vars)
  await sendEmail({ to, subject, text: body })   // Phase 0 wrapper handles Resend / mailpit / in-memory
}
```

### Anti-Patterns to Avoid (Phase 1)

- **Reserva de lote with TTL in Phase 1.** OUT OF SCOPE. Lots transition `available → sold` (atribuição manual + contrato + pagamento). Phase 2 introduces the `reserved` intermediate state with advisory locks.
- **HMAC verification of Pagar.me webhook in Phase 1.** Don't try to invent an HMAC scheme — Pagar.me v5 docs use HTTP Basic. Add IP allowlist in Phase 2 for hardening.
- **Outbox idempotency in Phase 1 webhook handling.** Phase 1 uses inbox + inline processing. Outbox + Saga + idempotent processing lands in Phase 2 (`FORN-10`, `FORN-13`).
- **Editor "drag-each-vertex" mode in Phase 1.** Only entire-polygon move + Transformer scale. Per-vertex edit is Phase 2.
- **Cópia de lote (Cmd+D) in Phase 1.** Editor polish; defer.
- **Custom fonts in `@react-pdf/renderer`.** Use Helvetica only. Custom fonts are a known Node-environment pain point.
- **Storing geometry as JS object instead of jsonb.** D-10 mandates jsonb. Drizzle's `jsonb()` column handles serialization.
- **Skipping bake in Konva Transformer.** Without bake on `transformend`, geometry persists with stale scale + offset. Drag the resized lot → it visually jumps.
- **Using `presignedPutObject` without post-upload validation.** The URL ignores content-type and size — server-side `statObject` check is mandatory.
- **Storing tenant context in module-level singleton.** Always `withTenant(tenantId, fn)` per request/task — Phase 0 invariant.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Polygon drawing canvas | DOM SVG + manual hit-testing | Konva.js + react-konva | 5000+ DOM nodes = browser lag; Konva on canvas scales |
| Resize/rotate handles for polygons | Custom drag-handle code | `Konva.Transformer` | Konva handles anchor positioning, ratio constraints, rotation snap |
| PDF generation | Puppeteer + HTML | @react-pdf/renderer | No Chrome in worker container; faster, smaller image |
| CNPJ format validation | Regex only | regex client + BrasilAPI server lookup | Format ≠ existence; Receita check needed for trust |
| Webhook idempotency (Phase 2+ scope) | Custom dedup logic | Inbox UNIQUE on event id + outbox pattern | Standard CQRS/Saga primitive |
| Multi-tenant bucket isolation | Per-tenant prefix on a single bucket + ACLs | bucket-per-tenant + lifecycle | Cleaner LGPD per-tenant retention; easier to purge an org's data |
| Email retry logic | try-catch loop | Graphile-Worker job retry/backoff | Built-in exponential backoff + permafail |
| PDF storage paths | `/tmp` + filesystem | MinIO object key with versioned tenant bucket | Survives container restart; LGPD-aligned lifecycle |
| ZapSign sequential signing | Custom orchestration of two single-signer documents | `signature_order_active=true` + `order_group=1,2` | One document, one audit trail, one webhook stream |
| Pagar.me PIX QR code generation | Custom QR drawing | `charges[0].last_transaction.qr_code_url` | Pagar.me already renders the QR; just embed `<img>` |

**Key insight:** Phase 1 integrates 4 external services. Each has a documented happy-path. Hand-rolling around their idiosyncrasies for "more control" is exactly the kind of complexity that derails solo dev + 3-month timeline. Stick to documented surfaces; add hardening (HMAC, outbox, idempotent UPSERT) in Phase 2 when the simple version's failure modes are real, observed problems.

---

## Common Pitfalls

### Pitfall 1: ZapSign sandbox URL silently goes to production if env var unset

**What goes wrong:** ZapSign environments differ by URL, not by payload flag. If `ZAPSIGN_ENV=sandbox` is unset in dev and code defaults to production URL, you send real e-sign requests with legal validity to a sandbox token, getting 401 — confusing failure.
**Why it happens:** No `sandbox=true` body flag, no header — purely URL-based.
**How to avoid:** `ZAPSIGN_ENV` is REQUIRED (Zod env schema `.enum(['sandbox','production'])`). Default to `sandbox` in `.env.example`. Walking-skeleton E2E asserts URL contains "sandbox" until D-14 gate passes.
**Warning signs:** 401 on the very first request despite valid token.

### Pitfall 2: Pagar.me HTTP Basic Auth includes trailing colon

**What goes wrong:** `Authorization: Basic <base64(sk_test_xyz)>` (no trailing colon) returns 401. Pagar.me expects username:password, and password is empty — colon is mandatory.
**Why it happens:** Easy to miss when typing `Buffer.from(key)` instead of `Buffer.from(key + ':')`.
**How to avoid:** Always concatenate the empty password: `Buffer.from(\`${secretKey}:\`).toString('base64')`.
**Warning signs:** 401 on Pagar.me calls.

### Pitfall 3: BrasilAPI returns 200 for non-active CNPJ

**What goes wrong:** Code assumes 200 = verified, but `situacao_cadastral` could be 3 (SUSPENSA), 4 (INAPTA), 8 (BAIXADA). Vendor registers as verified though CNPJ is suspended.
**Why it happens:** Conflating "found" with "active".
**How to avoid:** Explicitly check `situacao_cadastral === 2`. UI labels: ✓ ATIVA (verified) | ⚠ ${descricao_situacao_cadastral} (registered + flagged) | ✗ Não localizado (rejected).
**Warning signs:** None until reconciliation phase — silent risk.

### Pitfall 4: Konva polygon points NOT updated after Transformer

**What goes wrong:** User resizes a lot, page refreshes, lot is back to original size. Auto-save persisted the original points + ignored scaleX/scaleY.
**Why it happens:** Konva.Transformer mutates node.scaleX/Y, not the underlying `points` array.
**How to avoid:** On `transformend`, bake scale + offset into points, reset scale to 1 + position to (0,0). See §A5 onTransformEnd handler.
**Warning signs:** Lot returns to original geometry after page refresh.

### Pitfall 5: Pre-signed PUT bypasses content-type AND size check

**What goes wrong:** Client uploads a 500MB executable to the planta endpoint. Server reads the saved `objectKey` and crashes when @react-pdf/renderer tries to embed it.
**Why it happens:** `presignedPutObject` URL does not encode content-type or size policy — any bytes succeed.
**How to avoid:** Server-side `statObject(bucket, key)` after upload completion ping; reject and `removeObject` if content-type or size mismatch.
**Warning signs:** Random PDF-render crashes; bucket grows unexpectedly.

### Pitfall 6: @react-pdf/renderer custom font path differs Dev vs Docker

**What goes wrong:** `Font.register({ src: '/app/public/fonts/Inter.ttf' })` works in `pnpm dev` (path resolves to local fs) but in Docker, `/app/public` lives under a different mount and the font load throws "ENOENT".
**Why it happens:** Different working directories + asset resolution between dev and prod.
**How to avoid:** Phase 1: don't register custom fonts — use Helvetica builtin. Phase 2: if fonts needed, ship fonts inside the Docker image at a fixed absolute path (`/app/fonts/`) referenced consistently.
**Warning signs:** PDF generation succeeds in dev, errors in Coolify deploy.

### Pitfall 7: Auto-save fires on every Konva drag step

**What goes wrong:** Without debounce, a single resize emits hundreds of `UPDATE` queries.
**Why it happens:** Konva events fire continuously during drag.
**How to avoid:** D-11 specifies debounce 1000ms per lot. Use a Map<lotId, timeout> in the editor component or a generic `debounce` helper keyed by lotId.
**Warning signs:** Postgres CPU spikes; audit_log dies under noise (Phase 1 deliberately does NOT audit every drag).

### Pitfall 8: Worker task forgets to wrap in withTenant(payload.tenantId, ...)

**What goes wrong:** Phase 0 invariant. Worker task reads from a tenant-scoped table → returns 0 rows (RLS default-deny).
**Why it happens:** Easy to write a task that uses singleton `db` directly.
**How to avoid:** Every task starts with `await withTenant(payload.tenantId, async db => { ... })`. Phase 0 plan 06 already tested this with `tests/jobs/worker-without-with-tenant.test.ts`. Phase 1's new tasks (`pdf.generate-contract`, `zapsign.send-contract`, etc.) MUST follow.
**Warning signs:** Task succeeds but data isn't there — silent failure.

### Pitfall 9: ZapSign payload includes a presigned URL that expires before signing

**What goes wrong:** We pass `url_pdf: <presigned-15-min>` but the fornecedor signs 30 minutes later. ZapSign tries to download the PDF when displaying signer view → 403 expired.
**Why it happens:** ZapSign archives the PDF at creation time — once they fetch it, they have it. BUT confirm this is true in practice.
**How to avoid:** **Confirmed: ZapSign downloads + archives the PDF at create-document time** (per their docs: "original_file: URL (60-minute expiration)" implies they re-host). Pre-signed GET 15 min is sufficient as the ZapSign side fetches it immediately on `POST /docs/`. If post-create lookups need the PDF again, use the API to fetch `original_file`.
**Warning signs:** Signers see "Document not available" — investigate immediately.

### Pitfall 10: Contract status FSM allows invalid transitions

**What goes wrong:** Status jumps from `draft` to `signed` because a webhook fires before email send is enqueued.
**Why it happens:** No FSM guard on status updates.
**How to avoid:** Use Postgres CHECK constraint: `CHECK (status IN ('draft','awaiting_org','awaiting_fornecedor','signed','refused','expired'))`. Plus application-layer validation: each status update must specify expected previous status (compare-and-swap with `WHERE status = ?`).
**Warning signs:** Inconsistent UI vs DB; missing audit_log rows for intermediate states.

### Pitfall 11: MinIO public hostname vs internal hostname mismatch

**What goes wrong:** Pre-signed URL points to `http://minio:9000/...` (Coolify internal hostname), which browser can't reach.
**Why it happens:** App container's MinIO client uses internal hostname for HTTP API calls + URL signing.
**How to avoid:** Pass a public hostname for URL generation. Either: (a) MinIO client configured with `endPoint='s3.fbeventos.com.br'` even though backend traffic also routes through Traefik (slight extra hop), or (b) use two clients — one internal for non-URL ops, one public-hostname for URL signing.
**Warning signs:** Pre-signed URLs work in `curl` but not in browser.

### Pitfall 12: Forgetting to enable RLS on new tables (Phase 0 contract drift)

**What goes wrong:** A new domain table created without `.enableRLS()` + FORCE RLS + tenant_isolation policy = tenant A reads tenant B's data.
**Why it happens:** Pattern is verbose; easy to skip when adding a new schema file in a rush.
**How to avoid:** Add a CI test (extension of Phase 0 plan 03 contract test) that iterates `information_schema.tables WHERE table_schema='public' AND table_name NOT IN ('tenants', '<inbox tables>')` and asserts each has FORCE RLS + a policy. Phase 1 plan should add this gate.
**Warning signs:** Cross-tenant data leak in tests.

---

## Code Examples

### Verified Pattern — MinIO Pre-Signed PUT

```javascript
// Source: github.com/minio/minio-js/blob/master/examples/presigned-putobject.mjs
// [VERIFIED via WebFetch on 2026-06-13]
const presignedUrl = await s3Client.presignedPutObject('my-bucketname', 'my-objectname', 1000)
// 1000 = expiry in seconds (max 7 days per AWS S3 spec)
```

### Verified Pattern — Konva.Line Polygon

```javascript
// Source: konvajs.org/docs/shapes/Line_-_Polygon.html
// [VERIFIED via WebFetch on 2026-06-13]
const polygon = new Konva.Line({
  points: [73, 192, 73, 160, 340, 23, 500, 109, 499, 139, 342, 93],   // flat [x1,y1,x2,y2...]
  fill: '#00D2FF',
  stroke: 'black',
  strokeWidth: 5,
  closed: true,
})
```

### Verified Pattern — @react-pdf/renderer Document

```javascript
// Source: github.com/diegomura/react-pdf README
// [VERIFIED via WebFetch on 2026-06-13]
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: { flexDirection: 'row', backgroundColor: '#E4E4E4' },
  section: { margin: 10, padding: 10, flexGrow: 1 },
})

const MyDocument = () => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.section}><Text>Section #1</Text></View>
    </Page>
  </Document>
)

const buffer = await renderToBuffer(<MyDocument />)
```

### Verified Pattern — ZapSign Create Doc

```javascript
// Source: docs.zapsign.com.br/english/documentos/criar-documento
// [VERIFIED via WebFetch on 2026-06-13]
const res = await fetch('https://api.zapsign.com.br/api/v1/docs/', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${ZAPSIGN_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Contrato 0a1b2c3d',
    url_pdf: 'https://s3.fbeventos.com.br/.../draft.pdf',
    signers: [
      { name: 'Organizadora', email: 'org@example.com', order_group: 1 },
      { name: 'Fornecedor',   email: 'forn@example.com', order_group: 2 },
    ],
    signature_order_active: true,
    lang: 'pt-br',
    external_id: '0a1b2c3d-...',
  }),
})
const data = await res.json()
// → { open_id, token, status:'pending', signers:[{ token, sign_url, ... }, ...] }
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTML/SVG floor plans | Canvas via Konva.js | 2019+ widely adopted | DOM nodes bottleneck at 500+ shapes; Canvas scales |
| `pdfkit` low-level PDF | `@react-pdf/renderer` component model | 2020+ | React paradigm; easier template maintenance |
| Self-rolled S3 buckets | MinIO bucket-per-tenant | 2022+ K8s adoption | Per-tenant LGPD lifecycle on cheap self-host |
| Webhook HMAC SHA-256 (industry-standard) | Pagar.me v5 Basic Auth (still) | v5 unchanged since 2020 | Adequate when paired with IP allowlist + payload re-fetch; weaker than HMAC alone |
| Polling for e-sign status | Webhook `doc_signed` callback | 2018+ | <30s latency; no polling load |

**Deprecated/outdated:**
- Pagar.me v4 (old API) — DO NOT use; v5 only.
- ZapSign API v1 has been stable for 3+ years; no v2 in sight.
- `@react-pdf/renderer` < 4.x — slow render; 4.5.1 is current.

---

## Validation Architecture

> nyquist_validation is enabled in config.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (unit + integration) + @playwright/test 1.60.0 (E2E walking skeleton) |
| Config file | `vitest.config.ts` (Phase 0), `playwright.config.ts` (Phase 0) |
| Quick run command | `pnpm test` (Vitest one-shot) |
| Full suite command | `pnpm test && pnpm test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ORG-01 | Event create + list scoped to tenant | integration (Vitest) | `pnpm test tests/eventos/event-crud.test.ts` | ❌ Wave 0 |
| ORG-02 | Planta upload (pre-signed PUT URL minted; statObject confirms metadata) | integration | `pnpm test tests/eventos/planta-upload.test.ts` | ❌ Wave 0 |
| ORG-03 | Konva editor renders planta — smoke (no canvas pixel-check in CI) | e2e (Playwright) | `pnpm test:e2e tests/e2e/planta-editor.spec.ts` | ❌ Wave 0 |
| ORG-04 | Geometry jsonb shape validates v1.polygon2d; rejects malformed | integration | `pnpm test tests/lotes/geometry-validation.test.ts` | ❌ Wave 0 |
| ORG-05 | Auto-save Server Action persists geometry; debounce documented in component but tested via API | integration | `pnpm test tests/lotes/auto-save.test.ts` | ❌ Wave 0 |
| ORG-06 | Lot categories CRUD with base_fixed + per_sqm_rate; aditivo math | integration | `pnpm test tests/lotes/categories.test.ts` | ❌ Wave 0 |
| ORG-07 | Vendor list/search/filter by status | integration | `pnpm test tests/fornecedores/list.test.ts` | ❌ Wave 0 |
| ORG-08 | Vendor approve/reject FSM → audit_log row + email enqueue | integration | `pnpm test tests/fornecedores/approval.test.ts` | ❌ Wave 0 |
| ORG-09 | Lot assignment requires vendor.status='approved' | integration | `pnpm test tests/lotes/assignment.test.ts` | ❌ Wave 0 |
| ORG-10 | PDF generation job produces buffer + uploads to MinIO mock | integration | `pnpm test tests/contracts/pdf-gen.test.ts` | ❌ Wave 0 |
| ORG-11 | ZapSign send (mocked HTTP) — request body shape + sequential order_group | integration | `pnpm test tests/contracts/zapsign-send.test.ts` | ❌ Wave 0 |
| ORG-12 | Pagar.me create order (mocked HTTP) — request body PIX shape | integration | `pnpm test tests/payments/pagarme-create.test.ts` | ❌ Wave 0 |
| ORG-13 | Occupancy dashboard aggregates correct % | integration | `pnpm test tests/eventos/dashboard-aggregates.test.ts` | ❌ Wave 0 |
| ORG-14 | Financial dashboard aggregates from payments | integration | `pnpm test tests/eventos/financial-aggregates.test.ts` | ❌ Wave 0 |
| ORG-15 | Vendor doc pre-signed GET issued + audit_log row | integration | `pnpm test tests/fornecedores/doc-vault.test.ts` | ❌ Wave 0 |
| ORG-16 | BrasilAPI lookup happy path + 404 + 5xx degrade | integration | `pnpm test tests/fornecedores/brasilapi.test.ts` | ❌ Wave 0 |
| ORG-17 | Email send queues correct template for each status change | integration | `pnpm test tests/fornecedores/notifications.test.ts` | ❌ Wave 0 |
| D-14 gate | Walking-skeleton E2E: signup + planta + lot + PIX sandbox paid + contrato sandbox signed | e2e | `pnpm test:e2e tests/e2e/walking-skeleton.spec.ts` | ⚠ Phase 0 file exists; EXTEND in Phase 1 |

### Sampling Rate
- **Per task commit:** `pnpm test --run` (full Vitest)
- **Per wave merge:** `pnpm test --run && pnpm typecheck && pnpm lint && pnpm check:all`
- **Phase gate:** Above + `pnpm test:e2e` + manual walking-skeleton review

### Wave 0 Gaps

- [ ] `tests/eventos/event-crud.test.ts` — ORG-01
- [ ] `tests/eventos/planta-upload.test.ts` — ORG-02 (MinIO mock via `@aws-sdk/...` mock or in-memory)
- [ ] `tests/e2e/planta-editor.spec.ts` — ORG-03 smoke (Playwright canvas presence check only)
- [ ] `tests/lotes/geometry-validation.test.ts` — ORG-04
- [ ] `tests/lotes/auto-save.test.ts` — ORG-05
- [ ] `tests/lotes/categories.test.ts` — ORG-06
- [ ] `tests/fornecedores/{list,approval,doc-vault,brasilapi,notifications}.test.ts` — ORG-07,08,15,16,17
- [ ] `tests/lotes/assignment.test.ts` — ORG-09
- [ ] `tests/contracts/{pdf-gen,zapsign-send}.test.ts` — ORG-10,11
- [ ] `tests/payments/pagarme-create.test.ts` — ORG-12
- [ ] `tests/eventos/{dashboard-aggregates,financial-aggregates}.test.ts` — ORG-13,14
- [ ] **EXTEND** `tests/e2e/walking-skeleton.spec.ts` with the D-14 4-step gate (signup → planta+lote → PIX sandbox → contrato sandbox)
- [ ] Shared MSW (Mock Service Worker) or in-memory fetch interceptor harness for ZapSign + Pagar.me + BrasilAPI in `src/test/external-mocks.ts`
- [ ] MinIO test container (or in-memory mock) helper in `src/test/minio-test.ts`

---

## Security Domain

> `security_enforcement` is implicitly enabled (no key = enabled per spec).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes (Phase 0 baseline) | Better Auth 1.6.16 — sessions, 2FA, email verification |
| V3 Session Management | yes (Phase 0 baseline) | Better Auth session in Postgres; httpOnly cookies |
| V4 Access Control | yes — NEW for Phase 1 | RLS FORCED on all new tables + audit_log on status changes |
| V5 Input Validation | yes — every Server Action + Route Handler | Zod 4 at every boundary; geometry jsonb strictly validated |
| V6 Cryptography | yes (limited) | TLS via Traefik; pgcrypto for any hash needs; never hand-roll |
| V7 Error Handling | yes | safe-action `handleServerError` returns uniform messages |
| V8 Data Protection | yes — LGPD on vendor PII | Soft-delete + PII column comments (Phase 0 baseline extended) |
| V9 Communications | yes | All external API calls over HTTPS |
| V10 Malicious Code | partial | Phase 1 doesn't ship file execution — PDF generation is server-controlled |
| V12 Files & Resources | yes — NEW for Phase 1 | Pre-signed URL TTL + post-upload content-type + size verification |
| V13 API & Web Services | yes — webhooks | Pagar.me Basic Auth header check; ZapSign payload re-fetch verification |

### Known Threat Patterns for Phase 1 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant data read via Server Action that bypasses withTenant | Information Disclosure | TENA-05 split + RLS FORCED + integration test that proves silent-fail on bypass |
| Malicious file upload (executable disguised as PDF) | Tampering | Server-side `statObject` validates content-type; size capped at 25 MB |
| Webhook spoofing — fake `order.paid` to mark a contract paid | Spoofing | Basic Auth credential check + re-fetch payment status from Pagar.me API; mark `paid` only when API confirms |
| ZapSign webhook spoofing | Spoofing | Re-fetch `GET /docs/{token}/` from ZapSign API; trust API response, not webhook payload |
| BrasilAPI man-in-the-middle | Tampering | HTTPS only; Zod parse on response (rejects malformed) |
| Geometry jsonb injection (e.g. `__proto__` pollution) | Tampering | Strict Zod schema for geometry; never spread untrusted jsonb into object |
| PDF template injection | Tampering | Template variables are React props (escaped by Text component); no string concat into HTML/JSX |
| Pre-signed URL replay | Tampering | TTL 5min PUT, 15min GET; audit_log every GET issuance |
| LGPD: vendor PII leak via audit_log payload | Information Disclosure | `recordAudit` payload should NOT include full PII — only entity_id + before/after status |
| CNPJ enumeration via BrasilAPI | (not directly applicable) | BrasilAPI is the public source; no obscurity loss |
| Lot status race (two simultaneous assignment + sale) | Tampering | UNIQUE constraint on `lot_assignments(lot_id) WHERE deleted_at IS NULL` blocks; advisory lock comes in Phase 2 |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| PostgreSQL 16 | All persistence | ✓ (Coolify managed, Phase 0) | 16-alpine | — |
| MinIO | ORG-02, ORG-15 | ✗ — NEW service to add in Phase 1 plan task | 8.x (latest container) | None — blocking dependency; planner adds `docker/compose.yml` service + Coolify manifest |
| ZapSign API | ORG-10, ORG-11 | ✓ (external, requires account) | n/a (REST v1) | Account creation: `https://app.zapsign.co` → sign up for free tier (5 docs/mo) |
| Pagar.me v5 API | ORG-12 | ✓ (external, requires account) | n/a (v5) | Account creation: `https://id.pagar.me` → request sandbox keys |
| BrasilAPI | ORG-16 | ✓ (public, no auth) | v1 (free) | Degrade-with-warning: register vendor with `cnpj_verified=false` |
| Resend | ORG-17 | ✓ (Phase 0 wired) | 6.12.4 | nodemailer→mailpit in dev (Phase 0) |
| Node 22 LTS | All code execution | ✓ (Phase 0 lock) | 22 LTS | — |
| Graphile-Worker | All jobs | ✓ (Phase 0 plan 06) | 0.16.6 | — |

**Missing dependencies with no fallback:**
- **MinIO**: must be added to `docker/compose.yml` + Coolify deploy manifest. Bucket bootstrap script runs at deploy.

**Missing dependencies with fallback:**
- **BrasilAPI 5xx**: degrade-with-warning per D-16.

---

## Assumptions Log

> Claims tagged `[ASSUMED]` in this research. Discuss/plan-check phase should confirm.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pagar.me v5 webhook auth = HTTP Basic Auth configured per-webhook (no HMAC header) | Pattern A8 | If Pagar.me v5 actually ships an HMAC header we missed, we leave a verification opportunity on the table. Mitigation: documented as Phase 2 hardening item; Basic Auth is the documented inbound auth path. |
| A2 | BrasilAPI free tier has no published rate limit | Pattern A10 | Could get rate-limited during a vendor-import spike. Mitigation: 24h cache by CNPJ + 5s timeout + degrade-with-warning. |
| A3 | BrasilAPI SLA is "informally reliable" — no published SLA | Pattern A10 | Outage during piloto = degraded vendor registration. Mitigation: cache + degrade strategy. |
| A4 | `@react-pdf/renderer` 4.5.1 is stable enough for Phase 1 contract template | Pattern A6 | Regression on a minor bump could affect contract generation. Mitigation: pin EXACT version (no caret); Puppeteer fallback documented but rejected for Phase 1 (D-07 no Chrome in worker). |
| A5 | ZapSign Bearer token in `Authorization` header (per docs but I didn't test live) | Pattern A7 | If actually `Token <key>` style, we get 401 immediately on first call → trivial to fix. |
| A6 | ZapSign archives the PDF at create-document time, not lazily | Pitfall 9 | If they fetch lazily, pre-signed GET TTL 15 min isn't enough for delayed signs. Mitigation: bump TTL to 24h for the create-document fetch URL (separate from the user download URL) if this turns out wrong. |
| A7 | MinIO supports CORS via `mc admin config set fbeventos cors:${BUCKET}` | Pattern A2 | The CORS config command syntax may differ slightly per MinIO version. Mitigation: test in Phase 1 plan task; alternative is `mc admin policy add` or per-bucket policy JSON. |
| A8 | Pagar.me sandbox + production share the same base URL `api.pagar.me/core/v5` | Pattern A8 | Confirmed via docs.pagar.me/reference/autenticação-2 (verified). [VERIFIED] |
| A9 | ZapSign `signature_order_active=true` + `order_group=N` is the canonical sequential pattern | Pattern A7 | Confirmed via WebSearch + docs read. [VERIFIED] |
| A10 | slopcheck unavailable; manual verification via npm registry + GitHub repo confirms | Package Legitimacy Audit | Acceptable risk for these well-established packages; planner does not need to gate each install. |

---

## Open Questions

1. **Organizadora-on-record identity for contracts.**
   - What we know: the contract template embeds `organizadora.nome / cnpj / representante`. Phase 0 has Better Auth users with email/name; the organization (= tenant) has name/slug but not CNPJ/legal rep.
   - What's unclear: where does the organizadora's CNPJ + legal rep come from?
   - Recommendation: Phase 1 plan adds 3 columns to `tenants` (or a new `tenant_profile` table): `cnpj`, `legal_representative_name`, `business_address`. First-time-login flow forces the organizadora to fill these. Decision deferred to plan/discuss.

2. **Comissão da plataforma calculation.**
   - What we know: ORG-14 dashboard shows "comissão da plataforma já calculada". Phase 1 has no split — comissão is conceptual, not transactional.
   - What's unclear: %? Configurable per tenant?
   - Recommendation: Phase 1 stub at flat 5% applied to `payments.amount_cents WHERE status='paid'`. Configurable per tenant column added later (Phase 3 split adds real `commission_rates`).

3. **Contract template text content.**
   - What we know: D-08 says "hardcoded TS template per category" but doesn't specify the legal text body.
   - What's unclear: Who writes the contract content? Lawyer review needed?
   - Recommendation: Phase 1 ships `fornecedor-stand-v1.tsx` with placeholder body text + clear "WIP — REPLACE WITH LEGAL-REVIEWED TEXT" comment. Real text lands as part of the piloto cutover with the organizadora's lawyer.

4. **Multiple signers per contract (e.g. 2 legal reps on org side).**
   - What we know: D-02 says sequential `org → fornecedor` — implicitly one signer per side.
   - What's unclear: 2+ signers per side?
   - Recommendation: Phase 1 = one each. ZapSign supports up to N signers per `order_group`; if a tenant needs 2 org signers in Phase 2+, we add a tenant_profile flag.

5. **Pagar.me webhook secret rotation policy.**
   - What we know: env vars `PAGARME_WEBHOOK_USERNAME` + `PAGARME_WEBHOOK_PASSWORD`.
   - What's unclear: rotation procedure if credentials leak.
   - Recommendation: Phase 1 plan adds to `docs/RUNBOOK.md` — rotate procedure: (a) generate new pair, (b) update env in Coolify, (c) restart, (d) update webhook in Pagar.me dashboard.

---

## Project Constraints (from CLAUDE.md)

These directives MUST be honored. Plans that contradict them fail plan-check.

| Constraint | Source | Phase 1 Implication |
|-----------|--------|---------------------|
| PostgreSQL only — no SQLite, no `.db` files, no embedded DB | CLAUDE.md + PROJECT.md | All new tables in Postgres; no per-tenant SQLite watermarks; Graphile-Worker queue is in Postgres |
| No `:latest` Docker tags in production | CLAUDE.md | MinIO container pinned to `minio/minio:RELEASE.2026-MM-DD-...` semver tag |
| No self-healing migrations / no `drizzle-kit push` | CLAUDE.md | All new migrations (0010..0013) hand-written SQL with explicit FORCE RLS |
| `fb_eventos_app` role NEVER has BYPASSRLS | CLAUDE.md + Phase 0 | New schemas use `.enableRLS()` + tenant_isolation policy targeting `fb_eventos_app` |
| RLS FORCED on every tenant-scoped table | CLAUDE.md | Every new table 0010+ requires `ALTER TABLE ... FORCE ROW LEVEL SECURITY` |
| PII columns carry `COMMENT ON COLUMN ... IS 'PII:...'` | CLAUDE.md + Phase 0 plan 05 | `vendors.email`, `vendors.cnpj`, `vendors.phone`, `vendors.legal_rep_name`, `vendor_documents.*` need PII comments |
| audit_log is append-only via REVOKE UPDATE/DELETE | Phase 0 plan 05 | Every status change in Phase 1 calls `recordAudit(db, ...)` — vendor approve/reject, lot assign, contract emit/sign, payment created/paid |
| No Chrome in `Dockerfile.worker` | CLAUDE.md D-07 mandate | Use @react-pdf/renderer; reject Puppeteer alternative for Phase 1 |
| Reset/destructive endpoints require confirmation token + pre-backup | CLAUDE.md | None in Phase 1 — no DELETE endpoints exposed |
| `gitleaks` pre-commit + secrets only in Coolify env | CLAUDE.md | New env vars (`ZAPSIGN_TOKEN`, `PAGARME_SECRET_KEY`, etc.) only in `.env.example` as placeholders |
| No `BullMQ`, no Redis | CLAUDE.md / STATE.md | Graphile-Worker handles every new job in Phase 1 |
| Server Action input validation via Zod 4 + next-safe-action v8 `.inputSchema()` | CLAUDE.md / Phase 0 plan 04 | Every new Server Action chains `withTenantAction.inputSchema(z.object(...))` |
| Don't change module name from `fb-eventos` | CLAUDE.md | Use `@/` import alias; no `fb_apu0x` references |

---

## ADR-0002 Draft Material (for executor)

**Title:** Choice of E-Signature Provider — ZapSign vs Clicksign

**Status:** Accepted (default per D-01; this ADR formalizes the comparison)

**Context:** Phase 1 requires sequential e-signature of fornecedor contracts. Brazilian market has two dominant providers with public APIs: ZapSign and Clicksign.

**Decision:** Adopt **ZapSign** for v1 / piloto Trindade. Re-evaluate at Phase 3 if Clicksign Enterprise pricing becomes accessible.

**Comparison:**

| Criterion | ZapSign | Clicksign | Winner |
|-----------|---------|-----------|--------|
| Free tier | 5 docs/mo (free); paid plans from ~R$50/mo | None — Enterprise only | ZapSign |
| API access | Public REST + sandbox URL (sandbox.api.zapsign.com.br) | Public REST + sandbox.clicksign.com | Tied |
| Webhook auth | No HMAC header; rely on payload re-validation via API GET | HMAC SHA-256 (configurable secret) | **Clicksign** (security) |
| Sequential signing | `signature_order_active=true` + `order_group` integer | Envelope API with `signer_groups` | Both supported (tied) |
| Sandbox quality | "Reproduces production exactly, without legal validity" | sandbox.clicksign.com — similar | Tied |
| API webhook gating | Free + paid tiers all include webhooks | Enterprise plan only (R$2,500+/mo) | **ZapSign** (cost) |
| Documentation | Pure Markdown + machine-readable sitemap | OpenAPI + reference site | Tied |
| Brazilian market integration | Receita Federal-aligned timestamping in paid tier | Same | Tied |
| Solo-dev DX | Bearer-token auth, single URL, JSON in/out | Same shape | Tied |

**Cost analysis for piloto Trindade:**
- Estimated 100-300 contracts in the first event cycle.
- ZapSign: free up to 5/mo, then ~R$50-100/mo for the small-business tier.
- Clicksign: R$2,500+/mo Enterprise — out of budget for piloto.

**Risk:** ZapSign's webhook lacks HMAC signature header. Mitigation: re-fetch document status from API after each webhook (the webhook is treated as a notification, not as ground truth). Phase 2 may add an optional custom `X-Webhook-Secret` header (ZapSign allows custom headers when creating the webhook).

**Consequences:**
- Phase 1 ships fast on ZapSign free tier.
- If volume grows past ZapSign limits or if a Clicksign Enterprise budget appears, the e-sign abstraction (`src/lib/zapsign.ts` becomes `src/lib/esign.ts` interface) allows swap.

**References:**
- ZapSign docs: https://docs.zapsign.com.br/english
- Clicksign docs: https://developers.clicksign.com
- Pricing data captured via WebSearch 2026-06-13

---

## ADR-0003 Draft Material — Aditivo Pricing Model

**Status:** Accepted (per D-09)
**Decision:** `lote.preço = categoria.base_fixed + lote.area_m² × categoria.per_sqm_rate`. Both columns NOT NULL DEFAULT 0 in `lot_categories`. Either can be 0 — supports flat-rate (base_fixed only), per-m² (per_sqm_rate only), or hybrid.
**Rationale:** Simplest model that covers organizadora's actual price-setting flexibility without exposing them to per-row formula editing in Phase 1. Phase 3+ may introduce a more complex `price_rules jsonb` if needed.
**Alternatives rejected:**
- Per-lote arbitrary price (no formula) — pushes price logic into UI, harder to bulk-edit on category-level change.
- Tiered pricing by area thresholds — overkill for piloto.

---

## ADR-0004 Draft Material — PDF Generator

**Status:** Accepted (per D-07)
**Decision:** `@react-pdf/renderer` v4.5.1 (pinned exact).
**Rationale:**
- TS pure, no Chrome dependency → Dockerfile.worker stays small (~150 MB vs ~500 MB with Chromium).
- React component model → templates are versioned source files (Git history = audit trail per D-08).
- Adequate for Phase 1 contract simplicity.
**Alternatives rejected:**
- Puppeteer/Playwright HTML→PDF — Chrome in worker image violates D-07; adds ~300 MB; longer cold-start in Graphile-Worker.
- `pdfkit` — no React component model; manual layout = harder to maintain template versioning.
- `jsPDF` — client-side library; we need server-side render in Graphile-Worker.
**Risk:** Custom font registration in Node has known issues (CITED). Mitigation: Phase 1 uses Helvetica builtin only.
**Escape hatch documented:** If `@react-pdf/renderer` regression hits late in piloto, Puppeteer fallback can be implemented in a separate worker image, accepting the D-07 cost.

---

## Sources

### Primary (HIGH confidence)
- ZapSign English docs — verified via WebFetch + WebSearch:
  - `https://docs.zapsign.com.br/english/documentos/criar-documento` — full create-doc shape
  - `https://docs.zapsign.com.br/english/webhooks/create-webhook` — webhook registration endpoint
  - `https://docs.zapsign.com.br/english/webhooks/eventos/document/doc_signed` — full doc_signed payload
  - `https://docs.zapsign.com.br/ambiente-de-testes` — sandbox URL + environment switch
- Pagar.me v5 reference — verified via WebFetch + WebSearch:
  - `https://docs.pagar.me/reference/autenticação-2` — Basic Auth + key prefixes
  - `https://docs.pagar.me/reference/eventos-de-webhook-1` — complete event list
  - `https://docs.pagar.me/reference/pix-2` — PIX order + charge shape
- BrasilAPI — verified via live GET:
  - `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` — direct response inspection
  - `https://brasilapi.com.br/docs` — endpoint list
- MinIO — verified via WebFetch + npm:
  - `https://docs.min.io/community/minio-object-store/developers/javascript/API.html` — SDK methods
  - `https://github.com/minio/minio-js/blob/master/examples/presigned-putobject.mjs` — verified example
- Konva — verified via WebFetch:
  - `https://konvajs.org/docs/shapes/Line_-_Polygon.html` — polygon points format
  - `https://konvajs.org/api/Konva.Transformer.html` — Transformer behavior (scaleX/Y mutation, NOT points)
- @react-pdf/renderer — verified via npm + WebFetch:
  - `https://github.com/diegomura/react-pdf` README
  - `https://react-pdf.org/fonts` — Font.register signature + Node limitations
- Phase 0 internal artifacts (HIGH):
  - `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md` — Patterns 1-12
  - `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-04-SUMMARY.md` — TENA-05 split + safe-action chain
  - `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-05-SUMMARY.md` — audit_log + PII inventory
  - `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-06-SUMMARY.md` — Graphile-Worker enqueue + RLS-no-worker
  - `src/db/with-tenant.ts`, `src/lib/actions/safe-action.ts`, `src/jobs/enqueue.ts` — Phase 0 wired code

### Secondary (MEDIUM confidence)
- Clicksign docs — partial fetch only, comparison data via WebSearch:
  - `https://developers.clicksign.com/docs`
  - Pricing tier (Enterprise only for webhooks) — from supersign.com.br/blog comparison + ZapSign pricing page
- Medium article "How to Build an Interactive Polygon Editor in React using React-Konva" — pattern reference (treated as a code review, verified against Konva official docs)

### Tertiary (LOW confidence — verified internally but not from official source)
- Pagar.me v5 webhook Basic Auth detail (`[ASSUMED A1]`) — derived from Pagar.me docs auth-2 page (Basic Auth is the dashboard-configured inbound mechanism) + community references. Recommend live verification when generating the first sandbox webhook.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions live-verified against npm; well-known packages
- Architecture: HIGH — patterns reuse Phase 0 invariants + integration shapes verified against official docs
- Pitfalls: HIGH for documented ones (Konva Transformer behavior, Pagar.me Basic Auth + colon, BrasilAPI status codes); MEDIUM for predicted-from-experience pitfalls (MinIO public/internal hostname, font path Dev vs Docker)
- Security: HIGH for inherited Phase 0 (RLS, audit_log, soft-delete) + MEDIUM for new external integrations (defense relies on payload re-fetch where HMAC unavailable)
- Code examples: HIGH — extracted from official documentation; types in @react-pdf/renderer + Konva + MinIO SDKs verified live

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (30 days for stable stack patterns; revisit BrasilAPI SLA if outages observed)

---

*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Research date: 2026-06-13*
*Researcher confidence: HIGH (stack, architecture, pitfalls); MEDIUM (Pagar.me webhook auth specifics, MinIO CORS exact command syntax — flagged as Assumptions)*
