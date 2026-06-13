---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 04
type: execute
wave: 3
depends_on:
  - "01-02"
autonomous: true
requirements:
  - ORG-07
  - ORG-08
  - ORG-15
  - ORG-16
requirements_addressed:
  - ORG-07
  - ORG-08
  - ORG-15
  - ORG-16
tags:
  - fornecedores
  - vendor
  - approval
  - brasilapi
  - cnpj
  - minio-vault
  - vertical-slice
must_haves:
  truths:
    - "Organizadora can CRUD fornecedores via /[slug]/fornecedores with name (razão social PII), trade name, CNPJ, email/phone (PII), and bulk doc upload to MinIO cofre (vendor-docs/{vendorId}/ prefix)"
    - "CNPJ validation runs in 2 layers: (a) client regex (format + check digits) at submit, (b) Server Action lookup to BrasilAPI /cnpj/v1/:cnpj that confirms active situation; on 404 reject; on 5xx degrade-with-warning (vendors.cnpj_verified=false, audit_log captures the degradation)"
    - "BrasilAPI lookups are cached in cnpj_lookup_cache table for 7 days (success only — never cache failures) to respect rate limits and recover gracefully"
    - "Approval FSM: pending → approved | rejected (terminal). Transition records audit row + enqueues Resend email job (template fires in 01-08; here we just call enqueueJob with the right task name)"
    - "Vendor doc cofre: pre-signed PUT direct browser→MinIO (TTL 5min); pre-signed GET for organizadora download (TTL 15min, every download generates an audit_log row identifying the actor + doc + ip)"
    - "All vendor PII columns carry COMMENT ON COLUMN 'PII:legal_name|cnpj|email|phone|address' (Plan 01-01 added these; verify intact)"
files_modified:
  - src/app/[slug]/fornecedores/page.tsx
  - src/app/[slug]/fornecedores/novo/page.tsx
  - src/app/[slug]/fornecedores/[vendorId]/page.tsx
  - src/components/fornecedores/vendor-form.tsx
  - src/components/fornecedores/vendor-list.tsx
  - src/components/fornecedores/cnpj-input.tsx
  - src/components/fornecedores/vendor-approval-panel.tsx
  - src/components/fornecedores/vendor-doc-uploader.tsx
  - src/components/fornecedores/vendor-doc-list.tsx
  - src/lib/actions/fornecedores.ts
  - src/lib/actions/vendor-docs.ts
  - src/lib/actions/brasilapi.ts
  - src/lib/validators/vendor.ts
  - src/lib/validators/cnpj.ts
  - src/db/schema/cnpj-cache.ts
  - src/db/migrations/0012_cnpj_cache.sql
  - tests/fornecedores/list.test.ts
  - tests/fornecedores/approval.test.ts
  - tests/fornecedores/doc-vault.test.ts
  - tests/fornecedores/brasilapi.test.ts
  - tests/fornecedores/notifications.test.ts
---

<objective>
Vertical slice 3 of Phase 1. Organizadora CRUDs fornecedores, validates CNPJ via BrasilAPI with graceful degradation, approves/rejects them, and manages the document cofre via pre-signed PUT/GET. Delivers ORG-07, ORG-08, ORG-15, ORG-16 (ORG-17 email templates are wired in 01-08).
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md (D-04/05/06 MinIO; D-16 BrasilAPI 2-layer + degradation)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §BrasilAPI shape + §Pitfalls (rate limit, situação cadastral parsing) + §MinIO Pre-signed GET TTL
- src/db/schema/vendors.ts (Plan 01-01)
- src/lib/storage/minio.ts (Plan 01-01)
- src/lib/actions/minio-presign.ts (Plan 01-02 — pattern reference)
- src/jobs/enqueue.ts (Plan 0-06 — for the email enqueue stub)
</files_to_read>

<task id="1" name="CNPJ validators + BrasilAPI lookup with 7-day cache + degradation">
<action>
Create `src/lib/validators/cnpj.ts`:
- `cnpjRegex` matching XX.XXX.XXX/XXXX-XX OR 14 digits raw
- `validateCheckDigits(cnpj)` — pure function applying mod-11 checksum
- Zod `cnpjSchema` combining both

Migration `src/db/migrations/0012_cnpj_cache.sql` — create `cnpj_lookup_cache` table:
- cnpj text primary key (14 digits normalized)
- payload jsonb not null (BrasilAPI response)
- cached_at timestamptz not null default now()
- Index on cached_at for cleanup
- Grant SELECT/INSERT to fb_eventos_app (NO RLS — cache is global cross-tenant, BrasilAPI data is public)

Create `src/db/schema/cnpj-cache.ts` (Drizzle table).

Create `src/lib/actions/brasilapi.ts` — `lookupCNPJ(cnpj)` Server Action (NOT withTenantAction since cache is global; uses `authedAction` so unauthenticated cannot DOS-call):
1. Normalize cnpj to 14 digits
2. Check cnpj_lookup_cache for cached_at within last 7 days → if hit, return payload + `{ source: 'cache' }`
3. Call BrasilAPI `/cnpj/v1/:cnpj`:
   - 200 with `situacao_cadastral === 'ATIVA'` → cache + return `{ verified: true, source: 'brasilapi', data }`
   - 200 with non-ATIVA → return `{ verified: false, source: 'brasilapi', reason: situacao_cadastral }` (don't cache; status may change)
   - 404 → return `{ verified: false, source: 'brasilapi', reason: 'not_found' }`
   - 5xx or timeout (>5s) → return `{ verified: null, source: 'degraded', reason: '...' }` — caller decides to accept with `cnpj_verified=false`
4. recordAudit('cnpj.lookup', {cnpj_redacted, source, verified, reason}) — keep cnpj in audit redacted (last 4 digits only) since cnpj_redacted is not PII

Write `tests/fornecedores/brasilapi.test.ts` using external-mocks:
1. Active CNPJ → verified=true; subsequent call within 7d hits cache
2. Inactive CNPJ → verified=false; not cached
3. 404 → verified=false, reason='not_found'
4. 5xx → verified=null, reason='degraded'
5. Timeout (5+s) → verified=null, reason='degraded'
6. Cache hit returns source='cache' and doesn't call BrasilAPI again (assert MSW counter)

Commit: `feat(01-04): BrasilAPI CNPJ lookup with 7-day cache + degradation handling`
</action>
<read_first>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §BrasilAPI (exact endpoint, response shape, situacao_cadastral enum)
- src/lib/actions/safe-action.ts (authedAction vs withTenantAction)
- src/test/external-mocks.ts (Plan 01-01 — BrasilAPI mock handlers)
- src/lib/audit.ts
</read_first>
<acceptance_criteria>
- `pnpm test tests/fornecedores/brasilapi.test.ts` → 6 tests pass
- `pnpm db:migrate` applies 0012 idempotently
- cnpj_lookup_cache table exists with no RLS (it's public data)
- `pnpm tsc --noEmit && pnpm lint` exit 0
</acceptance_criteria>
</task>

<task id="2" name="Vendor CRUD + approval FSM + form with CNPJ live validation">
<action>
Create `src/lib/validators/vendor.ts` with Zod schemas:
- `vendorCreateSchema` — legal_name (PII), trade_name (optional), cnpj (using cnpjSchema), email (email), phone (BR phone regex), address (optional PII)
- `vendorUpdateSchema` — partial; id required
- `vendorApprovalSchema` — vendorId + action enum('approve','reject') + reason text (required on reject)

Create `src/lib/actions/fornecedores.ts` — withTenantAction:
- `createVendor(input)` — Zod parse → call lookupCNPJ → store cnpj_verified bool from result → INSERT vendors row with status='pending' → recordAudit('vendor.created') → enqueueJob('email.send-status-update', {vendor_id, event: 'signup_fornecedor'}) (job processed by 01-08)
- `updateVendor(input)` — Zod parse → UPDATE → recordAudit
- `approveVendor({vendorId, reason?})` — checks status='pending' → UPDATE SET status='approved' → recordAudit('vendor.approved') → enqueueJob('email.send-status-update', {vendor_id, event: 'aprovacao_fornecedor'})
- `rejectVendor({vendorId, reason})` — checks status='pending' → UPDATE SET status='rejected', approval_reason=reason → recordAudit('vendor.rejected') → enqueueJob('email.send-status-update', {vendor_id, event: 'rejecao_fornecedor', reason})
- `listVendors({statusFilter?})` — RLS-scoped SELECT with optional status filter

Create `src/components/fornecedores/cnpj-input.tsx` — client component:
- Masks input as XX.XXX.XXX/XXXX-XX
- Client-side validateCheckDigits on blur
- On valid CNPJ: calls lookupCNPJ Server Action; shows badge "✓ Verificado: razão social X" or "⚠ Não verificado (degraded — você pode prosseguir)" or "✗ CNPJ inativo/inexistente"

Create `src/components/fornecedores/vendor-form.tsx` (RHF + zodResolver(vendorCreateSchema)).

Create `src/components/fornecedores/vendor-list.tsx` — Server Component, filter chip for status (pendente/aprovado/rejeitado).

Create `src/components/fornecedores/vendor-approval-panel.tsx` — Approve / Reject buttons (Reject opens a dialog asking for reason).

Pages: `/[slug]/fornecedores/page.tsx` (list), `/[slug]/fornecedores/novo/page.tsx` (form), `/[slug]/fornecedores/[vendorId]/page.tsx` (detail + approval + docs from Task 3).

Write `tests/fornecedores/list.test.ts`:
1. listVendors returns only current tenant's vendors
2. Status filter works
3. Search by trade_name / CNPJ

Write `tests/fornecedores/approval.test.ts`:
1. Approve transitions pending→approved + audit row
2. Approve already-approved fails (idempotent error)
3. Reject without reason fails (Zod)
4. Reject records reason
5. Approve enqueues email job with event='aprovacao_fornecedor' (assert via job table query)
6. Tenant B cannot approve tenant A's vendor (RLS)

Commit: `feat(01-04): vendor CRUD + approval FSM + CNPJ live validation + audit + email job enqueue`
</action>
<read_first>
- src/db/schema/vendors.ts (Plan 01-01)
- src/lib/actions/eventos.ts (Plan 01-02 — pattern reference for withTenantAction)
- src/components/eventos/event-form.tsx (RHF + zodResolver example)
- src/jobs/enqueue.ts (Plan 0-06 — enqueueJob signature)
</read_first>
<acceptance_criteria>
- `pnpm test tests/fornecedores/list.test.ts tests/fornecedores/approval.test.ts` → 9+ tests pass
- Manual: create vendor with valid CNPJ → "✓ Verificado" badge; with invalid CNPJ → "✗ CNPJ inativo"; with valid CNPJ during BrasilAPI 5xx (mock) → "⚠ Não verificado (degraded)" + cnpj_verified=false in DB
- Audit log has rows for vendor.created, vendor.approved, vendor.rejected
- graphile_worker.jobs has 3 enqueued email jobs after the 3 status transitions
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
</acceptance_criteria>
</task>

<task id="3" name="Vendor doc cofre — pre-signed PUT + GET + audit on download">
<action>
Create `src/lib/actions/vendor-docs.ts` — withTenantAction:
- `mintVendorDocUploadUrl({vendorId, fileName, contentType, sizeBytes})` — verify vendor in tenant; key = `vendor-docs/${vendorId}/${cryptoRandom(16)}-${sanitize(fileName)}`; pre-signed PUT TTL 5min; allowed content-types = PDF/PNG/JPG (≤25 MB)
- `confirmVendorDocUpload({vendorId, key, docType})` — statObject verification (content-type, size); INSERT vendor_documents (vendor_id, minio_key, content_type, size_bytes, doc_type); recordAudit('vendor.doc_uploaded')
- `mintVendorDocDownloadUrl({docId})` — verify doc in tenant; pre-signed GET TTL 900s; recordAudit('vendor.doc_downloaded', {doc_id, actor_user_id, ip}) — this is the LGPD-relevant access trail
- `deleteVendorDoc({docId})` — soft-delete + recordAudit

Create `src/components/fornecedores/vendor-doc-uploader.tsx` and `src/components/fornecedores/vendor-doc-list.tsx`. Doc list shows filename, type, size, upload date, and "Baixar" button that calls mintVendorDocDownloadUrl and `window.open(url)`.

Add the uploader + list to `/[slug]/fornecedores/[vendorId]/page.tsx`.

Write `tests/fornecedores/doc-vault.test.ts`:
1. Upload+confirm flow stores doc in DB and verifiable via statObject
2. Download URL works once, expires after TTL (use mock clock)
3. Each download generates an audit_log row identifying actor + doc + ip
4. Wrong content-type upload rejected (.exe disguised as .pdf)
5. Tenant B cannot download tenant A's doc (RLS)

Also write `tests/fornecedores/notifications.test.ts` — stub for ORG-17 (verifies the enqueue payload shape for the 3 vendor status emails). The actual email send + templates land in 01-08; this test asserts that:
1. createVendor enqueues `email.send-status-update` with event='signup_fornecedor'
2. approveVendor enqueues with event='aprovacao_fornecedor'
3. rejectVendor enqueues with event='rejecao_fornecedor' and reason field
4. Each enqueued job carries vendor_id + tenant_id in payload

Commit: `feat(01-04): vendor doc cofre with pre-signed PUT/GET + audit-on-download + notification stub`
</action>
<read_first>
- src/lib/actions/minio-presign.ts (Plan 01-02 — pre-signed pattern)
- src/db/schema/vendors.ts (vendor_documents table)
- src/lib/audit.ts
- src/jobs/enqueue.ts
</read_first>
<acceptance_criteria>
- `pnpm test tests/fornecedores/doc-vault.test.ts tests/fornecedores/notifications.test.ts` → 9+ tests pass
- Manual: upload 2 PDFs for a vendor; download one; audit_log has the download row with ip + actor
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
- All Phase 0 + Plans 01-01/02/03 tests still pass
</acceptance_criteria>
</task>

<verification>
After all 3 tasks: full test suite green. Manual: organizadora creates vendor with valid CNPJ (live BrasilAPI call works in dev against the real endpoint with a known CNPJ; in test env uses mock); uploads 2 docs; approves vendor; sees audit trail + 4 email jobs in queue (will be processed by 01-08).
</verification>
