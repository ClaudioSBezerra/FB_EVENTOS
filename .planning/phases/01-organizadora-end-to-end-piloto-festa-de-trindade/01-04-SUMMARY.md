---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 04
subsystem: vendor-crud + cnpj-validation + doc-cofre + approval-fsm
tags: [fornecedores, vendor, approval, brasilapi, cnpj, minio-vault, notifications, vertical-slice, lgpd]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "Drizzle 0.45 + postgres.js 3.4 + withTenant() + audit_log FORCE RLS"
      - "Better Auth + safe-action chain (authedAction + withTenantAction)"
      - "Graphile-Worker outbox enqueueJob(tx, ...) — transactional job enqueue"
      - "Pino + Sentry — degraded-API observability hooks"
  - phase: 01 (this phase)
    provides:
      - "01-01: vendors + vendor_documents tables + FORCE RLS + PII comments"
      - "01-01: MinIO server wrapper + in-memory mock + vendor factory + BrasilAPI MSW handlers"
      - "01-02: planta pre-signed PUT/GET pattern (D-05/D-06)"
      - "01-03: pure-helper + thin-action split + walk-cause-chain catch + appPool+SET LOCAL audit reads"
provides:
  - "src/db/schema/cnpj-cache.ts + migration 0012_cnpj_lookup_cache: global cross-tenant cache (no RLS — public data); INSERT … ON CONFLICT (cnpj) DO UPDATE refresh path"
  - "src/lib/validators/cnpj.ts: cnpjSchema (regex + mod-11 DV via Zod) + normalizeCNPJ + formatCNPJ + redactCNPJ — Layer 1 client validation"
  - "src/lib/validators/vendor.ts: vendorCreate/vendorUpdate/vendorApproval/vendorListInput Zod schemas (PII-annotated)"
  - "src/lib/actions/brasilapi.ts: lookupCNPJ Server Action (authedAction) + lookupCNPJCore pure helper — Layer 2 with 7-day cache, AbortController 5s timeout, degrade-with-warning, audit with redacted CNPJ"
  - "src/lib/actions/fornecedores.ts: createVendor + updateVendor + approveVendor + rejectVendor + listVendors + getVendorById (withTenantAction, pure-helper split, walk-cause patterns, audit, email job enqueue)"
  - "src/lib/actions/vendor-docs.ts: mintVendorDocUploadUrl + confirmVendorDocUpload + mintVendorDocDownloadUrl (audit on EVERY download) + deleteVendorDoc + listVendorDocs (withTenantAction, pure-helper split)"
  - "src/components/fornecedores/{cnpj-input,vendor-form,vendor-list,vendor-approval-panel,vendor-doc-uploader,vendor-doc-list}.tsx"
  - "src/app/[slug]/fornecedores/{page,novo/page,[vendorId]/page}.tsx (list + filter chips + form + detail with approval + doc cofre)"
  - "5 test files / 25 new tests covering BrasilAPI, vendor CRUD, approval FSM, doc cofre, notification enqueue"
  - "Email job stub: enqueueJob('email.send-status-update', {tenant_id, vendor_id, event, legal_name, email, reason?}) — handler lands in 01-08"
affects:
  - 01-05-contracts: emitContract takes vendor.status='approved' as gate (FSM owned here); vendor identity (legal_name, email) sourced from vendors row
  - 01-06-pagarme: Pagar.me recipient onboarding payloads reuse vendor's CNPJ + verified-by-BrasilAPI flag
  - 01-07-dashboards: listVendorsInTenant feeds the "fornecedores cadastrados / aprovados" card
  - 01-08-emails: implements the `email.send-status-update` graphile-worker handler consuming the canonical envelope shape pinned by notifications.test.ts

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "2-layer CNPJ validation (D-16): cnpjSchema Layer 1 + lookupCNPJCore Layer 2 with 7-day cnpj_lookup_cache; only ATIVA responses cached; degraded calls return {verified:null, source:'degraded'} so the form proceeds with cnpj_verified=false"
    - "Audit redaction: cnpj_redacted (last 4 digits via redactCNPJ) lands in audit_log payload — full CNPJ NEVER persisted to audit table"
    - "Email job enqueue via raw postgres.js TransactionSql extracted from Drizzle TenantDb (rawSqlFromTenantDb session.client) so add_job lands atomically inside the same tx as the business UPDATE (outbox pattern from Plan 0-06)"
    - "Global cache table without RLS: cnpj_lookup_cache shares public Receita Federal data cross-tenant; the no-RLS decision is documented in the table COMMENT ON TABLE so future contributors don't 'fix' it"
    - "Download-audit-on-every-call (LGPD): mintVendorDocDownloadUrl writes an audit_log row before returning the URL; if download is the contract, the audit row IS the contract"
    - "Pre-signed PUT key-extension lock from Plan 01-02 reused on vendor docs: confirm re-derives expected content-type from key.extension and rejects mismatches by removeObject + throw"
    - "Cross-tenant audit pollution prevention: cross-tenant download attempts throw BEFORE recordAudit so the victim tenant's audit_log doesn't get spammed (verified by doc-vault.test.ts)"

# Key files
key-files:
  created:
    - "src/lib/validators/vendor.ts (vendor Zod schemas including approval refine)"
    - "src/lib/actions/brasilapi.ts (lookupCNPJ + lookupCNPJCore + cache mgmt + audit)"
    - "src/lib/actions/fornecedores.ts (createVendor/updateVendor/approveVendor/rejectVendor/listVendors/getVendorById)"
    - "src/lib/actions/vendor-docs.ts (mintVendorDocUploadUrl/confirmVendorDocUpload/mintVendorDocDownloadUrl/deleteVendorDoc/listVendorDocs)"
    - "src/components/fornecedores/cnpj-input.tsx"
    - "src/components/fornecedores/vendor-form.tsx"
    - "src/components/fornecedores/vendor-list.tsx"
    - "src/components/fornecedores/vendor-approval-panel.tsx"
    - "src/components/fornecedores/vendor-doc-uploader.tsx"
    - "src/components/fornecedores/vendor-doc-list.tsx"
    - "src/app/[slug]/fornecedores/page.tsx (list with status filter chips)"
    - "src/app/[slug]/fornecedores/novo/page.tsx"
    - "src/app/[slug]/fornecedores/[vendorId]/page.tsx (detail + approval + doc cofre)"
    - "tests/fornecedores/brasilapi.test.ts (6 cases)"
    - "tests/fornecedores/list.test.ts (3 cases)"
    - "tests/fornecedores/approval.test.ts (6 cases)"
    - "tests/fornecedores/doc-vault.test.ts (6 cases)"
    - "tests/fornecedores/notifications.test.ts (4 cases)"
  modified:
    - "(none — Task 1 partial commit df1378f already had src/db/schema/cnpj-cache.ts + migration 0012 + src/lib/validators/cnpj.ts; this plan completed on top of it without touching them)"

decisions:
  - "D-16 (Phase 1 CONTEXT) materialized: 2-layer CNPJ validation with degrade-with-warning AS THE DEFAULT — never block on BrasilAPI 5xx"
  - "Email task name pinned: `email.send-status-update` — exported as EMAIL_STATUS_UPDATE_TASK constant so 01-08 handler registration uses the same identifier"
  - "Email payload envelope pinned: `{tenant_id, vendor_id, event: 'signup_fornecedor'|'aprovacao_fornecedor'|'rejecao_fornecedor', legal_name, email, reason?}` — locked by notifications.test.ts so 01-08 handler ships against a structural contract"
  - "MinIO key prefix for vendor docs: `vendor-docs/{vendorId}/{cryptoRandom16}-{sanitizeFileName}.{ext}` — matches the planta pattern; extension is forced from declared content-type so confirm can re-derive"
  - "Document soft-delete: deleted_at stamps the row; MinIO object stays for Lifecycle-policy reaping. Hard physical purge deferred to Phase 4 LGPD direito-ao-esquecimento job"
  - "Cross-tenant doc download attempts throw BEFORE recordAudit — victim tenant's audit_log is not polluted by attacker attempts (only successful within-tenant downloads are logged)"

metrics:
  duration_minutes: 80
  tasks: 3
  files_created: 18
  files_modified: 1  # detail page wiring up doc components from Task 3
  tests_added: 25
  commits:
    - "df1378f (pre-existing) — docs(state): pause Phase 1 at plan 01-04 Task 1 partial (CNPJ validators + cache schema only)"
    - "db2f2c8 feat(01-04): BrasilAPI lookup Server Action with 7-day cache + degrade-with-warning (Task 1 completion)"
    - "809d393 feat(01-04): vendor CRUD + approval FSM + CNPJ live validation + audit + email job enqueue (Task 2)"
    - "e77d61f feat(01-04): vendor doc cofre with pre-signed PUT/GET + audit-on-download + notification stub (Task 3)"
  completed_at: 2026-06-14

---

# Phase 01 Plan 04: Fornecedor CRUD + Approval + Vault + BrasilAPI Summary

**Vertical slice 3 of Phase 1** — Organizadora CRUDs fornecedores end-to-end:
validates CNPJ via BrasilAPI with graceful degradation, approves/rejects them
through a pending→approved|rejected FSM, manages a document cofre via
pre-signed PUT/GET, and emits email job stubs for the 01-08 notification
handler. Delivers ORG-07, ORG-08, ORG-15, ORG-16; ORG-17 templates wire in
01-08 against the canonical envelope this plan pins.

## Tasks completed (3/3)

### Task 1 — BrasilAPI lookup Server Action with 7-day cache + degrade
Committed: `db2f2c8` (extending the pre-paused partial `df1378f` that had
cnpj-cache schema + migration 0012 + cnpj.ts validators).

- `src/lib/actions/brasilapi.ts` — `lookupCNPJ` (authedAction; NOT
  withTenantAction since the cache is global) + `lookupCNPJCore` pure
  helper. Reads `cnpj_lookup_cache` for ATIVA-within-7d hits; falls back to
  BrasilAPI via `fetch` with AbortController 5s timeout. ATIVA responses
  upsert via `INSERT … ON CONFLICT (cnpj) DO UPDATE`. Non-ATIVA / 404 / 5xx
  / timeout / network errors are NEVER cached so the next call gets a
  fresh result. Audit row uses `redactCNPJ` (last 4 digits only) and
  best-effort tenant scoping via `fetchTenantIdForOrg(ctx.orgId)`.
- `tests/fornecedores/brasilapi.test.ts` — 6 cases:
  ACTIVE → verified=true (cached), BAIXADA → verified=false (NOT cached),
  404 → reason='not_found', 5xx → degraded, timeout (controlled via
  10s-stall MSW handler) → degraded, cache-hit-no-rehit proven via a
  request counter.

### Task 2 — Vendor CRUD + approval FSM + form with CNPJ live validation
Committed: `809d393`.

- `src/lib/validators/vendor.ts` — vendorCreate / vendorUpdate /
  vendorApproval (refine: reject requires reason) / vendorListInput.
- `src/lib/actions/fornecedores.ts` — 6 actions following the pure-helper
  + thin-action split established in 01-03:
  - `createVendor` runs Layer 2 lookup inline; persists cnpj_verified
    from the lookup result; on degraded BrasilAPI the row goes in with
    cnpj_verified=false (D-16 contract).
  - `approveVendor` / `rejectVendor` UPDATE with `WHERE status='pending'`
    guard; on miss they read the existing status and throw a UX-friendly
    "Fornecedor já está em status X" — concurrent-transition safe.
  - Every status mutation enqueues `email.send-status-update` via
    `enqueueJob(rawSqlFromTenantDb(db), …)` — the postgres.js
    TransactionSql is extracted from the Drizzle TenantDb via
    `session.client` so the job INSERT lands in the same tx as the
    UPDATE (outbox).
  - `listVendors` supports status filter + case-insensitive
    legal_name/trade_name/cnpj search (digit-normalized CNPJ ilike).
- `src/components/fornecedores/cnpj-input.tsx` — masks XX.XXX.XXX/XXXX-XX,
  runs Layer 1 inline on blur, then fires Layer 2 Server Action with
  verified ✓ / inactive ✗ / degraded ⚠ badge surface.
- `src/components/fornecedores/{vendor-form,vendor-list,vendor-approval-panel}.tsx`
  RHF + zodResolver + Controller for the CNPJ field; list with status
  chip; approval panel with inline reject reason form.
- Pages `/[slug]/fornecedores`, `/novo`, `/[vendorId]` with the standard
  session + tenant + active-org guard pattern from 01-02 / 01-03.
- `tests/fornecedores/list.test.ts` — 3 cases (RLS isolation, status
  filter, search by name/CNPJ).
- `tests/fornecedores/approval.test.ts` — 6 cases (approve happy + audit
  + email job; reject happy + reason + email job; idempotent already-
  approved guard; Zod reject-without-reason rejected; defensive helper
  empty-reason guard; cross-tenant RLS block with appPool+SET LOCAL
  verification).

### Task 3 — Vendor doc cofre + notification stub
Committed: `e77d61f`.

- `src/lib/actions/vendor-docs.ts` — 5 actions:
  - `mintVendorDocUploadUrl` (TTL 5min PUT, content-type lock by key
    extension matching declared MIME).
  - `confirmVendorDocUpload` runs `statObject` to verify content-type +
    size; mismatch → `removeObject` orphan delete + throw; success →
    INSERT vendor_documents + audit.
  - `mintVendorDocDownloadUrl` (TTL 15min GET) writes an audit_log row
    on EVERY call carrying actor + doc + ip — the LGPD access trail.
  - `deleteVendorDoc` soft-deletes + audit (MinIO object retained for
    Lifecycle policy + forensic restore).
  - `listVendorDocsInTenant` for the detail page.
- `src/components/fornecedores/{vendor-doc-uploader,vendor-doc-list}.tsx`
  Browser 3-step flow (mint → PUT → confirm) for upload; per-row Baixar
  triggers Server Action to mint GET URL + opens in new tab; Remover
  triggers soft-delete.
- Detail page `/[slug]/fornecedores/[vendorId]/page.tsx` now wires up
  `<VendorDocUploader/>` + `<VendorDocList/>` below the approval panel
  (replacing the Task 2 stub comment).
- `tests/fornecedores/doc-vault.test.ts` — 6 cases (PUT TTL + key shape,
  confirm + persist + audit, download writes 2 audit rows with distinct
  IPs for 2 calls, cross-tenant RLS block + no audit pollution,
  content-type mismatch orphan delete, soft-delete with audit).
- `tests/fornecedores/notifications.test.ts` — 4 cases asserting the
  canonical email job envelope pinned for 01-08 (`signup_fornecedor` /
  `aprovacao_fornecedor` / `rejecao_fornecedor` events all carry
  `{tenant_id, vendor_id, event, legal_name, email, reason?}`).

## Quality gates

- `pnpm test --run` → **31 files, 126 tests, 0 failures** (101 baseline + 25 new — exceeds the planned ≥24 new)
- `pnpm tsc --noEmit` → 0
- `pnpm lint` → 0 errors, 2 pre-existing warnings (one in `src/lib/actions/minio-presign.ts` from Plan 01-02, one elsewhere — none from this plan's files)
- `pnpm check:all` → 0
- `pnpm db:migrate` → 0012 idempotent (no-op on re-run, validates schema is stable)
- Phase 0 RLS contract tests still GREEN (no regressions in `tests/db/` or `tests/lgpd/`)

## Deviations from Plan

None — plan executed exactly as written.

The Task 1 partial state (`df1378f` from the prior socket-error-recovery
pause) was honored exactly: cnpj-cache schema, migration 0012, and the
cnpj.ts Layer 1 validators were left untouched, and Task 1's completion
just added the BrasilAPI Server Action + tests on top.

## Issues encountered

- **Default `BRASILAPI_CNPJ_ACTIVE.cnpj` fixture (`12345678000190`)
  has an invalid mod-11 checksum.** Plan 01-01 minted it before the
  Layer 1 validator landed. Tests that drive `lookupCNPJCore` (which
  runs Layer 1 first) use checksum-valid CNPJs (`12345678000195` for
  ACTIVE; `11222333000181` for the cache-hit case) and `mocks.brasilapiReturn`
  echoes them back. The vendor-factory bypass (`STUB_CNPJ = '12345678000190'`
  via raw SQL INSERT) is unchanged — it doesn't pass through Zod, so the
  invalid checksum doesn't matter there.
- **`graphile_worker.jobs` public VIEW omits `payload`**. The view exposes
  `task_identifier`, `run_at`, etc., but not the JSONB payload. Tests that
  assert on the enqueue contract JOIN `graphile_worker._private_jobs` ↔
  `graphile_worker._private_tasks` to read it.
- **`vendors` has FORCE RLS so the migrator role gets 0 rows on
  unscoped SELECT.** The cross-tenant approval test (Task 2) verifies
  vendor A's row stays pending by reading via `appPool.begin` with
  `SET LOCAL app.current_tenant_id=tenantAId` — same pattern as the
  Plan 01-03 audit-log reads.

## Carryover for next plan (01-05 Contracts)

- `vendors.status='approved'` is wired and audited; emission of a
  contract should take a `lotAssignmentId` and confirm the joined vendor
  is approved (RLS + vendor.status check already verified in Plan 01-03's
  assignLotToVendorInTenant — Plan 01-05 reuses that guard).
- `vendor_documents.minio_key` keys are scoped under
  `vendor-docs/{vendorId}/…` — Plan 01-05 contract PDFs can reuse the
  pre-signed PUT helper pattern in `src/lib/storage/minio.ts` with a
  separate prefix `contracts/{contractId}/…`.
- Email job task name `email.send-status-update` is exported as a
  constant `EMAIL_STATUS_UPDATE_TASK` from
  `src/lib/actions/fornecedores.ts`; Plan 01-08 will register the
  handler against this exact identifier. Two more events expected from
  contracts: `contrato_emitido` and `contrato_assinado` (D-15).
- `lookupCNPJCore` is exported and pure — Plan 01-06 Pagar.me recipient
  onboarding can call it directly if needed without re-fetching from
  BrasilAPI (cache amortizes).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: pii-egress | src/lib/actions/brasilapi.ts | BrasilAPI returns razão social, endereço, email, telefone — full Receita Federal record. The Server Action returns the full payload to the client at sign-up. Mitigation: payload is destined for the form preview only; only `cnpj_verified` boolean and `cnpj_checked_at` timestamp persist to `vendors` (full payload lives only in `cnpj_lookup_cache` which has no PII columns from our tenant). Phase 4 should add a `select=razao_social,situacao_cadastral` projection step. |
| threat_flag: download-link-leakage | src/lib/actions/vendor-docs.ts | Pre-signed GET URLs are time-bound (15min TTL) but ANY holder of the URL can download — there's no per-request authentication on MinIO. Mitigation in place: audit row on EVERY mint, TTL ceiling, MinIO Lifecycle policy for object purge. Phase 4 should add object-key rotation on download to invalidate leaked URLs.|

## Self-Check: PASSED

- All 25 new tests pass (brasilapi 6 + list 3 + approval 6 + doc-vault 6 + notifications 4).
- All 101 baseline tests (Phase 0 + Plans 01-01/02/03) still pass — zero regression.
- 4 ORG requirements addressed: ORG-07 (vendor CRUD), ORG-08 (approval FSM), ORG-15 (doc cofre), ORG-16 (CNPJ 2-layer). ORG-17 envelope pinned for 01-08.
- All Task commits exist in `git log`:
  - `db2f2c8` Task 1 BrasilAPI Server Action
  - `809d393` Task 2 vendor CRUD + approval FSM
  - `e77d61f` Task 3 doc cofre + notifications
- All claimed files exist on disk (verified via Bash `[ -f path ]` style during the task).

---
*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Completed: 2026-06-14*
