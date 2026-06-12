---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 05
type: execute
wave: 3
depends_on:
  - 00-03
files_modified:
  - src/db/schema/index.ts
  - src/db/schema/audit.ts
  - src/db/schema/consent.ts  # MODIFIES Plan 03 Task 1 stub: adds columns, layers FORCE RLS + grants + PII comments via migration 0005
  - src/db/migrations/0004_lgpd_baseline.sql
  - src/db/migrations/0005_pii_comments_and_audit_grants.sql
  - src/lib/audit.ts
  - src/lib/soft-delete.ts
  - src/components/consent-banner.tsx
  - src/app/layout.tsx
  - docs/LGPD.md
  - tests/lgpd/audit-log-append-only.test.ts
  - tests/lgpd/consent-records.test.ts
  - tests/lgpd/soft-delete.test.ts
  - tests/lgpd/pii-comments.test.ts
autonomous: true
requirements:
  - LGPD-02
  - LGPD-03
  - LGPD-04
  - LGPD-05
  - LGPD-06
requirements_addressed:
  - LGPD-02
  - LGPD-03
  - LGPD-04
  - LGPD-05
  - LGPD-06
tags:
  - lgpd
  - audit
  - consent
  - soft-delete
  - compliance
must_haves:
  truths:
    - "`audit_log` table exists; `fb_eventos_app` has INSERT but NOT UPDATE or DELETE (verified by SQL query)"
    - "`consent_records` table exists with versioning columns (consent_version, consent_text, ip_address, user_agent)"
    - "Every PII column in audit_log, consent_records, and user has `COMMENT ON COLUMN <table>.<col> IS 'PII: ...'` (verifiable via information_schema)"
    - "`recordAudit(db, opts)` helper writes a row inside the caller-supplied `withTenant` transaction; passing the singleton `db` (outside `withTenant`) causes the INSERT to be rejected by Postgres RLS — proven by an explicit test case"
    - "Every tenant-owned table from Plan 03 has a `deleted_at timestamptz` column; soft-delete helpers filter `WHERE deleted_at IS NULL` by default"
    - "Cookie consent banner appears on first visit; choice is persisted (cookie + consent_records row when user is logged in)"
    - "`docs/LGPD.md` placeholder exists with retention policy table + legal review TODO + DPA reference (LGPD-08 for Phase 4)"
  artifacts:
    - path: "src/db/schema/audit.ts"
      provides: "audit_log Drizzle table (append-only at the GRANT level)"
      contains: "auditLog = pgTable"
    - path: "src/db/schema/consent.ts"
      provides: "consent_records Drizzle table — EXTENDS Plan 03 Task 1 stub by adding columns (consentText, granted_scopes) + tenant_isolation pgPolicy; FORCE RLS and REVOKE grants live in migration 0005"
      contains: "consentRecords = pgTable"
    - path: "src/db/migrations/0005_pii_comments_and_audit_grants.sql"
      provides: "COMMENT ON COLUMN for PII + REVOKE UPDATE,DELETE ON audit_log FROM fb_eventos_app"
      contains: "REVOKE UPDATE, DELETE ON audit_log"
    - path: "src/lib/audit.ts"
      provides: "auditLog() helper for sensitive ops"
    - path: "src/lib/soft-delete.ts"
      provides: "softDelete() + notDeleted() query helpers"
    - path: "src/components/consent-banner.tsx"
      provides: "LGPD-02 cookie consent banner"
    - path: "docs/LGPD.md"
      provides: "Retention + processing inventory placeholder (LGPD-06)"
  key_links:
    - from: "src/lib/audit.ts"
      to: "src/db/with-tenant.ts"
      via: "recordAudit(db, opts) — caller MUST pass the withTenant-scoped db; passing singleton db triggers RLS rejection (proven by tests/lgpd/audit-log-append-only.test.ts case 'singleton db rejected')"
      pattern: "withTenant"
    - from: "src/db/migrations/0005_pii_comments_and_audit_grants.sql"
      to: "audit_log table"
      via: "REVOKE UPDATE, DELETE"
      pattern: "REVOKE UPDATE, DELETE ON audit_log FROM fb_eventos_app"
---

<objective>
Establish LGPD baseline data layer that the rest of FB_EVENTOS will inherit: `audit_log` append-only table (LGPD-04), `consent_records` versioning table (LGPD-01 schema home; user-facing consent capture lives in Plan 04 signup), PII column comments via SQL `COMMENT ON COLUMN` (LGPD-03), soft-delete `deleted_at` infrastructure (LGPD-05), and `docs/LGPD.md` retention placeholder (LGPD-06). Also: client-side cookie consent banner (LGPD-02).

Purpose: From Phase 1 onward every domain feature inherits structurally-correct LGPD scaffolding (audit can be written from any Server Action, soft-delete is the default, PII is inventoried in `information_schema.columns.column_comment`). Mitigates compliance risk and the "we'll add LGPD later" anti-pattern that wrecks SaaS projects.

Output: Two new Drizzle tables + two migrations (one to create + one to apply grants/comments) + helper modules + consent banner + the LGPD placeholder doc + four integration tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md
@.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-VALIDATION.md
@.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-03-SUMMARY.md

<interfaces>
<!-- Required Drizzle imports + helper signatures. -->

# Builds on Plan 03 schema (tenants, user, session, organization, member, invitation).
# auditLog table is tenant-scoped (RLS applies); consent_records is mostly tenant-scoped
# but stores PRE-signup consent in some flows (use a nullable tenant_id for these).

src/lib/audit.ts exports:
  async function auditLog(opts: {
    action: string;          // e.g. 'user.signup', 'event.created'
    entity: string;          // table name
    entityId?: string;       // UUID
    payload?: unknown;       // jsonb — sanitized; NEVER passwords or full PII
  }): Promise<void>
  // Must be called inside withTenant(); reads tenantId from a local async hook
  // (e.g. AsyncLocalStorage) populated by withTenantAction in Plan 04.

src/lib/soft-delete.ts exports:
  function notDeleted<T extends { deletedAt: any }>(table: T): SQL  // returns isNull(table.deletedAt)
  async function softDelete(table, id): Promise<void>               // sets deletedAt = now()
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: audit_log + consent_records schema, migrations, append-only grants, PII comments</name>
  <files>src/db/schema/audit.ts, src/db/schema/consent.ts, src/db/schema/index.ts, src/db/migrations/0004_lgpd_baseline.sql, src/db/migrations/0005_pii_comments_and_audit_grants.sql</files>
  <read_first>
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (section "Pattern 9: LGPD Baseline Schema")
    - src/db/schema/auth.ts (Plan 03 Task 1 — already includes `deletedAt` on user)
    - src/db/migrations/0000_roles_and_extensions.sql (Plan 03 Task 2 — fb_eventos_app role grants)
  </read_first>
  <behavior>
    - `audit_log` table created with: id uuid pk, user_id uuid (PII), tenant_id uuid not null (FK tenants), action text, entity text, entity_id uuid, payload jsonb, ip_address text (PII), user_agent text, created_at timestamptz default now() — plus indexes on (tenant_id), (user_id), (created_at).
    - `audit_log` has RLS enabled + FORCED + pgPolicy tenant_isolation (so reads scope to current tenant; inserts must SET app.current_tenant_id first or RLS rejects).
    - `consent_records` table EXTENDED on top of Plan 03 Task 1's stub: Plan 03 already created the table with `id`, `user_id`, `tenant_id` (NOT NULL FK), `consent_version`, `consent_at`, `consent_ip`, `user_agent` columns; Plan 05 (a) relaxes `tenant_id` to nullable (allows pre-signup consent capture for marketing pages — Phase 2+) via the migration 0004 ALTER, (b) adds `consent_text text not null` (snapshot of the wording the user agreed to), (c) adds optional `granted_scopes jsonb`, and (d) renames/aligns `consent_ip` → `ip_address` if Plan 03's stub used a different name. RLS enabled + FORCE with a policy that allows reads when tenant_id matches OR tenant_id is null (the pre-signup case).
    - Migration `0005_pii_comments_and_audit_grants.sql` does: (a) `REVOKE UPDATE, DELETE ON audit_log FROM fb_eventos_app;` (append-only enforcement at GRANT level), (b) `COMMENT ON COLUMN` for every PII column listed below, (c) any LGPD-related sequences also REVOKE.
    - Schema index file re-exports the two new tables.
  </behavior>
  <action>
    1. Create `src/db/schema/audit.ts` per RESEARCH Pattern 9. Use `pgTable('audit_log', {...}, t => [index('audit_log_tenant_idx').on(t.tenantId), index('audit_log_user_idx').on(t.userId), index('audit_log_created_idx').on(t.createdAt), pgPolicy('tenant_isolation', { to: fbEventosApp, using: sql\`tenant_id = current_setting('app.current_tenant_id', true)::uuid\`, withCheck: sql\`tenant_id = current_setting('app.current_tenant_id', true)::uuid\` })]).withRLS()`. tenant_id is NOT NULL + references tenants(id).

    2. **EXTEND** the existing `src/db/schema/consent.ts` stub created by Plan 03 Task 1 (do NOT recreate the file from scratch — Plan 03 owns the initial table definition). Add: (a) relax `tenantId` to nullable (use `.notNull(false)` or remove `.notNull()`), (b) add `consentText text not null` column, (c) optionally add `grantedScopes jsonb`, (d) attach the `tenant_isolation` `pgPolicy` with USING clause `(tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid)` so pre-signup rows (where the user isn't yet in an org) are still readable post-signup once tenant context is established, and chain `.withRLS()`. **FORCE RLS + `REVOKE UPDATE/DELETE` grants + PII `COMMENT ON COLUMN` statements remain in migration `0005_pii_comments_and_audit_grants.sql` (step 5 below).** The schema file owns ORM-level structure + policy; the SQL migration owns DB-level enforcement.

    3. Update `src/db/schema/index.ts` to re-export `audit` and `consent` schemas.

    4. Run `pnpm db:generate` to emit `0004_lgpd_baseline.sql`. Review: confirm CREATE TABLE statements + CREATE POLICY statements + indexes exist. If drizzle-kit emits the policies with `TO public` instead of `TO fb_eventos_app`, fix the schema (use the imported `fbEventosApp` pgRole reference).

    5. Hand-write `src/db/migrations/0005_pii_comments_and_audit_grants.sql`:
       ```sql
       -- Append-only enforcement at GRANT level (LGPD-04)
       REVOKE UPDATE, DELETE ON audit_log FROM fb_eventos_app;

       -- FORCE RLS on the two new tables (drizzle-kit doesn't generate FORCE)
       ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
       ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;

       -- PII inventory via SQL comments (LGPD-03)
       COMMENT ON COLUMN audit_log.user_id     IS 'PII: natural person identifier; retention 5 yrs post-event';
       COMMENT ON COLUMN audit_log.ip_address  IS 'PII: network identifier; retained for fraud/legal';
       COMMENT ON COLUMN audit_log.user_agent  IS 'PII (low-sensitivity): device fingerprint';
       COMMENT ON COLUMN audit_log.payload     IS 'May contain sanitized PII references — NEVER raw passwords or full card data';
       COMMENT ON COLUMN consent_records.user_id    IS 'PII: natural person identifier';
       COMMENT ON COLUMN consent_records.ip_address IS 'PII: consent evidence per LGPD Art. 8';
       COMMENT ON COLUMN consent_records.user_agent IS 'PII (low-sensitivity): consent evidence';
       COMMENT ON COLUMN "user".email              IS 'PII: primary contact identifier; consent inventory';
       COMMENT ON COLUMN "user".name               IS 'PII: natural person name';
       COMMENT ON COLUMN "user".consent_version    IS 'LGPD-01 consent versioning';
       COMMENT ON COLUMN "user".consent_at         IS 'LGPD-01 consent timestamp (ISO 8601)';
       COMMENT ON COLUMN "user".consent_ip         IS 'PII: LGPD-01 consent evidence IP';
       ```

    6. Run `pnpm db:migrate`. Verify with `psql`:
       - `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('audit_log','consent_records')` → all true.
       - `SELECT has_table_privilege('fb_eventos_app', 'audit_log', 'UPDATE'), has_table_privilege('fb_eventos_app', 'audit_log', 'DELETE'), has_table_privilege('fb_eventos_app', 'audit_log', 'INSERT')` → false, false, true.
       - `SELECT col_description((quote_ident('audit_log'))::regclass::oid, ordinal_position) FROM information_schema.columns WHERE table_name='audit_log' AND column_name='user_id'` returns the 'PII:...' string.

    7. Update `pnpm db:check` baseline so the new migrations are recognized.
  </action>
  <verify>
    <automated>pnpm db:migrate && pnpm db:check && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT count(*) FROM pg_class WHERE relname IN ('audit_log','consent_records') AND relforcerowsecurity=true" | grep -q '^2$' && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT has_table_privilege('fb_eventos_app','audit_log','UPDATE')" | grep -q '^f$' && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT has_table_privilege('fb_eventos_app','audit_log','DELETE')" | grep -q '^f$' && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT has_table_privilege('fb_eventos_app','audit_log','INSERT')" | grep -q '^t$' && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT count(*) FROM information_schema.columns c JOIN pg_description d ON d.objoid=(quote_ident(c.table_name))::regclass::oid AND d.objsubid=c.ordinal_position WHERE c.table_name='audit_log' AND d.description LIKE 'PII:%'" | awk '$1+0 >= 3 {exit 0} {exit 1}'</automated>
  </verify>
  <acceptance_criteria>
    - `src/db/schema/audit.ts` exports `auditLog` table with policy and RLS enabled
    - `src/db/schema/consent.ts` exports `consentRecords` table with policy and RLS enabled
    - Migration `0004_lgpd_baseline.sql` exists (generated)
    - Migration `0005_pii_comments_and_audit_grants.sql` exists (hand-written) with `REVOKE UPDATE, DELETE ON audit_log FROM fb_eventos_app` AND `FORCE ROW LEVEL SECURITY` on both tables AND `COMMENT ON COLUMN` for at least 8 PII columns
    - SQL: `audit_log` and `consent_records` both have `relforcerowsecurity = true`
    - SQL: `fb_eventos_app` has INSERT but NOT UPDATE/DELETE on `audit_log`
    - SQL: at least 3 columns on `audit_log` have a `PII:`-prefixed column comment
    - `pnpm db:check` exits 0 (no drift)
  </acceptance_criteria>
  <done>audit_log is append-only at the database level; PII columns are inventoried via SQL comments queryable from information_schema; LGPD-03/04 are structurally enforced.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: auditLog() helper, soft-delete helpers, integration tests for append-only + soft-delete + PII comments</name>
  <files>src/lib/audit.ts, src/lib/soft-delete.ts, tests/lgpd/audit-log-append-only.test.ts, tests/lgpd/consent-records.test.ts, tests/lgpd/soft-delete.test.ts, tests/lgpd/pii-comments.test.ts</files>
  <read_first>
    - src/db/schema/audit.ts + consent.ts (Task 1)
    - src/db/with-tenant.ts (Plan 03)
  </read_first>
  <behavior>
    - `auditLog({action, entity, entityId, payload})` resolves the current tenant context (Phase 0 simplest: accept the drizzle `db` argument explicitly so callers `withTenant(tid, async (db) => { await db.insert(auditLogTable).values({...}); ... })` — defers AsyncLocalStorage to a Phase 1 refactor if needed). For Phase 0, expose a `recordAudit(db, opts)` signature: explicit, no magic.
    - `notDeleted(table)` returns `isNull(table.deletedAt)` SQL fragment.
    - `softDelete(db, table, id)` runs `UPDATE table SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`.
    - Test 1 (audit-log-append-only): INSERT a row via `withTenant` → row exists. Attempt UPDATE via appPool inside `withTenant` → ERROR (permission denied). Attempt DELETE → ERROR. ALSO: call `recordAudit(<singleton appPool db>, opts)` OUTSIDE any `withTenant` block → expect rejection (Postgres throws because `current_setting('app.current_tenant_id', true)` is empty, the policy `withCheck` returns false, and the INSERT fails with `new row violates row-level security policy for table "audit_log"`). This makes the misuse loud, not silent. (T-0-03 adjacent: tamper-evidence.)
    - Test 2 (consent-records): INSERT a consent row with version `2026-06-01` → row stored. INSERT a second consent with version `2026-07-01` for same user → both rows exist (versioning, no upsert).
    - Test 3 (soft-delete): Insert + softDelete + query without `notDeleted` filter sees 1 row; query with `notDeleted` sees 0 rows; deleted_at is non-null.
    - Test 4 (pii-comments): Query `information_schema.columns` joined with `pg_description` to assert at least 8 `PII:` comments exist on user / audit_log / consent_records columns.
  </behavior>
  <action>
    1. Create `src/lib/audit.ts`:
       ```typescript
       import type { DrizzleDB } from '@/db/with-tenant';
       import { auditLog } from '@/db/schema/audit';
       export async function recordAudit(db: DrizzleDB, opts: {
         action: string;
         entity: string;
         entityId?: string;
         payload?: unknown;
         userId: string;
         ipAddress?: string;
         userAgent?: string;
       }) {
         // tenant_id is filled automatically because the policy's withCheck matches current_setting
         // (the INSERT fails if current_setting is empty — RLS enforces tenant context)
         await db.insert(auditLog).values({
           action: opts.action, entity: opts.entity, entityId: opts.entityId,
           payload: opts.payload as any, userId: opts.userId,
           ipAddress: opts.ipAddress, userAgent: opts.userAgent,
           // tenantId is required by Drizzle types but the policy enforces it matches current_setting;
           // we fill from the current_setting via a subquery in the INSERT:
           tenantId: sql`current_setting('app.current_tenant_id', true)::uuid` as any,
         });
       }
       ```

    2. Create `src/lib/soft-delete.ts`:
       ```typescript
       import { isNull, sql, eq } from 'drizzle-orm';
       export function notDeleted<T extends { deletedAt: any }>(table: T) {
         return isNull(table.deletedAt);
       }
       export async function softDelete<T extends { id: any; deletedAt: any }>(
         db: any, table: T, id: string
       ) {
         await db.update(table).set({ deletedAt: sql`NOW()` }).where(eq(table.id, id));
       }
       ```

    3. Create `tests/lgpd/audit-log-append-only.test.ts`:
       - Case A (happy path): setup tenant + user; `withTenant(tid, async (db) => { await recordAudit(db, {...}); })`; assert row exists in audit_log scoped to tid.
       - Case B (UPDATE rejected): inside `withTenant(tid)`, run `db.update(auditLog).set({action: 'tampered'}).where(...)` → expect a thrown error whose message contains `permission denied` (RESEARCH note: REVOKE UPDATE on audit_log applies at the GRANT layer, not RLS; the error is "permission denied for table audit_log").
       - Case C (DELETE rejected): inside `withTenant(tid)`, run `db.delete(auditLog).where(...)` → expect `permission denied`.
       - Case D (singleton db rejected — load-bearing for the key_links audit): import the global singleton `db` from `@/db`, call `await recordAudit(db, { action: 'leak.attempt', entity: 'tenants', userId: <uid> })` WITHOUT wrapping in `withTenant`. Expect a thrown error. The error message MUST match either /row-level security/ OR /permission denied/ OR /violates row-level security/. This proves the misuse is loud, not silent. Include a comment on the test referencing the checker's "key_links_planned" concern.

    4. Create `tests/lgpd/consent-records.test.ts`: insert two consents for same user with different versions; assert both rows readable; assert ordering by created_at.

    5. Create `tests/lgpd/soft-delete.test.ts`: create a row in (e.g.) `organization`; `softDelete(db, organization, id)`; query WITHOUT filter → row visible with non-null deleted_at; query with `notDeleted(organization)` → row hidden.

    6. Create `tests/lgpd/pii-comments.test.ts`:
       ```typescript
       test('PII columns are inventoried', async () => {
         const rows = await migratorPool`
           SELECT c.table_name, c.column_name, d.description
           FROM information_schema.columns c
           JOIN pg_description d ON d.objoid = (quote_ident(c.table_name))::regclass::oid AND d.objsubid = c.ordinal_position
           WHERE c.table_schema = 'public' AND d.description LIKE 'PII:%'
         `;
         expect(rows.length).toBeGreaterThanOrEqual(8);
       });
       ```

    7. Run `pnpm test:unit tests/lgpd/` — all must pass.
  </action>
  <verify>
    <automated>pnpm test:unit tests/lgpd/</automated>
  </verify>
  <acceptance_criteria>
    - `src/lib/audit.ts` exports `recordAudit(db, opts)`
    - `src/lib/soft-delete.ts` exports `notDeleted(table)` and `softDelete(db, table, id)`
    - `tests/lgpd/audit-log-append-only.test.ts` has 4+ test cases (insert ok, UPDATE rejected, DELETE rejected, singleton-db rejected); all pass
    - `tests/lgpd/consent-records.test.ts` validates versioning (multiple rows per user)
    - `tests/lgpd/soft-delete.test.ts` validates deleted_at set + filter behavior
    - `tests/lgpd/pii-comments.test.ts` validates ≥8 PII column comments via information_schema join
    - `pnpm test:unit tests/lgpd/` exits 0
  </acceptance_criteria>
  <done>recordAudit + soft-delete helpers exist; four integration tests prove append-only audit_log (DB-level), consent versioning, soft-delete semantics, and PII inventory queryability.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Consent banner (LGPD-02) + docs/LGPD.md placeholder (LGPD-06)</name>
  <files>src/components/consent-banner.tsx, src/app/layout.tsx, docs/LGPD.md</files>
  <read_first>
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (section "Pattern 9" mention of LGPD-02 client placeholder)
    - src/app/layout.tsx (existing root layout from Plan 01)
  </read_first>
  <behavior>
    - Cookie consent banner renders on first visit. Three options: "Accept all", "Reject non-essential", "Customize" (Customize is a no-op in Phase 0 — leads to a placeholder modal; granular controls come in Phase 1+).
    - Choice persisted in localStorage under key `fb_lgpd_consent_v1` AND, if user is authenticated, a row inserted into `consent_records`.
    - Banner is dismissible; doesn't re-show after choice unless `fb_lgpd_consent_v1` key is cleared.
    - docs/LGPD.md is a placeholder structure with: scope, controller info, retention table (per-table rows: tenants, user, session, audit_log, consent_records), DPO contact placeholder, DPA reference for B2B (LGPD-08 marker → Phase 4), legal review TODO marker.
  </behavior>
  <action>
    1. Create `src/components/consent-banner.tsx` (client component, `'use client'`):
       - On mount, read `localStorage.getItem('fb_lgpd_consent_v1')`. If present, render nothing.
       - Otherwise render a fixed-bottom banner using shadcn `Card` + `Button` primitives with text: "Usamos cookies essenciais para o funcionamento da plataforma. Analytics e marketing são opcionais. Consulte nossa [Política LGPD](/docs/lgpd)."
       - Three buttons: "Aceitar tudo" (sets value `{essential:true,analytics:true,marketing:true,version:'2026-06-01',at:<iso>}`), "Recusar não-essenciais" (sets `{essential:true,analytics:false,marketing:false,...}`), "Personalizar" (placeholder — opens an info-only dialog).
       - After choice: `localStorage.setItem(...)`. If `useSession()` returns a session, POST to a `/api/lgpd/consent` Server Action (create a minimal Server Action at `src/app/api/lgpd/consent/route.ts` that takes the choice + IP + UA and inserts a `consent_records` row via `withTenant`). The Server Action is okay to defer to a follow-up if the form gets too large in this task — but the cookie persistence MUST work in Phase 0.

    2. Update `src/app/layout.tsx` to render `<ConsentBanner />` at the bottom of the body. The banner is a Client Component; everything else stays Server Component.

    3. Create `docs/LGPD.md` placeholder (LGPD-06). Structure:
       ```markdown
       # FB_EVENTOS — Política e Inventário LGPD (Placeholder)

       > **STATUS:** Placeholder técnico — revisão jurídica pendente antes do go-live do piloto.

       ## Escopo
       FB_EVENTOS é controlador dos dados pessoais coletados...

       ## Inventário de tratamento por tabela

       | Tabela | Tipo de dado | Base legal (LGPD Art. 7) | Retenção (placeholder) | Notas |
       |--------|--------------|--------------------------|------------------------|-------|
       | tenants | Identificação da empresa cliente | execução de contrato | indeterminado enquanto contrato ativo | |
       | user | Identificação + autenticação | execução de contrato + consentimento | 5 anos pós-encerramento | inclui consent_* |
       | session | Sessão técnica | legítimo interesse | até expiração + 30 dias | |
       | audit_log | Log de operações sensíveis | obrigação legal / legítimo interesse | 5 anos | append-only |
       | consent_records | Evidência de consentimento | obrigação legal (Art. 8) | indeterminado (evidência) | versionado |
       | organization | Identificação tenant | execução de contrato | enquanto contrato ativo | |

       ## Encarregado (DPO)
       Placeholder — definir antes do piloto Festa de Trindade/GO.

       ## DPA (Data Processing Agreement) — B2B
       Placeholder — LGPD-08 — fica em Phase 4.

       ## Direito ao esquecimento (LGPD-07)
       Workflow completo em Phase 4. Phase 0 fornece soft-delete (deleted_at) + helper softDelete().

       ## TODO antes do piloto
       - [ ] Revisão jurídica completa
       - [ ] Designar DPO formalmente
       - [ ] Confirmar retenção (consultar legal)
       - [ ] Anexar DPA padrão (LGPD-08 — Phase 4)
       ```

    Per LGPD-02: banner is visible on first visit; choice is persisted; backend captures audit-grade evidence (consent_records row) when user is authenticated.
  </action>
  <verify>
    <automated>pnpm tsc --noEmit && pnpm build && test -f src/components/consent-banner.tsx && grep -q "'use client'" src/components/consent-banner.tsx && grep -q "fb_lgpd_consent_v1" src/components/consent-banner.tsx && grep -q "ConsentBanner" src/app/layout.tsx && test -f docs/LGPD.md && grep -q "Inventário de tratamento" docs/LGPD.md && grep -q "consent_records" docs/LGPD.md</automated>
  </verify>
  <acceptance_criteria>
    - `src/components/consent-banner.tsx` exists with `'use client'` directive
    - Banner persists choice to localStorage under key `fb_lgpd_consent_v1`
    - Banner is referenced from `src/app/layout.tsx`
    - `docs/LGPD.md` exists with sections: Escopo, Inventário de tratamento por tabela (table with 6+ rows), Encarregado/DPO placeholder, DPA reference, Direito ao esquecimento, TODO antes do piloto
    - `pnpm build` exits 0 (banner renders without errors)
    - Manual smoke: visiting `/` on a fresh browser shows the banner; clicking any button removes it; refresh does not bring it back
  </acceptance_criteria>
  <done>LGPD-02 cookie consent banner ships; LGPD-06 placeholder docs/LGPD.md ships with retention table + legal review TODO list; both are wired so Phase 1+ can extend without restructuring.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Server Action → audit_log INSERT | RLS withCheck enforces tenant_id = current_setting; no UPDATE/DELETE grants prevent tampering |
| Browser → consent banner choice | Stored locally + (if authenticated) replicated to consent_records for legal evidence |
| information_schema → PII inventory | SQL comments are the source of truth — survives schema dumps |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-0-08 | Compliance | LGPD consent capture | mitigate | Plan 04 captures consent at signup; this plan adds consent_records versioning table + LGPD-02 banner + consent_records INSERT on banner action when authenticated |
| (LGPD Art. 8 evidence) | Repudiation | audit_log integrity | mitigate | append-only at GRANT level (REVOKE UPDATE,DELETE); RLS FORCED; integration test proves UPDATE fails |
| (LGPD Art. 18 portability) | Information Disclosure | PII inventory | accept-foundation | PII inventoried via SQL comments queryable from information_schema; full export Server Action is Phase 4 (LGPD-07) |
</threat_model>

<verification>
1. `pnpm db:migrate && pnpm db:check` succeeds.
2. `pnpm test:unit tests/lgpd/` exits 0 with 4+ test suites.
3. `pnpm build` exits 0; consent banner imports compile.
4. SQL: `SELECT has_table_privilege('fb_eventos_app','audit_log','UPDATE')` returns `f`.
5. SQL: PII column comments count ≥ 8 across user / audit_log / consent_records.
6. Manual: `pnpm dev` → visit `localhost:3000/` on fresh browser → consent banner visible at bottom → click "Aceitar tudo" → banner hides → refresh → banner stays hidden.
</verification>

<success_criteria>
- audit_log is append-only at the database level (REVOKE + RLS FORCE + integration test)
- consent_records supports versioning (multiple rows per user)
- PII columns are inventoried via COMMENT ON COLUMN (≥8 columns)
- soft-delete `deleted_at` infrastructure shipped with helper module + integration test
- Cookie consent banner renders on first visit and persists choice
- docs/LGPD.md placeholder ships with retention table + legal review TODO
- LGPD-02..06 all backed by passing tests or document presence
</success_criteria>

<output>
Create `.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-05-SUMMARY.md` listing:
- Migration files added (0004, 0005)
- Tables added (audit_log, consent_records) with their RLS state
- Helper modules added (audit.ts, soft-delete.ts) with their signatures
- The 4 integration tests + what they prove
- T-0-08 mitigation summary + PII inventory count
- Open items for Plan 06 (audit writes will be wired through Pino logger for log-DB correlation)
</output>
