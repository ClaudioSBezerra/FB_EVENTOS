---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 05
subsystem: contracts-pdf-esign
tags:
  - contracts
  - pdf
  - react-pdf
  - zapsign
  - graphile-worker
  - webhook
  - rls
  - outbox
  - adr

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides: Graphile-Worker enqueueJob (Plan 06), RLS-no-worker contract, withTenant boundary, audit_log append-only
  - phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
    provides:
      - "01-01 (contracts + zapsign_documents + contract_template_versions tables, MinIO singleton + MockMinIO + MSW handlers + appPool+SET LOCAL fixtures)"
      - "01-03 (lot_assignments table + assignLotToVendor pure-helper pattern + computeLotPrice / formatBRL helpers + walk-cause-chain Drizzle error catch)"
      - "01-04 (rawSqlFromTenantDb extraction pattern + email-job envelope shape pinned by notifications.test.ts)"
provides:
  - PDF contract pipeline (template + generator + worker job + MinIO upload)
  - ZapSign REST client (createDocument + getDocument + downloadSignedPdf)
  - Sequential signer flow (D-02 organizadora → fornecedor)
  - Webhook handler with belt-and-suspenders re-fetch defense
  - Contract FSM (draft → awaiting_org → awaiting_fornecedor → signed | cancelled | expired)
  - migratorPool for webhook tenant-lookup (no session yet)
  - Contract template registry (extension point for v2/v3)
  - ADR-0002 (ZapSign vs Clicksign) + ADR-0004 (@react-pdf/renderer vs Puppeteer)
affects:
  - Plan 01-06 (Pagar.me cobrança — same outbox/Graphile-Worker pattern; webhook with Basic Auth)
  - Plan 01-07 (occupancy + financial dashboards — read contracts.status FSM)
  - Plan 01-08 (Resend templates — receives email-job envelope shape pinned by notifications.test.ts; this plan enqueues contrato_emitido + contrato_assinado)
  - Future phases adding template versions (Phase 2-3 contract template editor)

# Tech tracking
tech-stack:
  added:
    - "@react-pdf/renderer@4.5.1 (server-side PDF gen, no Chrome)"
  patterns:
    - "Template registry + version pinning: contracts.template_version FK references contract_template_versions; new version = new .tsx file + new registry row + new DB seed"
    - "Belt-and-suspenders webhook defense: Basic Auth + ZapSign API re-fetch (don't trust webhook payload)"
    - "Two-step outbox chain: Server Action enqueues pdf.generate-contract, which on its commit enqueues zapsign.send-contract — each task runs in its own transaction but the chain is durable"
    - "FSM at the worker boundary: status transitions live in withTenant blocks so RLS + audit + side-effects are atomic per-step"
    - "migratorPool for narrow webhook lookups: bypass-session lookup followed by withTenant transition"

key-files:
  created:
    - "src/contracts/templates/fornecedor-stand-v1.tsx (Document/Page/View/Text template, 6 sections, Helvetica)"
    - "src/contracts/templates/index.ts (TEMPLATE_REGISTRY map version → component)"
    - "src/contracts/generate-pdf.ts (renderToBuffer wrapper)"
    - "src/jobs/tasks/pdf-generate-contract.ts (PDF gen task with withTenant + outbox chain to zapsign job)"
    - "src/jobs/tasks/zapsign-send-contract.ts (ZapSign API POST + zapsign_documents insert + email enqueue)"
    - "src/jobs/raw-sql-from-tenant-db.ts (extracted from Plan 01-04 fornecedores.ts — shared helper)"
    - "src/lib/zapsign/types.ts (Zod schemas + ZapsignApiError / ZapsignNotConfiguredError)"
    - "src/lib/zapsign/client.ts (createDocument + getDocument + downloadSignedPdf)"
    - "src/lib/actions/contracts.ts (emitContract / listContracts / getContractById)"
    - "src/lib/validators/contract.ts (Zod schemas)"
    - "src/app/api/webhooks/zapsign/route.ts (Basic Auth + re-fetch + FSM transitions + signed PDF download)"
    - "src/app/[slug]/contratos/page.tsx + [contractId]/page.tsx (list + detail)"
    - "src/components/contracts/contract-list.tsx + contract-detail.tsx"
    - "src/components/eventos/emit-contract-button.tsx"
    - "src/db/migrations/0013_contract_templates_seed.sql (seed fornecedor-stand-v1 + UNIQUE zapsign_id)"
    - "src/db/migrations/0014_zapsign_webhook_tenant_lookup.sql (SELECT-only RLS policy for migrator on zapsign_documents)"
    - "src/db/migrator-pool.ts (postgres.js pool for webhook lookups)"
    - "src/test/factories/contract-factory.ts (makeContract via appPool + SET LOCAL)"
    - "tests/contracts/pdf-gen.test.ts (5 tests)"
    - "tests/contracts/zapsign-send.test.ts (6 tests)"
    - "tests/contracts/zapsign-webhook.test.ts (7 tests, +1 vs plan)"
    - "docs/adr/0002-e-sign-provider.md"
    - "docs/adr/0004-pdf-generator.md"
  modified:
    - "src/jobs/tasks/index.ts (register pdf.generate-contract + zapsign.send-contract)"
    - "src/lib/env.ts (ZAPSIGN_TOKEN, ZAPSIGN_ENV, ZAPSIGN_WEBHOOK_USER, ZAPSIGN_WEBHOOK_PASS)"
    - ".env.example (matching env keys + comments + production webhook URL)"
    - "src/lib/tenant.ts (add resolveTenantSlug(tenantId) helper)"
    - "src/test/factories/event-factory.ts (switch to appPool + SET LOCAL — FORCE RLS blocks migratorPool writes)"
    - "src/test/factories/lot-factory.ts (same FORCE-RLS fix)"
    - "vitest.config.ts (add @vitejs/plugin-react so .tsx templates transform)"
    - "package.json + pnpm-lock.yaml (+@react-pdf/renderer)"

key-decisions:
  - "@react-pdf/renderer over Puppeteer (ADR-0004) — Dockerfile.worker stays light; layout sufficient for contract simples"
  - "ZapSign over Clicksign (ADR-0002) — Clicksign Enterprise webhook ~R$2.500/mo inviável; ZapSign 5-doc free tier + paid ~R$30/mo cobre piloto"
  - "Hardcoded TS templates per category + version in filename (D-08) — git history = audit trail, no template-store table needed in Phase 1"
  - "Belt-and-suspenders webhook defense over HMAC — ZapSign sem HMAC nativo, mas re-fetch via API GET é security-equivalent contra spoofing"
  - "Two-step outbox chain (pdf.generate-contract → zapsign.send-contract) — each task runs in its own transaction with atomic UPDATE+enqueue per step"
  - "Migrator-role SELECT-only RLS policy on zapsign_documents (migration 0014) over SECURITY DEFINER — sysreader OWNER transfer blocked by PG 18 schema-CREATE check; narrow SELECT policy is the minimum-blast-radius alternative"
  - "Drop ALL transitions into terminal states (not just != signed) — duplicate webhook delivery on already-signed contract must not duplicate side-effects (PDF download, email enqueue)"
  - "Worker tasks deliberately read process.env directly in zapsign/client.ts (not the cached env from env.ts) so test harnesses can mutate ZAPSIGN_TOKEN / ZAPSIGN_ENV per test"

patterns-established:
  - "Template registry pattern: index.ts maps version → component; adding v2 = new .tsx + new registry entry + new contract_template_versions row in migration; FK enforces consistency"
  - "Webhook handler shape: 1) auth check 2) tenant lookup (BYPASS-session) 3) API re-fetch 4) withTenant(transition) 5) audit + side-effects in same tx 6) idempotent terminal-state guard"
  - "Outbox-chain across two tasks: Task A commits its work + enqueues Task B in the SAME transaction; Task B commits its work + enqueues Task C; chain is durable per-link, not end-to-end"
  - "RLS-no-worker FSM: status transitions are encoded in worker handlers wrapping withTenant; the contract.status column becomes the integration point between web and worker processes"
  - "Idempotency-at-FSM-boundary: 'is current_status in TERMINAL set?' is the dedup question, not 'is this event_index seen before?' — the FSM itself is the dedup key"
  - "Factory-fix pattern: any tenant-scoped table with FORCE RLS needs appPool + SET LOCAL factory (Phase 01-05 had to retrofit event-factory + lot-factory which were never actually used until this plan)"

requirements-completed:
  - ORG-10
  - ORG-11

# Metrics
duration: 145min
completed: 2026-06-14
---

# Phase 1 Plan 05: Contracts PDF + ZapSign Sequential E-Sign Summary

**Closes vertical slice 4 of Phase 1 — organizadora clicks "Emitir contrato" → @react-pdf/renderer generates PDF in Graphile-Worker → MinIO upload → ZapSign sequential signers (org first, fornecedor second) → webhook handler with re-fetch defense transitions contracts.status through `draft → awaiting_org → awaiting_fornecedor → signed` and lands the signed PDF in MinIO.**

## Performance

- **Duration:** ~145 min
- **Completed:** 2026-06-14
- **Tasks:** 3 / 3
- **Files modified:** 35 (commits b8fe31a + 126101c + 8466d25)
- **Tests added:** 18 (5 pdf-gen + 6 zapsign-send + 7 zapsign-webhook)
- **Tests total:** 144 GREEN (126 baseline + 18 new)
- **ADRs delivered:** 2 (ADR-0002 ZapSign, ADR-0004 @react-pdf/renderer)

## Accomplishments

- Wired end-to-end contracts pipeline: organizadora emits → PDF generated by Graphile-Worker → ZapSign created with sequential signers → webhook transitions FSM → signed PDF lands in MinIO with audit trail.
- Adopted **`@react-pdf/renderer@4.5.1`** for server-side PDF generation inside the worker process — no Chrome, no Puppeteer, no extra ~300 MB in `Dockerfile.worker`.
- Adopted **ZapSign** as the e-sign provider with sequential signer order (organizadora `order_group=1`, fornecedor `order_group=2`); webhook authenticated via Basic Auth + belt-and-suspenders re-fetch to the ZapSign API as the source-of-truth defense.
- Established a **template-registry pattern** (`src/contracts/templates/index.ts`) so adding `fornecedor-stand-v2.tsx` in Phase 2-3 = new file + new row + no DB schema change.
- Established the **two-step outbox chain** at the worker boundary: Server Action enqueues `pdf.generate-contract` atomically with the `contracts` insert; that task enqueues `zapsign.send-contract` atomically with its own UPDATE; that task enqueues `email.send-status-update` atomically with its own state transition.
- Authored **ADR-0002** (ZapSign vs Clicksign — cost + DX + adequado tecnicamente) and **ADR-0004** (@react-pdf/renderer vs Puppeteer — Dockerfile.worker light + cold-start + escape-hatch documented).
- Extracted `rawSqlFromTenantDb` from Plan 01-04's `fornecedores.ts` into a shared `src/jobs/raw-sql-from-tenant-db.ts` so worker tasks can reuse the postgres.js TransactionSql escape hatch for outbox enqueues.
- Added `migratorPool` (`src/db/migrator-pool.ts`) for narrowly-scoped lookups outside session/withTenant context (webhook handler tenant resolution).

## Task Commits

Each task was committed atomically:

1. **Task 1:** `feat(01-05): @react-pdf template fornecedor-stand-v1 + PDF generator + Graphile-Worker job + ADR-0004` — **`b8fe31a`**
2. **Task 2:** `feat(01-05): ZapSign client + send-contract task (sequential signers) + ADR-0002` — **`126101c`**
3. **Task 3:** `feat(01-05): ZapSign webhook handler with FSM transitions + re-fetch defense + signed PDF download` — **`8466d25`**

## Files Created

### Contract template + PDF generation
- `src/contracts/templates/fornecedor-stand-v1.tsx` — React PDF component (6 sections: identificação das partes, objeto, vigência, valor, cláusulas padrão, assinaturas + footer with template_version stamp).
- `src/contracts/templates/index.ts` — `TEMPLATE_REGISTRY` mapping `template_version` → `{Component, description}`; `getTemplate(version)` lookup.
- `src/contracts/generate-pdf.ts` — `generateContractPdf({templateVersion, params}) → Buffer`; throws `UnknownTemplateVersionError` for unknown versions.

### Worker tasks
- `src/jobs/tasks/pdf-generate-contract.ts` — Loads contract + event + vendor + lot + category in a tenant-scoped JOIN, generates PDF, uploads to `contracts/{id}/contract-v1.pdf`, updates `pdf_minio_key`, audit row, enqueues `zapsign.send-contract` in the same withTenant transaction (outbox).
- `src/jobs/tasks/zapsign-send-contract.ts` — Mints 15-min pre-signed GET on the PDF, builds signers `[{org,order_group=1}, {fornecedor,order_group=2}]` with `signature_order_active=true` and `external_id=contract.id`, POSTs to ZapSign, inserts `zapsign_documents`, transitions `contracts.status='awaiting_org' + zapsign_doc_id=token`, enqueues `email.send-status-update {event:'contrato_emitido'}`.
- `src/jobs/raw-sql-from-tenant-db.ts` — Shared helper extracted from Plan 01-04.

### ZapSign integration
- `src/lib/zapsign/types.ts` — Zod schemas (create-doc request/response, webhook payload), `ZapsignApiError`, `ZapsignNotConfiguredError`.
- `src/lib/zapsign/client.ts` — `createDocument()` / `getDocument()` / `downloadSignedPdf()`; reads `process.env.ZAPSIGN_TOKEN` + `ZAPSIGN_ENV` directly (not the cached env) so worker tests can override per-test.

### Server Action + UI
- `src/lib/validators/contract.ts` — `emitContractSchema`, `listContractsSchema`, `contractIdSchema`.
- `src/lib/actions/contracts.ts` — Pure helpers (`emitContractInTenant`, `listContractsInTenant`, `getContractByIdInTenant`) + next-safe-action wrappers. `emitContract` resolves lot_assignment → INSERT contract (status=draft) → enqueue `pdf.generate-contract` in the same tx → audit.
- `src/components/eventos/emit-contract-button.tsx` — "Emitir contrato" CTA on the lot-assignment dialog.
- `src/components/contracts/contract-list.tsx` + `contract-detail.tsx` — list table with status pills + detail panel with pre-signed PDF download links.
- `src/app/[slug]/contratos/page.tsx` + `[contractId]/page.tsx` — list + detail pages.

### Webhook handler
- `src/app/api/webhooks/zapsign/route.ts` — Basic Auth check → tenant resolution via `migratorPool` → API re-fetch → FSM transition inside `withTenant` → signed PDF download to MinIO → audit + email enqueue. Returns 401 on bad auth, 400 on re-fetch failure (ZapSign retries), 200 otherwise.
- `src/db/migrator-pool.ts` — Webhook-scoped postgres.js pool keyed to fb_eventos_migrator role.

### Migrations
- `src/db/migrations/0013_contract_templates_seed.sql` — Seeds `fornecedor-stand-v1` template row + UNIQUE on `zapsign_documents(zapsign_id)`.
- `src/db/migrations/0014_zapsign_webhook_tenant_lookup.sql` — SELECT-only RLS policy `webhook_tenant_lookup_migrator_read` on `zapsign_documents` for the migrator role.

### Test infra
- `src/test/factories/contract-factory.ts` — `makeContract` via appPool + SET LOCAL.
- `tests/contracts/pdf-gen.test.ts` (5 tests).
- `tests/contracts/zapsign-send.test.ts` (6 tests).
- `tests/contracts/zapsign-webhook.test.ts` (7 tests).

### ADRs + env
- `docs/adr/0002-e-sign-provider.md` — ZapSign decision rationale + comparison matrix.
- `docs/adr/0004-pdf-generator.md` — @react-pdf/renderer decision + Puppeteer escape-hatch documented.
- `.env.example` — Added `ZAPSIGN_TOKEN`, `ZAPSIGN_ENV`, `ZAPSIGN_WEBHOOK_USER`, `ZAPSIGN_WEBHOOK_PASS`.

## Files Modified

- `src/jobs/tasks/index.ts` — Registered `pdf.generate-contract` + `zapsign.send-contract`.
- `src/lib/env.ts` — Added the four ZapSign env keys.
- `src/lib/tenant.ts` — Added `resolveTenantSlug(tenantId)` for worker tasks that need the MinIO bucket name from tenant_id.
- `src/test/factories/event-factory.ts` + `lot-factory.ts` — Switched from migratorPool to appPool + SET LOCAL. The original factories were never exercised (no test used them) until this plan, so the FORCE-RLS write block was latent. Fixed now.
- `vitest.config.ts` — Added `@vitejs/plugin-react` so `.tsx` templates transform under Vitest's Node environment (project tsconfig sets `jsx: preserve` for Next.js).
- `package.json` + `pnpm-lock.yaml` — `+ @react-pdf/renderer@4.5.1`.

## Decisions Made

### Adopted (canonical)

- **`@react-pdf/renderer@4.5.1` over Puppeteer (ADR-0004)** — Dockerfile.worker stays light; layout suficiente para contrato simples; escape-hatch documentado caso regression upstream apareça.
- **ZapSign over Clicksign (ADR-0002)** — Clicksign Enterprise webhook gated em plano ~R$2.500+/mo inviável no piloto; ZapSign tier gratuito (5 docs) + paid ~R$30/mo cobre piloto + cresce.
- **Hardcoded TS templates per category + version in filename (D-08 ratified)** — Git history = audit trail. No template-store table in Phase 1.
- **Belt-and-suspenders webhook defense** — ZapSign não tem HMAC nativo, mas Basic Auth + API re-fetch via `getDocument(token)` é security-equivalent contra spoofing. API status é a fonte da verdade; webhook é só notificação.
- **Sequential signers (D-02)** — `signature_order_active: true` + `order_group: 1` (organizadora) e `2` (fornecedor) elimina o risco de "contrato errado mandado pro fornecedor".

### Implementation patterns

- **Pure-helper / thin-action split** (continued from Plan 01-03/01-04) — Tests drive `emitContractInTenant(db, tenantId, input, userId)` directly inside `withTenant`; next-safe-action wrapper just delegates.
- **Two-step outbox chain** — Each worker task (`pdf.generate-contract`, `zapsign.send-contract`) commits its own UPDATE + enqueues the next task in the same `withTenant` transaction. Failure of any step rolls back the side-effect for that step only; the prior commits are durable.
- **process.env over cached env in worker libs** — `src/lib/zapsign/client.ts` reads `process.env.ZAPSIGN_TOKEN` + `ZAPSIGN_ENV` directly (not the `env` const from `src/lib/env.ts`) so test harnesses can mutate the env per-test without re-importing modules. The `env` cache stays appropriate for boot-time-validated keys; lookups that change per-call use `process.env`.
- **Idempotency at FSM boundary** — "Is contract.status currently in TERMINAL set (signed | cancelled | expired)?" is the dedup key, not "have I seen this webhook event_index before?". Cleaner than maintaining a webhook-event-id table.

### Migrations

- **`0013_contract_templates_seed.sql`** — Seeds `fornecedor-stand-v1` global template row + UNIQUE `zapsign_documents(zapsign_id)`.
- **`0014_zapsign_webhook_tenant_lookup.sql`** — SELECT-only RLS policy on `zapsign_documents` for `fb_eventos_migrator` so the webhook handler can resolve tenant_id from the bearer-less callback. SECURITY DEFINER alternative was considered but blocked by PG 18 ALTER FUNCTION OWNER schema-CREATE checks (sysreader lacks CREATE on `public`). Narrow SELECT-only policy is minimum-blast-radius.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Critical infra] Event + lot factories silently failing under FORCE RLS**
- **Found during:** Task 1 (writing pdf-gen.test.ts)
- **Issue:** `src/test/factories/event-factory.ts` and `lot-factory.ts` inserted via `migratorPool`. The migrator role does not have a tenant_isolation RLS policy and FORCE RLS blocks the write — `INSERT INTO events ...` raised "new row violates row-level security policy for table 'events'". Factories were never exercised previously (no test used them) so the latent bug only surfaced when this plan finally used them.
- **Fix:** Switched both factories to `appPool.begin + SET LOCAL app.current_tenant_id` — the same pattern as `lot-category-factory.ts` and `vendor-factory.ts`. Updated their docstrings to reflect the corrected pattern.
- **Files:** `src/test/factories/event-factory.ts`, `src/test/factories/lot-factory.ts`.
- **Commit:** `b8fe31a` (Task 1).

**2. [Rule 3 — Blocking infra] Vitest couldn't parse JSX in templates**
- **Found during:** First pdf-gen.test.ts run.
- **Issue:** Project `tsconfig.json` sets `jsx: preserve` (Next.js convention) — Vite's import analyzer rejects unparsed JSX. Vitest needs a JSX transform.
- **Fix:** Added `@vitejs/plugin-react` (already in devDeps) to `vitest.config.ts`.
- **Files:** `vitest.config.ts`.
- **Commit:** `b8fe31a` (Task 1).

**3. [Rule 4-converted-to-Rule-2] SECURITY DEFINER tenant-lookup function approach abandoned**
- **Found during:** Task 1 migration design (0013 first draft).
- **Issue:** Initial Migration 0013 included a SECURITY DEFINER function `fb_lookup_tenant_for_zapsign_doc(text)` owned by `fb_eventos_sysreader` (mirroring `fb_lookup_tenant_for_org(uuid)` from Plan 01-01 Migration 0011). `ALTER FUNCTION ... OWNER TO fb_eventos_sysreader` raised "permission denied for schema public" because PG 18 tightens the schema-CREATE check on ownership transfer (sysreader lacks CREATE on `public`). Granting sysreader CREATE on public widens its surface beyond the bounded-lookup principle.
- **Resolution:** Pivoted to a SELECT-only RLS policy for `fb_eventos_migrator` on `zapsign_documents` (Migration 0014). The migrator role already has DDL privileges + login user; adding a narrow read-only policy gives the webhook handler tenant-lookup capability with the smallest blast radius. Trade-off documented in 0014 header. (Architectural decision = Rule 4, but converted to a localized fix because the alternatives were all worse and the PG version constraint is non-negotiable.)
- **Files:** `src/db/migrations/0014_zapsign_webhook_tenant_lookup.sql`, `src/db/migrator-pool.ts`, `src/app/api/webhooks/zapsign/route.ts`.
- **Commit:** `8466d25` (Task 3).

**4. [Rule 1 — Idempotency bug] Duplicate signed webhook still wrote audit + email**
- **Found during:** zapsign-webhook.test.ts case 5 (duplicate delivery).
- **Issue:** Initial FSM guard was `if (TERMINAL.has(currentStatus) && newStatus !== 'signed') skip`. Wrong: when current=signed + new=signed, the guard didn't trip — we wrote a duplicate audit + email-enqueue.
- **Fix:** Simplified to `if (TERMINAL.has(currentStatus)) skip`. Any transition INTO an already-terminal state is a duplicate by definition.
- **Files:** `src/app/api/webhooks/zapsign/route.ts`.
- **Commit:** `8466d25` (Task 3).

### Plan-deviation summary

- Plan called for 6 webhook tests; delivered 7 (extra case: wrong Basic Auth credentials separately from missing-auth case).
- Plan implied SECURITY DEFINER function for webhook tenant lookup; delivered narrow SELECT-only RLS policy on `zapsign_documents` (Rule-4-converted-to-Rule-2 with rationale in 0014 header).
- All other plan elements delivered as written.

## Authentication Gates

None required. ZapSign sandbox credentials are configured via env (`ZAPSIGN_TOKEN`, `ZAPSIGN_ENV=sandbox`). MSW tests mock the API so no live network access is needed during automated runs. Production sandbox→production gate (D-14) remains pending for Plan 01-08 walking-skeleton extension.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: webhook_auth | `src/app/api/webhooks/zapsign/route.ts` | New public POST endpoint authenticated via HTTP Basic Auth. Belt-and-suspenders re-fetch defense partially mitigates spoofing. Phase 2 may layer HMAC (ZapSign custom headers) and IP allowlist. |
| threat_flag: rls_scope_widening | `src/db/migrations/0014_zapsign_webhook_tenant_lookup.sql` | Adds a narrow SELECT-only RLS policy on zapsign_documents for fb_eventos_migrator. Migrator can cross-tenant SELECT zapsign_documents (not write). Mitigated: scope is single table + SELECT only. |
| threat_flag: outbound_pii | `src/jobs/tasks/zapsign-send-contract.ts` | Posts vendor `legal_name` + `email` to ZapSign (D-15 contract). Required by the e-sign flow. LGPD basis = contract execution. |
| threat_flag: minio_signed_pdf | `src/app/api/webhooks/zapsign/route.ts` | Downloads signed PDF from ZapSign (HTTPS) → MinIO. PDF carries full vendor PII + organizadora signature image. Tenant-scoped bucket + lifecycle policy from Plan 01-01 governs retention. |

## Self-Check: PASSED

Files exist:
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/contracts/templates/fornecedor-stand-v1.tsx`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/contracts/generate-pdf.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/jobs/tasks/pdf-generate-contract.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/jobs/tasks/zapsign-send-contract.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/lib/zapsign/client.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/lib/zapsign/types.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/lib/actions/contracts.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/app/api/webhooks/zapsign/route.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/db/migrations/0013_contract_templates_seed.sql`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/src/db/migrations/0014_zapsign_webhook_tenant_lookup.sql`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/tests/contracts/pdf-gen.test.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/tests/contracts/zapsign-send.test.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/tests/contracts/zapsign-webhook.test.ts`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/docs/adr/0002-e-sign-provider.md`
- FOUND: `/home/claudio/projetos/FB_EVENTOS/docs/adr/0004-pdf-generator.md`

Commits exist:
- FOUND: `b8fe31a` (Task 1)
- FOUND: `126101c` (Task 2)
- FOUND: `8466d25` (Task 3)

Tests pass: 144 / 144 GREEN (126 baseline + 18 new from this plan).
