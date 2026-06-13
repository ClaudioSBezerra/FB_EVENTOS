---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 05
type: execute
wave: 4
depends_on:
  - "01-03"
  - "01-04"
autonomous: true
requirements:
  - ORG-10
  - ORG-11
requirements_addressed:
  - ORG-10
  - ORG-11
tags:
  - contracts
  - pdf
  - react-pdf
  - zapsign
  - graphile-worker
  - webhook
  - adr
must_haves:
  truths:
    - "Contract template engine: @react-pdf/renderer with hardcoded TS template per category at src/contracts/templates/fornecedor-stand-v1.tsx; contracts.template_version stores the version string ('fornecedor-stand-v1') for reproducibility"
    - "Server Action emitContract({lotAssignmentId}) inserts contracts row (status='draft'), enqueues 'pdf.generate-contract' Graphile-Worker job; job generates PDF in worker process, uploads to MinIO at contracts/{contractId}/contract-v1.pdf, then enqueues 'zapsign.send-contract'"
    - "ZapSign send: zapsign.send-contract job calls ZapSign API POST /docs/ with signer_order_required + 2 signers (organizadora first, fornecedor second); stores zapsign_documents row with payload"
    - "Webhook handler at /api/webhooks/zapsign verifies (Basic Auth header + payload re-fetch to ZapSign API as belt-and-suspenders) and updates contracts.status through FSM draft → awaiting_org → awaiting_fornecedor → signed; downloads signed PDF and stores in MinIO at contracts/{contractId}/signed.pdf"
    - "ADR-0002 ratifies ZapSign over Clicksign (cost, REST API, webhook, sandbox UX) per RESEARCH §ZapSign vs Clicksign"
    - "ADR-0004 ratifies @react-pdf/renderer over Puppeteer (Dockerfile.worker stays light; no Chrome binary; layout sufficient for contract)"
files_modified:
  - src/lib/actions/contracts.ts
  - src/contracts/templates/fornecedor-stand-v1.tsx
  - src/contracts/templates/index.ts
  - src/contracts/generate-pdf.ts
  - src/jobs/tasks/pdf-generate-contract.ts
  - src/jobs/tasks/zapsign-send-contract.ts
  - src/jobs/tasks/index.ts
  - src/lib/zapsign/client.ts
  - src/lib/zapsign/types.ts
  - src/app/api/webhooks/zapsign/route.ts
  - src/app/[slug]/contratos/page.tsx
  - src/app/[slug]/contratos/[contractId]/page.tsx
  - src/components/contracts/contract-list.tsx
  - src/components/contracts/contract-detail.tsx
  - src/components/eventos/emit-contract-button.tsx
  - src/lib/validators/contract.ts
  - tests/contracts/pdf-gen.test.ts
  - tests/contracts/zapsign-send.test.ts
  - tests/contracts/zapsign-webhook.test.ts
  - docs/adr/0002-e-sign-provider.md
  - docs/adr/0004-pdf-generator.md
  - package.json
  - pnpm-lock.yaml
---

<objective>
Vertical slice 4 of Phase 1. Organizadora clicks "Emitir contrato" on an assigned lot → Graphile-Worker generates PDF via @react-pdf/renderer → uploads to MinIO → sends to ZapSign with sequential signer order (organizadora first, fornecedor second) → webhook tracks state through FSM until signed. Delivers ORG-10, ORG-11 + ADR-0002 + ADR-0004.
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md (D-01 ZapSign; D-02 sequential signers; D-07 @react-pdf; D-08 template hardcoded TS)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §ZapSign API + §Webhook auth (Basic Auth + payload re-fetch) + §@react-pdf pitfalls + §Worker safety
- src/db/schema/contracts.ts (Plan 01-01)
- src/jobs/enqueue.ts (Plan 0-06)
- src/lib/storage/minio.ts (Plan 01-01)
</files_to_read>

<task id="1" name="@react-pdf template + PDF generation helper + Graphile-Worker job + ADR-0004">
<action>
Install: `pnpm add @react-pdf/renderer@~4.x`.

Create `src/contracts/templates/fornecedor-stand-v1.tsx` — a React component using @react-pdf/renderer primitives (Document, Page, View, Text):
- Header: "CONTRATO DE LOCAÇÃO DE ESPAÇO" + tenant logo (loaded from MinIO if available) + event name
- Section: Identificação das partes (organizadora razão social + cnpj; fornecedor razão social + cnpj)
- Section: Objeto (lote.code, área m², categoria, preço R$ usando computeLotPrice from 01-03)
- Section: Vigência (event.starts_at, event.ends_at)
- Section: Cláusulas padrão (pagamento, cancelamento, força maior) — copy from RESEARCH §Contract Template Skeleton
- Footer: 2 blocos de assinatura (Organizadora / Fornecedor)
- Footnote: template_version 'fornecedor-stand-v1' + generated_at timestamp

Create `src/contracts/templates/index.ts` — registry mapping template_version → component + metadata. Easy to add `-v2.tsx` later.

Create `src/contracts/generate-pdf.ts` — `generateContractPdf({contractId, tenantId, payload})`:
- Looks up template by payload.template_version
- Calls `renderToBuffer(<TemplateComponent {...payload} />)` — returns Buffer
- Returns buffer ready for MinIO upload

Create `src/jobs/tasks/pdf-generate-contract.ts` — Graphile-Worker task:
- Payload: `{contract_id, tenant_id}`
- Wraps body in `withTenant(payload.tenant_id, async () => { ... })` (RLS-no-worker contract)
- Fetches contract + related event + vendor + lot + category (single tenant-scoped JOIN)
- Calls generateContractPdf → uploads to MinIO at `contracts/{contractId}/contract-v1.pdf`
- UPDATEs contracts.pdf_minio_key
- recordAudit('contract.pdf_generated')
- Enqueues `zapsign.send-contract` with `{contract_id, tenant_id}`

Register the task in `src/jobs/tasks/index.ts`.

Write `tests/contracts/pdf-gen.test.ts`:
1. generateContractPdf returns a non-empty Buffer for a known payload
2. PDF first bytes are `%PDF-1.` (sanity)
3. The task handler reads the contract, generates PDF, uploads (mock MinIO), updates pdf_minio_key, enqueues zapsign job
4. Worker without withTenant returns no data and the task throws (RLS-no-worker contract proof)
5. template_version is persisted on the contracts row

Write `docs/adr/0004-pdf-generator.md` ratifying @react-pdf/renderer (Accepted; alternative Puppeteer rejected for Dockerfile.worker size + cold-start time per RESEARCH §PDF Pitfalls).

Commit: `feat(01-05): @react-pdf template fornecedor-stand-v1 + PDF generator + Graphile-Worker job + ADR-0004`
</action>
<read_first>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §@react-pdf (Document/Page/View/Text + font registration + worker safety)
- src/jobs/tasks/echo.ts (Plan 0-06 — task pattern reference)
- src/db/with-tenant.ts (boundary)
- src/lib/audit.ts
- src/lib/lots/price.ts (Plan 01-03 computeLotPrice)
</read_first>
<acceptance_criteria>
- `pnpm test tests/contracts/pdf-gen.test.ts` → 5 tests pass
- `pnpm tsc -p tsconfig.worker.json --noEmit` exits 0 (template + helper are worker-safe — no React DOM, no JSX runtime mismatch)
- Manual: trigger generateContractPdf inline → buffer opens in a PDF viewer with correct fields populated
- `docs/adr/0004-pdf-generator.md` exists with Accepted status + alternative rejected with rationale
</acceptance_criteria>
</task>

<task id="2" name="ZapSign client + send-contract task + ADR-0002">
<action>
Create `src/lib/zapsign/types.ts` — Zod schemas + TS types for ZapSign API:
- DocCreatePayload: name, url_pdf (or base64_pdf), signers (array with name, email, send_automatic_email, order_group), brand_logo, brand_primary_color
- DocCreateResponse: open_id, token, status, signers[]
- WebhookEvent: event_type enum('signed','rejected','expired','viewed'), token, document (...)

Create `src/lib/zapsign/client.ts` — typed wrapper:
- `createDocument(payload)` — `fetch(ZAPSIGN_BASE_URL + '/api/v1/docs/', { POST, headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(payload) })`; Zod-parse response
- `getDocument(token)` — `fetch(ZAPSIGN_BASE_URL + '/api/v1/docs/:token/')` — used for webhook re-fetch defense
- `downloadSignedPdf(token)` — fetches signed PDF binary
- ZAPSIGN_BASE_URL switches between `https://sandbox.api.zapsign.com.br` and `https://api.zapsign.com.br` based on `ZAPSIGN_ENV` env

Create `src/jobs/tasks/zapsign-send-contract.ts` — Graphile-Worker task:
- Payload: `{contract_id, tenant_id}`
- Wraps in withTenant
- Loads contract + organizadora user + fornecedor vendor + uses pre-signed GET for pdf_minio_key to generate a temporary URL
- Builds DocCreatePayload with signers: `[{name: org_name, email: org_email, order_group: 1, send_automatic_email: true}, {name: vendor_name, email: vendor_email, order_group: 2, send_automatic_email: false}]` — organizadora signs first, fornecedor's email fires after order_group=1 completes (ZapSign handles this automatically with `signer_order_required: true` and order_group)
- Calls ZapSign createDocument
- INSERTs zapsign_documents row with zapsign_id + payload_send
- UPDATEs contracts.status = 'awaiting_org', contracts.zapsign_doc_id = token
- recordAudit('contract.zapsign_sent')
- enqueueJob('email.send-status-update', {contract_id, event: 'contrato_emitido'})

Register the task in `src/jobs/tasks/index.ts`.

Create `src/lib/actions/contracts.ts` with withTenantAction:
- `emitContract({lotAssignmentId})` — Zod parse → verifies assignment in tenant → INSERTs contracts row (status='draft', template_version='fornecedor-stand-v1') → enqueueJob('pdf.generate-contract') → recordAudit('contract.emitted')
- `listContracts({eventId?})` — RLS-scoped SELECT

Create `src/components/eventos/emit-contract-button.tsx` (used on the lot-detail panel) and `src/components/contracts/contract-list.tsx` + `src/components/contracts/contract-detail.tsx`. Pages at `/[slug]/contratos/...`.

Write `tests/contracts/zapsign-send.test.ts`:
1. zapsign-send-contract task posts to mocked ZapSign with signer_order_required + 2 signers in correct order
2. zapsign_documents row inserted with zapsign_id from response
3. contracts.status transitions to 'awaiting_org'
4. ZAPSIGN_ENV=sandbox uses sandbox.api.zapsign.com.br
5. Worker without withTenant returns no contract (RLS-no-worker)
6. emitContract Server Action enqueues pdf.generate-contract job

Write `docs/adr/0002-e-sign-provider.md` — full ADR per RESEARCH §ZapSign vs Clicksign:
- Decision: ZapSign
- Status: Accepted
- Context: Phase 1 needs e-sign for fornecedor contracts; CONTEXT.md D-01 + D-02 sequential signers
- Comparison: cost (ZapSign 5-doc free tier vs Clicksign Enterprise webhook), REST API quality (verified), webhook reliability, sandbox UX, sequential signer support (both yes)
- Decision rationale: ZapSign wins on free tier + simpler REST + adequate features for piloto
- Consequences: positive (lower cost, simpler integration); negative (smaller community, possible feature gap when scaling)
- References: RESEARCH §ZapSign API + §Clicksign API

Commit: `feat(01-05): ZapSign client + send-contract task (sequential signers) + ADR-0002`
</action>
<read_first>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §ZapSign API (POST /api/v1/docs/ exact shape, order_group semantics, signer_order_required)
- src/jobs/tasks/index.ts (registration pattern)
- src/test/external-mocks.ts (ZapSign mock handlers)
- src/lib/env.ts (env validation pattern)
</read_first>
<acceptance_criteria>
- `pnpm test tests/contracts/zapsign-send.test.ts` → 6 tests pass
- ZAPSIGN_TOKEN + ZAPSIGN_ENV documented in .env.example
- Manual smoke (sandbox): emit a contract → check ZapSign sandbox dashboard → both signers present in correct order
- `docs/adr/0002-e-sign-provider.md` exists with full Comparison + Decision rationale
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
</acceptance_criteria>
</task>

<task id="3" name="ZapSign webhook handler + FSM transition + signed PDF download + audit">
<action>
Create `src/app/api/webhooks/zapsign/route.ts` — Route Handler (App Router):
- Verify Basic Auth header against `ZAPSIGN_WEBHOOK_USER` + `ZAPSIGN_WEBHOOK_PASS` env (Phase 1 uses simple Basic Auth as per RESEARCH §Webhook auth — Phase 2 will add HMAC + outbox)
- Zod-parse payload using WebhookEvent schema; on parse fail → log + 200 (don't let bad payload retry forever)
- BELT-AND-SUSPENDERS: call `getDocument(token)` against ZapSign API to RE-FETCH the actual document status (don't trust the webhook payload alone — protects against webhook spoofing)
- Wrap body in `withTenant(tenant_id resolved from zapsign_documents.zapsign_id)` — extract tenant via `SELECT z.tenant_id FROM zapsign_documents z WHERE z.zapsign_id = ?` using migratorPool (RLS-bypass for this lookup)
- Within withTenant:
  - INSERT into zapsign_documents.payload_callback (append the new event payload)
  - State machine transition per event_type:
    - `signed` and current_signer.order_group=1 → contracts.status = 'awaiting_fornecedor'
    - `signed` and all signers signed → contracts.status = 'signed'; downloadSignedPdf(token) → upload to MinIO at `contracts/{contractId}/signed.pdf`; UPDATE contracts.signed_pdf_minio_key
    - `rejected` → contracts.status = 'cancelled', reason recorded
    - `expired` → contracts.status = 'expired'
  - recordAudit('contract.zapsign_webhook', {event_type, token})
  - On signed (terminal): enqueueJob('email.send-status-update', {contract_id, event: 'contrato_assinado'})
- Always return 200 OK to ZapSign (idempotency by zapsign_documents.zapsign_id + event index)

Write `tests/contracts/zapsign-webhook.test.ts`:
1. Valid Basic Auth + signed event for first signer → status transitions to awaiting_fornecedor
2. Valid Basic Auth + signed event for second signer → status='signed' + signed PDF downloaded + email enqueued
3. Bad Basic Auth → 401
4. Re-fetch returns 'rejected' even though webhook says 'signed' → trust the API (re-fetch wins; contract status not updated)
5. Duplicate webhook delivery (same event index) → idempotent (no double audit row, no double email enqueue)
6. Spoofed webhook with valid Basic Auth but ZapSign API re-fetch fails → 400, status not updated

Commit: `feat(01-05): ZapSign webhook handler with FSM transitions + re-fetch defense + signed PDF download`
</action>
<read_first>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §ZapSign Webhook (event types, payload shape, Basic Auth setup)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Webhook Pitfalls (re-fetch defense, idempotency)
- src/db/schema/contracts.ts (status enum)
- src/lib/storage/minio.ts (putObject for signed PDF)
</read_first>
<acceptance_criteria>
- `pnpm test tests/contracts/zapsign-webhook.test.ts` → 6 tests pass
- Manual sandbox: emit contract → sign as organizadora in ZapSign sandbox → status flips to awaiting_fornecedor → sign as fornecedor → status='signed' → signed PDF appears in MinIO at contracts/{id}/signed.pdf
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
- All Phase 0 + prior Phase 1 tests still pass
</acceptance_criteria>
</task>

<verification>
After 3 tasks: full test suite green. ADR-0002 + ADR-0004 in docs/adr/. Manual sandbox smoke: contract emit → PDF generated → ZapSign send → both signers sign → status='signed' → signed PDF in MinIO → audit trail complete + 2 email jobs (contrato_emitido + contrato_assinado) in queue.
</verification>
