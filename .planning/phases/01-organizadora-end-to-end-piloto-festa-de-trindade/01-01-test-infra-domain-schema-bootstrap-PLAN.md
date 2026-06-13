---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: []
requirements_addressed: []
tags:
  - foundation
  - test-infra
  - minio
  - drizzle
  - schema
  - rls
must_haves:
  truths:
    - "Wave 0 test harness exists: external-mocks (ZapSign + Pagar.me + BrasilAPI + Resend), minio-test (in-memory mock with statObject + pre-signed PUT/GET semantics), and 3 factories (event, vendor, lot) — all consumable by tests/eventos, tests/lotes, tests/fornecedores, tests/contracts, tests/payments"
    - "MinIO container runs in docker/compose.yml; bucket-per-tenant bootstrap script creates {tenant_slug}-uploads bucket + Lifecycle policy; docker/coolify/minio.service.md documents production deploy"
    - "Domain schema migrations 0010-0011 create 10 tables (events, lot_categories, lots, vendors, vendor_documents, vendor_applications, lot_assignments, contracts, contract_template_versions, payments, pagarme_orders, zapsign_documents) with tenant_id NOT NULL, FORCE RLS, COMMENT ON COLUMN 'PII:...' on every sensitive column, and append-only GRANT on audit_log derivatives"
    - "Better Auth setActiveOrganization hook wires session.tenant_id = organization.tenant_id on org selection (Plan 0-04 left this TBD; Phase 1 owns the wiring)"
    - "All RLS contract tests from Phase 0 (rls-forced, role-no-bypassrls, with-tenant) still pass after the new tables land"
files_modified:
  - src/test/external-mocks.ts
  - src/test/minio-test.ts
  - src/test/factories/event-factory.ts
  - src/test/factories/vendor-factory.ts
  - src/test/factories/lot-factory.ts
  - src/db/schema/events.ts
  - src/db/schema/lots.ts
  - src/db/schema/vendors.ts
  - src/db/schema/contracts.ts
  - src/db/schema/payments.ts
  - src/db/schema/index.ts
  - src/db/migrations/0010_phase1_domain_tables.sql
  - src/db/migrations/0011_phase1_force_rls.sql
  - src/lib/storage/minio.ts
  - src/lib/auth/set-active-org.ts
  - src/auth/server.ts
  - package.json
  - pnpm-lock.yaml
  - docker/compose.yml
  - docker/coolify/minio.service.md
  - scripts/minio/setup-buckets.sh
---

<objective>
Foundation plan for Phase 1. Lands the Wave 0 test infrastructure mandated by 01-VALIDATION.md (external API mocks, MinIO test harness, factories), installs MinIO in docker compose + a Coolify manifest with bucket-per-tenant bootstrap, creates the 10 domain tables (events, lot_categories, lots, vendors, vendor_documents, vendor_applications, lot_assignments, contracts, contract_template_versions, payments, pagarme_orders, zapsign_documents) with FORCE RLS + PII column comments, and wires the Better Auth setActiveOrganization hook so session.tenant_id flips when the user picks an active org. No feature behavior yet — this is the floor that 01-02 through 01-08 stand on.
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md (sections: Standard Stack §MinIO, §Architecture §Tenant Bootstrap, §Schema Shapes, §Validation Architecture)
- .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-04-SUMMARY.md (Better Auth + session.tenant_id nullability gap)
- .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-05-SUMMARY.md (PII comment pattern + soft-delete)
- src/db/schema/auth.ts (the existing tables; new ones live alongside)
- src/db/with-tenant.ts (the RLS boundary; new schemas inherit)
- src/test/db.ts (existing appPool/migratorPool harness; reuse pattern)
</files_to_read>

<task id="1" name="Test infra Wave 0 — external mocks + MinIO test harness + factories">
<action>
Install minio-js (`pnpm add minio@~8.0.x`) and msw (`pnpm add -D msw@~2.x`) for the test harness. Create the following files:

- `src/test/external-mocks.ts` — MSW server (Node) with handlers for: ZapSign (`POST https://sandbox.api.zapsign.com.br/api/v1/docs/`, webhook callback fixture), Pagar.me v5 (`POST https://api.pagar.me/core/v5/orders`, webhook fixture), BrasilAPI (`GET https://brasilapi.com.br/api/cnpj/v1/:cnpj` happy + 404 + 5xx variants), Resend (`POST https://api.resend.com/emails`). Expose `setupExternalMocks()` for test files to call in `beforeAll`; expose `mockBrasilAPIStatus(cnpj, response)` style helpers for per-test overrides.
- `src/test/minio-test.ts` — In-memory MinIO mock: a `Map<bucket, Map<key, {body, contentType, size}>>`. Implement `presignedPutUrl(bucket, key, opts)`, `presignedGetUrl(bucket, key, opts)`, `putObject` (used inside the mock to seed), `statObject` (returns content-type + size + lastModified). Exposes `getMockMinIO()` that returns the same mock instance as the production wrapper would.
- `src/test/factories/event-factory.ts` — `makeEvent(tenantId, overrides?)` builds an Event row with sane defaults (name, dates, place, capacity, timezone=America/Sao_Paulo, currency=BRL) and INSERTs via the migratorPool. Returns the persisted row.
- `src/test/factories/vendor-factory.ts` — `makeVendor(tenantId, overrides?)` builds a vendor with a valid stub CNPJ (BrasilAPI mock pre-seeded to return ACTIVE). Returns the persisted row.
- `src/test/factories/lot-factory.ts` — `makeLot(tenantId, eventId, categoryId, overrides?)` builds a lot with `geometry: {"version":1,"type":"polygon2d","points":[[0,0],[100,0],[100,100],[0,100]],"z_index":0}` and computed area_m². Returns the persisted row.

All factories use the migratorPool (bypasses RLS) for setup speed; tests then query via appPool inside `withTenant`.

Commit message: `feat(01-01): test infra Wave 0 — external mocks + MinIO test harness + 3 factories`
</action>
<read_first>
- src/test/db.ts (mirror its appPool/migratorPool + beforeEach TRUNCATE pattern)
- tests/db/with-tenant.test.ts (reference for how integration tests use these helpers)
- tests/auth/tenant-isolation-e2e.test.ts (reference for dual-tenant assertions)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Validation Architecture §Wave 0 Gaps
</read_first>
<acceptance_criteria>
- `pnpm test src/test` passes 0 tests (sanity — these are helpers, not test files)
- `grep -c "from '@/test/external-mocks'" .` returns 0 today; later plans will import
- `grep -c "from '@/test/minio-test'" .` returns 0 today
- `node -e "import('./src/test/external-mocks').then(m => console.log(typeof m.setupExternalMocks))"` prints `function`
- `pnpm tsc --noEmit` exits 0
- `pnpm vitest run` still passes all 61 Phase 0 tests (regression check)
</acceptance_criteria>
</task>

<task id="2" name="MinIO infra + bucket-per-tenant bootstrap + Coolify manifest">
<action>
Add MinIO to `docker/compose.yml` as a new service:
- Image: `minio/minio:RELEASE.2026-01-15T00-00-00Z` (semver-style pin; verify the latest stable tag at execute time — NEVER `:latest`)
- Ports: `9000:9000` (S3 API), `9001:9001` (console)
- Volume: `minio_data:/data`
- Env: `MINIO_ROOT_USER=${MINIO_ROOT_USER:-minioadmin}`, `MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}`, `MINIO_BROWSER_REDIRECT_URL=https://minio.eventos.fbtax.cloud`

Create `src/lib/storage/minio.ts` — the server-side MinIO client wrapper:
- Reuses `minio-js` v8 (installed in Task 1) with credentials from env
- Exports `getMinIOClient()` (singleton), `getTenantBucket(tenantSlug)` returning `${tenantSlug}-uploads`, `mintPresignedPut(tenantSlug, key, contentType, sizeMaxBytes, ttlSeconds=300)` and `mintPresignedGet(tenantSlug, key, ttlSeconds=900)`
- All envs read via Zod validation in src/lib/env.ts

Create `scripts/minio/setup-buckets.sh` — idempotent script that takes `--tenant <slug>` and runs `mc mb --ignore-existing minio/${slug}-uploads`, then applies a Lifecycle XML with `Expiration.Days=730` for `vendor-docs/` prefix (LGPD 24-month retention) and `Expiration.Days=1825` for `plantas/` prefix (5-year retention by contract). Also sets CORS allowing PUT/GET from `https://eventos.fbtax.cloud` and `https://*.eventos.fbtax.cloud`.

Create `docker/coolify/minio.service.md` documenting the production deploy: image tag, env vars, volume, healthcheck, Traefik labels for the console subdomain (`minio.eventos.fbtax.cloud`), and the post-deploy step to run `setup-buckets.sh --tenant trindade` once for the pilot.

Update `.env.example` and `.env.production.example` with `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_PUBLIC_ENDPOINT` (the browser-reachable URL for pre-signed URLs).

Commit message: `feat(01-01): MinIO bucket-per-tenant infra + Coolify manifest + server wrapper`
</action>
<read_first>
- docker/compose.yml (existing services pattern)
- docker/coolify/postgres.service.md (manifest format reference)
- docker/coolify/traefik-labels.md (labels pattern)
- src/lib/env.ts (Zod env validation pattern from Phase 0)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §MinIO Standard Stack + §MinIO Pitfalls (CORS, public/internal hostname split)
</read_first>
<acceptance_criteria>
- `docker compose config` validates with no errors (the new service parses correctly)
- `docker compose up -d minio` brings up the service; `curl -s http://localhost:9000/minio/health/live` returns 200
- `bash scripts/minio/setup-buckets.sh --tenant trindade` succeeds and `mc ls minio/trindade-uploads` lists an empty bucket with Lifecycle + CORS configured
- `grep -E '\\bminio/minio:[A-Z0-9.-]+\\b' docker/compose.yml` matches a non-`latest` tag (CI gate compliance)
- `pnpm tsc --noEmit` exits 0 with the new `src/lib/storage/minio.ts`
- `docker/coolify/minio.service.md` references `eventos.fbtax.cloud`
</acceptance_criteria>
</task>

<task id="3" name="Domain schema (10 tables) + FORCE RLS + PII comments + setActiveOrganization hook">
<action>
Write `src/db/schema/events.ts`, `src/db/schema/lots.ts`, `src/db/schema/vendors.ts`, `src/db/schema/contracts.ts`, `src/db/schema/payments.ts` using Drizzle. Each table:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)`
- `created_at`, `updated_at` (auto), `deleted_at` (soft-delete)
- Schema-specific columns per RESEARCH §Schema Shapes

Tables (column highlights — refer to RESEARCH for full shapes):
- **events**: name (PII? no — public), starts_at, ends_at, place_name, place_address (PII: address), capacity int, timezone text default 'America/Sao_Paulo', currency text default 'BRL', planta_minio_key text (nullable; key inside `{tenant}-uploads`), status enum('draft','published','archived')
- **lot_categories**: name, base_fixed numeric(12,2) not null default 0, per_sqm_rate numeric(10,4) not null default 0, color hex_text (for dashboard tinting)
- **lots**: event_id fk, category_id fk, code text not null, area_m2 numeric(10,2) not null, geometry jsonb not null check `geometry->>'version' = '1' and geometry->>'type' = 'polygon2d'`, status enum('available','reserved','sold')
- **vendors**: legal_name (PII), trade_name, cnpj text not null (PII), cnpj_verified bool default false, email (PII), phone (PII), status enum('pending','approved','rejected'), approval_reason text
- **vendor_documents**: vendor_id fk, minio_key text not null, content_type text, size_bytes int, doc_type text (RG, contrato_social, comprovante_endereco, etc.)
- **vendor_applications**: vendor_id fk, event_id fk, status enum('open','approved','rejected'), notes text
- **lot_assignments**: vendor_id fk, lot_id fk unique (one assignment per lot), assigned_at timestamptz, assigned_by uuid (user fk)
- **contracts**: vendor_id fk, lot_id fk, event_id fk, template_version text not null, pdf_minio_key text, zapsign_doc_id text, status enum('draft','awaiting_org','awaiting_fornecedor','signed','expired','cancelled'), signed_pdf_minio_key text
- **contract_template_versions**: version text primary key (e.g. 'fornecedor-stand-v1'), description text, file_path text (the TS file location)
- **payments**: contract_id fk, gateway text default 'pagarme', gateway_order_id text, gateway_charge_id text, amount_brl_cents int not null, method enum('pix','credit_card'), status enum('pending','paid','failed','refunded'), paid_at timestamptz
- **pagarme_orders**: payment_id fk, request_payload jsonb, response_payload jsonb, idempotency_key text unique
- **zapsign_documents**: contract_id fk, zapsign_id text unique, payload_send jsonb, payload_callback jsonb

Update `src/db/schema/index.ts` to export the new tables.

Write `src/db/migrations/0010_phase1_domain_tables.sql` (CREATE TABLE statements, enum CREATE TYPE, indexes on tenant_id + status + foreign keys; GRANT SELECT,INSERT,UPDATE,DELETE to fb_eventos_app on each).

Write `src/db/migrations/0011_phase1_force_rls.sql` — apply `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, `CREATE POLICY tenant_isolation ON ... USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid)` for every new table. Apply `COMMENT ON COLUMN ... IS 'PII:legal_name'`, etc. for the 8 PII columns identified above.

Create `src/lib/auth/set-active-org.ts` — Server Action `setActiveOrganization(orgId)` that:
1. Verifies the current user is a member of orgId (via Better Auth)
2. Looks up `organizations.tenant_id` for orgId
3. Updates `session SET tenant_id = ?, active_organization_id = ? WHERE id = current_session_id` (this is the only place outside auth code that touches session.tenant_id; uses migratorPool to bypass RLS on the session table)
4. Returns success / failure

Hook this into Better Auth via `src/auth/server.ts` `organization` plugin config — add the `setActiveOrganizationHook` so it fires on user-initiated org switch.

Commit message: `feat(01-01): domain schema (12 tables) + FORCE RLS + PII comments + setActiveOrg hook`
</action>
<read_first>
- src/db/schema/auth.ts (Better Auth tables — pattern for column types, foreign keys)
- src/db/schema/consent.ts (PII column comment example from Phase 0)
- src/db/migrations/0002_force_rls.sql (Phase 0 RLS pattern — mirror exactly)
- src/db/migrations/0007_pii_comments_and_audit_grants.sql (COMMENT ON COLUMN + GRANT pattern)
- src/auth/server.ts (where to wire the organization plugin hook)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Schema Shapes (all 12 tables detailed)
</read_first>
<acceptance_criteria>
- `pnpm drizzle-kit check` reports 0 schema drift
- `pnpm db:migrate` applies 0010 + 0011 idempotently against the test cluster
- `SELECT relname FROM pg_class WHERE relrowsecurity = true AND relforcerowsecurity = true` returns all 12 new tables (FORCE RLS active on every one)
- `SELECT col_description(c.oid, a.attnum) FROM pg_class c JOIN pg_attribute a ON c.oid=a.attrelid WHERE col_description LIKE 'PII:%'` returns ≥ 8 rows (Phase 0 baseline + Phase 1 additions)
- All Phase 0 contract tests still PASS (`pnpm test tests/db/`)
- `pnpm test tests/auth/` still PASS (setActiveOrg doesn't break existing auth flows)
- `pnpm tsc --noEmit` exits 0
- New test: `tests/auth/set-active-org.test.ts` proves that calling setActiveOrganization updates session.tenant_id and that subsequent reads through withTenant return only that tenant's rows
</acceptance_criteria>
</task>

<verification>
After all 3 tasks committed:
- `pnpm test --run` passes all tests including Phase 0 + new set-active-org test
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` all green
- `docker compose up -d` brings up postgres + minio cleanly
- `bash scripts/minio/setup-buckets.sh --tenant trindade` succeeds (idempotent re-run also succeeds)
- Schema introspection confirms FORCE RLS on all 12 new tables and PII comments on 8+ columns
- `pnpm db:migrate` is idempotent (no drift on re-run)

This plan blocks 01-02 through 01-08 — every subsequent plan depends on the schema + test infra + MinIO + setActiveOrg.
</verification>
