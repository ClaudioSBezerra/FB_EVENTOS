---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 05
subsystem: lgpd
tags: [lgpd, audit, consent, soft-delete, pii, compliance, rls, append-only]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "Postgres + Drizzle + RLS foundation (Plan 03) — withTenant() + role fb_eventos_app NOBYPASSRLS + tenants/user schema"
      - "consent_records STUB schema (Plan 03 Task 1) — minimum columns Plan 04 inserts into; Plan 05 layers full LGPD hardening on top"
      - "Better Auth + auth UI (Plan 04) — recordConsentMetadata Server Action already wired; Plan 05 column rename must keep it working"
provides:
  - "audit_log table with FORCE RLS + GRANT-layer REVOKE UPDATE/DELETE (append-only at the catalog level)"
  - "consent_records EXTENDED: tenant_id nullable (pre-signup capture), consent_text snapshot (LGPD Art. 8 § 1°), granted_scopes jsonb, ip_address renamed from consent_ip"
  - "FORCE ROW LEVEL SECURITY on both audit_log + consent_records (Plan 03 only forced session/organization/member/invitation)"
  - "12 PII columns inventoried via COMMENT ON COLUMN (LGPD-03 queryable via information_schema + pg_description)"
  - "src/lib/audit.ts:recordAudit(db, opts) — explicit withTenant-scoped helper; singleton-db misuse rejected loudly"
  - "src/lib/soft-delete.ts:notDeleted(table) + softDelete(db, table, id) — LGPD-05 query-time helpers"
  - "src/components/consent-banner.tsx — LGPD-02 cookie consent banner (client component)"
  - "docs/LGPD.md — LGPD-06 placeholder with retention table + DPO TODO + DPA reference"
  - "4 LGPD integration test files: audit-log-append-only / consent-records / soft-delete / pii-comments — 10 tests, all GREEN"
affects:
  - 00-06-graphile-worker              # Pino logger will inject x-request-id from Plan 04 middleware; audit writes will be correlated via Pino bindings
  - phase-1+                           # Every domain table with PII MUST add deleted_at + COMMENT ON COLUMN 'PII:...' in the same migration that creates it

# Tech tracking
tech-stack:
  added:
    - "(none — this plan is pure schema + helpers + docs; no new npm dependencies)"
  patterns:
    - "Pattern: audit_log append-only via REVOKE UPDATE, DELETE — INSERT remains, SELECT remains. The contract is enforced at the catalog GRANT layer (Postgres error 42501 'permission denied' on UPDATE/DELETE attempts) AND at the RLS layer (tenant_id = current_setting check)"
    - "Pattern: recordAudit(db, opts) signature is EXPLICIT — no AsyncLocalStorage magic in Phase 0. Caller MUST supply the withTenant-scoped db. Singleton-db misuse fails loudly with Postgres 22P02 (CAST '' AS uuid) — proven by integration test"
    - "Pattern: PII inventory via SQL comments — every column with PII carries COMMENT ON COLUMN ... IS 'PII: <description>'. Queryable via information_schema.columns JOIN pg_description (canonical query lives in docs/LGPD.md)"
    - "Pattern: consent_records versioned by INSERT (no upsert) — preserves the consent_text snapshot per LGPD Art. 8 § 1° 'consentimento para finalidades determinadas'. Multiple rows per (user_id, consent_version) ordered by created_at"
    - "Pattern: consent_records.tenant_id NULLABLE + RLS policy `tenant_id IS NULL OR matches` — allows pre-signup marketing-page consent capture (Phase 2+) while still enforcing tenant isolation post-signup"

key-files:
  created:
    - "src/db/schema/audit.ts"
    - "src/db/migrations/0006_lgpd_baseline.sql"
    - "src/db/migrations/0007_pii_comments_and_audit_grants.sql"
    - "src/db/migrations/meta/0006_snapshot.json"
    - "src/db/migrations/meta/0007_snapshot.json"
    - "src/lib/audit.ts"
    - "src/lib/soft-delete.ts"
    - "src/components/consent-banner.tsx"
    - "docs/LGPD.md"
    - "tests/lgpd/audit-log-append-only.test.ts"
    - "tests/lgpd/consent-records.test.ts"
    - "tests/lgpd/soft-delete.test.ts"
    - "tests/lgpd/pii-comments.test.ts"
  modified:
    - "src/db/schema/consent.ts (extended Plan 03 STUB: nullable tenant_id, consent_text, granted_scopes, ip_address rename, pgPolicy + .enableRLS)"
    - "src/db/schema/index.ts (re-export audit module)"
    - "src/db/migrations/meta/_journal.json (added 0006 + 0007 entries)"
    - "src/lib/actions/consent.ts (Plan 04 action updated for ip_address rename + consent_text default)"
    - "src/test/setup.ts (TRUNCATE list extended for audit_log)"
    - "src/app/layout.tsx (mount <ConsentBanner /> in <body>)"

key-decisions:
  - "Migrations numbered 0006 + 0007 (not 0004/0005 as PLAN.md draft suggested) because Plan 04 already shipped 0003/0004/0005. The plan's frontmatter explicitly anticipated this drift ('a new migration 0006 (or whatever the next migration number is)')"
  - "Hand-wrote 0006 instead of generating via drizzle-kit because the consent_ip → ip_address rename triggers an interactive prompt that the non-TTY execution context cannot answer. Hand-written migration is consistent with Plan 03's pattern (0000 + 0002 were hand-written) and Plan 04's (0004 + 0005 were hand-written)"
  - "Snapshot 0006 + 0007 hand-authored — drizzle-kit's `db:check` validates the chain and passes against the hand-authored snapshots. The schema deltas are mechanically captured: consent_records gets new columns + nullable tenant_id + pgPolicy + isRLSEnabled=true; audit_log added as new table with policy. 0007 snapshot is logically identical to 0006 (FORCE RLS + REVOKE + COMMENT ON COLUMN are not tracked in Drizzle's snapshot model)"
  - "consent_text added with DEFAULT '' so Plan 04's recordConsentMetadata (which doesn't pass consent_text) continues to work unchanged. The new Plan 05 code path passes the wording snapshot through. Backward-compat decision rather than mandatory NOT NULL"
  - "user_id on audit_log is NOT a FK — audit rows must outlive soft-deleted users (LGPD-05) and even the future anonymize-after-retention Graphile-Worker job (Phase 4 LGPD-07). Plain uuid avoids cascade deletes that would destroy evidence"
  - "PII comment prefix unified to 'PII:' (with colon) so LIKE 'PII:%' inventory queries match every tagged column. Initial draft used 'PII (low-sensitivity)' which did NOT match — caught by the plan's automated SQL verification and corrected before commit"
  - "Singleton-db misuse rejection path produces Postgres 22P02 'invalid input syntax for type uuid' (NOT 42501 'permission denied') because the CAST '' AS uuid raises before the policy's withCheck evaluates. Both outcomes are acceptable; 22P02 is the stronger signal that the policy was reached at all (i.e. RLS is not being bypassed)"

patterns-established:
  - "Pattern: 'PII:' COMMENT ON COLUMN convention — every PII-bearing column in Phase 1+ MUST carry a COMMENT ON COLUMN that starts with 'PII:'. The verifier scans information_schema + pg_description; missing comments are a contract violation"
  - "Pattern: audit_log append-only via two-layer enforcement — (1) RLS policy tenant_isolation blocks cross-tenant writes/reads, (2) GRANT layer REVOKE UPDATE/DELETE blocks tamper attempts INSIDE the correct tenant. The integration test asserts both layers fire"
  - "Pattern: recordAudit signature is EXPLICIT (db parameter) — Phase 0 deliberately avoids AsyncLocalStorage / globals. Phase 1+ may add a sugar wrapper, but the primitive stays explicit so the call site documents which transaction it lands in"
  - "Pattern: docs/LGPD.md is the canonical compliance source-of-truth — every Phase 1+ table that handles PII updates the inventory table in this file in the same PR that adds the table"

requirements-completed:
  - LGPD-02
  - LGPD-03
  - LGPD-04
  - LGPD-05
  - LGPD-06

# Metrics
duration: ~45min
completed: 2026-06-12
---

# Phase 00 Plan 05: LGPD Baseline + Audit Log Summary

**Layered the LGPD-grade compliance baseline onto the Plan 03 multi-tenant foundation: `audit_log` append-only table (LGPD-04) with FORCE RLS + REVOKE UPDATE/DELETE at the GRANT layer; `consent_records` extended from Plan 03 STUB with versioned consent + snapshot wording + nullable tenant_id for pre-signup capture; 12 PII columns inventoried via `COMMENT ON COLUMN 'PII:...'` (LGPD-03 queryable via `information_schema`); soft-delete `deleted_at` helper modules wired (LGPD-05); cookie consent banner shipped as a Client Component (LGPD-02); `docs/LGPD.md` placeholder with retention table + DPO TODO + DPA reference (LGPD-06). Four new integration test files (10 tests) prove the contract — including the load-bearing "singleton-db misuse rejection" case that establishes the loud-fail invariant for future audit consumers. 46/46 tests GREEN; Plan 04's existing `recordConsentMetadata` flow still works after the schema rename.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-06-12T13:02:48Z
- **Completed:** 2026-06-12T13:47:43Z
- **Tasks:** 3 / 3 (Task 1 + Task 2 `tdd="true"`; Task 3 `tdd="false"`)
- **Files created:** 13
- **Files modified:** 6

## Migration Files

| File | What it does |
|---|---|
| `src/db/migrations/0006_lgpd_baseline.sql` | HAND-WRITTEN. (a) ALTER `consent_records` to extend Plan 03 STUB: relax `tenant_id` to nullable, RENAME `consent_ip` → `ip_address`, ADD `consent_text TEXT NOT NULL DEFAULT ''`, ADD `granted_scopes jsonb`, ENABLE RLS + CREATE tenant_isolation POLICY (NULL-or-matches semantics). (b) CREATE `audit_log` table with FK to tenants, 3 indexes, RLS enabled + tenant_isolation POLICY. |
| `src/db/migrations/0007_pii_comments_and_audit_grants.sql` | HAND-WRITTEN. (a) `ALTER TABLE audit_log FORCE ROW LEVEL SECURITY` + `ALTER TABLE consent_records FORCE ROW LEVEL SECURITY` (closes the table-owner bypass — drizzle-kit cannot represent FORCE). (b) `REVOKE UPDATE, DELETE ON audit_log FROM fb_eventos_app` (append-only at GRANT layer). (c) 12× `COMMENT ON COLUMN ... IS 'PII: ...'` for the LGPD-03 inventory (4 on audit_log, 3 on consent_records, 5 on user). |

`pnpm db:check` exits 0 (no schema drift). `pnpm db:migrate` is idempotent.

### Live Postgres Catalog State (verified on PG18 cluster, :5433)

```text
relname           | relrowsecurity | relforcerowsecurity
------------------+----------------+--------------------
audit_log         | t              | t
consent_records   | t              | t

has_table_privilege('fb_eventos_app','audit_log','UPDATE')  → f
has_table_privilege('fb_eventos_app','audit_log','DELETE')  → f
has_table_privilege('fb_eventos_app','audit_log','INSERT')  → t
has_table_privilege('fb_eventos_app','audit_log','SELECT')  → t

PII columns tagged (LIKE 'PII:%'): 12 total
  audit_log:        user_id, ip_address, user_agent, payload          (4)
  consent_records:  user_id, ip_address, user_agent                   (3)
  user:             email, name, consent_version, consent_at,
                    consent_ip                                        (5)
```

## Tables Added

### `audit_log` (LGPD-04 append-only)

| Column        | Type                          | Notes                                                                 |
| ------------- | ----------------------------- | --------------------------------------------------------------------- |
| `id`          | `uuid` PK DEFAULT random      |                                                                       |
| `user_id`     | `uuid` NOT NULL               | **NOT a FK** — must outlive soft-deleted/anonymized users (LGPD-07)   |
| `tenant_id`   | `uuid` NOT NULL → `tenants.id`| FK; RLS predicate                                                     |
| `action`      | `text` NOT NULL               | e.g. `'user.signup'`, `'event.created'`, `'lot.reserved'`             |
| `entity`      | `text` NOT NULL               | table name                                                            |
| `entity_id`   | `uuid` NULL                   | row uuid (when applicable)                                            |
| `payload`     | `jsonb` NULL                  | sanitized diff — NEVER raw passwords or full PII                      |
| `ip_address`  | `text` NULL                   | PII                                                                   |
| `user_agent`  | `text` NULL                   | PII (low-sensitivity)                                                 |
| `created_at`  | `timestamptz` DEFAULT now()   | indexed                                                               |

- Indexes: `audit_log_tenant_idx (tenant_id)`, `audit_log_user_idx (user_id)`, `audit_log_created_idx (created_at)`.
- RLS: `tenant_isolation` policy `TO fb_eventos_app` — `tenant_id = current_setting('app.current_tenant_id', true)::uuid`.
- FORCE RLS: yes (migration 0007).
- GRANT layer: `INSERT` + `SELECT` only; `UPDATE` + `DELETE` revoked.

### `consent_records` (EXTENDED — Plan 03 STUB → Plan 05 shape, LGPD-01)

| Column            | Type                                | Notes                                                                                  |
| ----------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| `id`              | `uuid` PK DEFAULT random            |                                                                                        |
| `user_id`         | `uuid` NOT NULL → `user.id` cascade |                                                                                        |
| `tenant_id`       | `uuid` NULL → `tenants.id`          | **RELAXED from NOT NULL** — pre-signup capture (Phase 2+)                              |
| `consent_version` | `text` NOT NULL                     | e.g. `'2026-06-01'` — versioned by INSERT                                              |
| `consent_text`    | `text` NOT NULL DEFAULT `''`        | **NEW** — wording snapshot (LGPD Art. 8 § 1°). DEFAULT keeps Plan 04 callers valid     |
| `granted_scopes`  | `jsonb` NULL                        | **NEW** — `{essential, analytics, marketing}` (wire-format compatible with banner)     |
| `consent_at`      | `timestamptz` DEFAULT now()         |                                                                                        |
| `ip_address`      | `text` NULL                         | **RENAMED** from `consent_ip` for LGPD-standard naming + alignment with `audit_log`    |
| `user_agent`      | `text` NULL                         |                                                                                        |

- RLS: `tenant_isolation` policy with `tenant_id IS NULL OR tenant_id = current_setting(...)` (permits pre-signup rows + tenant-scoped post-signup rows).
- FORCE RLS: yes (migration 0007).
- GRANT layer: unchanged — `INSERT`, `SELECT`, `UPDATE`, `DELETE` all granted (consent versioning permits future workflows to mark rows as superseded; UPDATE not blocked at this layer).

## Helper Modules Added

### `src/lib/audit.ts`

```ts
export async function recordAudit(db: TenantDb, opts: {
  action: string
  entity: string
  entityId?: string
  payload?: unknown
  userId: string
  ipAddress?: string
  userAgent?: string
}): Promise<void>
```

- Caller MUST supply a `withTenant`-scoped Drizzle handle.
- `tenant_id` is filled by reading `current_setting('app.current_tenant_id')` at INSERT time — callers cannot forge a mismatching tenant context.
- Misuse (passing the global `db`) throws Postgres 22P02 — proven by `tests/lgpd/audit-log-append-only.test.ts` case D.

### `src/lib/soft-delete.ts`

```ts
export function notDeleted<T extends { deletedAt: unknown }>(table: T): SQL
export async function softDelete<T extends { id: unknown; deletedAt: unknown }>(
  db: AnyDb, table: T, id: string
): Promise<void>
```

- `notDeleted(table)` returns the `IS NULL` SQL predicate on `deletedAt`. Use in `.where(...)`.
- `softDelete(db, table, id)` runs `UPDATE table SET deleted_at = NOW() WHERE id = ?`. Idempotent.

## Integration Tests (4 files, 10 tests — all GREEN)

| Test File                                          | Cases | What it proves                                                                                              |
| -------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `tests/lgpd/audit-log-append-only.test.ts`         | 4     | (A) happy-path INSERT via withTenant; (B) UPDATE rejected — pg 42501; (C) DELETE rejected — pg 42501; (D) singleton-db misuse rejected — pg 22P02 (CAST '' AS uuid). |
| `tests/lgpd/consent-records.test.ts`               | 2     | Two consents with different versions both persist (versioning); `consent_text` DEFAULT '' keeps Plan 04 callers valid. |
| `tests/lgpd/soft-delete.test.ts`                   | 2     | `softDelete` sets `deleted_at`; `notDeleted()` filter hides; two-tenant smoke (live vs soft-deleted).        |
| `tests/lgpd/pii-comments.test.ts`                  | 2     | ≥8 PII columns inventoried via `information_schema` + `pg_description`; audit_log has ≥3 PII-tagged columns. |

Full project: 14 test files, 46 tests, 0 failures, ~36s.

### Load-Bearing "Singleton-DB Misuse Rejected" Test

Plan's `key_links.via` description: "passing the singleton db (outside `withTenant`) causes the INSERT to be rejected by Postgres RLS." Test case D in `tests/lgpd/audit-log-append-only.test.ts` asserts:

- `recordAudit(db, {...})` (singleton `db` from `@/db`) throws.
- The error code is `22P02` (preferred) or `42501`.
- The error message matches `/invalid input syntax for type uuid|row-level security|permission denied/`.
- No row leaked through (verified via `migratorPool` count).

**Why 22P02 (not 42501):** Outside any `withTenant` block, `current_setting('app.current_tenant_id', true)` returns `''`. The expression `'' :: uuid` in the policy's `WITH CHECK` predicate raises 22P02 before the policy logic even evaluates. **This is the STRONGER security signal — it proves the policy was reached at all, i.e. RLS is not being bypassed.** A future Drizzle/Postgres change that masked the CAST error would need to be caught here.

## T-0-08 Mitigation Summary (LGPD Consent Capture)

The threat model lists T-0-08 (Compliance — LGPD consent capture, disposition: mitigate). Layered defense:

1. **Schema layer:** `consent_records.consent_version` + `consent_text` + `consent_at` + `ip_address` + `user_agent` — every signup/consent action records audit-grade evidence.
2. **Action layer:** Plan 04's `recordConsentMetadata` Server Action populates the row with server-side IP capture (`x-forwarded-for` from `next/headers`) — the client cannot forge the IP.
3. **Banner layer:** Plan 05's `<ConsentBanner />` captures the choice on first visit (LGPD-02). Localstorage persistence + fire-and-forget POST to `/api/lgpd/consent` (full Route Handler in Phase 1+).
4. **Audit layer:** Plan 05's `audit_log` table is the append-only place to record consent-change events; future workflows that toggle marketing/analytics post-signup will emit `recordAudit({action:'consent.updated', ...})`.

## PII Inventory Count

12 PII-tagged columns across 3 tables:

- `audit_log`: `user_id`, `ip_address`, `user_agent`, `payload` (4)
- `consent_records`: `user_id`, `ip_address`, `user_agent` (3)
- `user`: `email`, `name`, `consent_version`, `consent_at`, `consent_ip` (5)

Every comment starts with `'PII:'` so the LGPD-03 inventory query in `docs/LGPD.md` matches them all via `LIKE 'PII:%'`.

## Decisions Made

1. **Migration numbers 0006 + 0007.** PLAN.md draft suggested 0004 + 0005 but Plan 04 already shipped 0003/0004/0005. The plan's frontmatter explicitly anticipated this drift; running `ls src/db/migrations/` confirmed.
2. **Hand-wrote 0006 instead of `drizzle-kit generate`.** The `consent_ip → ip_address` rename triggers an interactive prompt that the non-TTY execution context cannot answer (`Error: Interactive prompts require a TTY terminal`). Hand-writing is consistent with Plan 03's pattern (0000, 0002) and Plan 04's (0004, 0005). Hand-wrote both snapshots and verified via `pnpm db:check`.
3. **`consent_text` DEFAULT `''`.** Backward-compatible with Plan 04's `recordConsentMetadata` (which doesn't pass that field). New Plan 05 code paths pass the snapshot through. Decided against mandatory NOT NULL because that would have required a follow-up Plan 04 patch + back-fill — out of scope for this plan's goal of layering hardening on a stable base.
4. **`audit_log.user_id` is plain uuid (no FK).** Audit rows must outlive soft-deleted users (LGPD-05) and the future anonymize-after-retention job (Phase 4 LGPD-07). FK cascades would destroy evidence — explicitly avoided.
5. **PII comment prefix unified to `'PII:'`.** Initial draft used `'PII (low-sensitivity)'` etc., which did NOT match the canonical inventory query `LIKE 'PII:%'`. Auto-fixed in the same task before commit — caught by the plan's own SQL verification.
6. **22P02 (not 42501) is the canonical singleton-db misuse error code.** The CAST raises before the policy evaluates. The integration test accepts both codes but documents the reasoning. Postgres' choice to raise 22P02 is actually the stronger signal that the policy was reached.

## Deviations from Plan

### Auto-fixed Issues (Rule 1)

**1. [Rule 1 - Bug] PII comment prefix `'PII (low-sensitivity)'` does not match the canonical `LIKE 'PII:%'` inventory query**

- **Found during:** Task 1 first SQL verification (`SELECT count(*) ... WHERE description LIKE 'PII:%'` returned only 2 instead of the expected ≥3 on audit_log).
- **Issue:** I wrote `'PII (low-sensitivity): device fingerprint'` and `'PII (variable): may contain sanitized references ...'` — neither starts with `'PII:'`. The plan's automated verification expects ≥3 PII matches on audit_log.
- **Fix:** Unified every comment to start with `'PII:'`, with the sensitivity hint as a sub-clause (e.g. `'PII: low-sensitivity device fingerprint'`). Re-applied migration 0007 to the live DB.
- **Files modified:** `src/db/migrations/0007_pii_comments_and_audit_grants.sql`
- **Verification:** Query now returns 4 PII matches on audit_log, 12 total — both above acceptance bars.
- **Committed in:** `d80b8d9` (the fix was in-task, before Task 1 commit).

**2. [Rule 1 - Bug] Drizzle error wraps PostgresError; `.message` lookup returns "failed query: ..." not the SQLSTATE-aware message**

- **Found during:** Task 2 first test run of `audit-log-append-only.test.ts`.
- **Issue:** I checked `err.message.toLowerCase()` for "permission denied"; got "failed query: update ..." instead. Drizzle wraps the postgres.js `PostgresError` as `err.cause`.
- **Fix:** Added a small `extractPgError(err)` helper that walks the `cause` chain (max depth 5) looking for an object with a 5-char SQLSTATE code. Returns `{code, message}` from the PostgresError. Tests assert on `pg.code` (`'42501'` for UPDATE/DELETE rejection, `'22P02'` or `'42501'` for singleton-db misuse).
- **Files modified:** `tests/lgpd/audit-log-append-only.test.ts`
- **Verification:** All 4 audit-log test cases pass.
- **Committed in:** `f08e3df`.

**3. [Rule 1 - Bug] `recordAudit(db, ...)` test case passes singleton `db` which is typed as `PostgresJsDatabase`, not `TenantDb`**

- **Found during:** Task 2 typecheck run.
- **Issue:** The singleton-db misuse test deliberately passes `db: PostgresJsDatabase` to `recordAudit` which expects `TenantDb`. TypeScript correctly flags it as an error.
- **Fix:** `recordAudit(db as any, ...)` cast in the test, with a comment explaining the deliberate misuse. Added a `biome-ignore` annotation. The cast does NOT loosen the production type contract — only this single misuse test uses it.
- **Files modified:** `tests/lgpd/audit-log-append-only.test.ts`
- **Verification:** `pnpm typecheck` exits 0.
- **Committed in:** `f08e3df`.

### No Architectural Decisions (Rule 4)

No Rule 4 escalations. The schema changes (consent_records column rename + nullable tenant_id) were explicit in the plan; the migration number drift (0006/0007 instead of 0004/0005) was anticipated by the plan's frontmatter comment.

---

**Total deviations:** 3 auto-fixed (Rule 1). No scope expansion. No contract changes from PLAN.md.

## Known Stubs

| File / Line                                    | Stub Description                                                                                        | Resolution Plan                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/consent-banner.tsx:110`        | "Personalizar" button opens an `alert()` placeholder dialog ("Controles granulares estarão disponíveis em breve...") | Phase 1+ replaces with a granular shadcn `Dialog` exposing per-scope (analytics/marketing) toggles backed by the `granted_scopes` jsonb column |
| `src/components/consent-banner.tsx:54`         | POST to `/api/lgpd/consent` is fire-and-forget; the Route Handler does not exist in Phase 0 (404 expected) | Phase 1+ creates `src/app/api/lgpd/consent/route.ts` that calls `recordConsentMetadata` server-side                                         |

Both stubs are explicitly called out in the plan ("Customize is a no-op in Phase 0 — leads to a placeholder modal" / "The Server Action is okay to defer to a follow-up if the form gets too large in this task — but the cookie persistence MUST work in Phase 0"). The cookie persistence works — `localStorage.setItem('fb_lgpd_consent_v1', ...)` ships and is the legally sufficient minimum for unauthenticated visitors.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced beyond what the plan specified.

## Open Items for Plan 06 (Observability + Graphile-Worker)

- **Pino structured logging.** Plan 06's Pino child-logger binding should include the tenant context that `withTenant` already establishes. Audit writes should flow through Pino too so log-DB correlation is one query: `SELECT * FROM audit_log WHERE created_at BETWEEN ? AND ?` ↔ `WHERE x_request_id = ?` in the log aggregator.
- **`/api/lgpd/consent` Route Handler.** Wire the banner's fire-and-forget POST to call `recordConsentMetadata()` server-side. Either Plan 06 (if Pino + Route Handlers ship together) or Plan 1's first deploy plan.
- **Graphile-Worker anonymize job.** Phase 4 LGPD-07. The schema is ready: every PII column carries a `'PII:'` comment, so the job can introspect `information_schema` for tables to scrub.
- **`pg_dump` retention.** Migration 0007 references the retention policy in column comments; the actual data-lifecycle automation lands in Phase 4. Phase 0 documents the intent.

## Self-Check: PASSED

- **All 13 expected created files exist on disk:**
  - `src/db/schema/audit.ts` ✓
  - `src/db/migrations/{0006_lgpd_baseline,0007_pii_comments_and_audit_grants}.sql` ✓
  - `src/db/migrations/meta/{0006,0007}_snapshot.json` ✓
  - `src/lib/{audit,soft-delete}.ts` ✓
  - `src/components/consent-banner.tsx` ✓
  - `docs/LGPD.md` ✓
  - `tests/lgpd/{audit-log-append-only,consent-records,soft-delete,pii-comments}.test.ts` ✓

- **All 3 task commits reachable in `git log`:**
  - `d80b8d9` (Task 1 — schema + migrations 0006/0007)
  - `f08e3df` (Task 2 — helpers + 4 LGPD test files)
  - `6f59e17` (Task 3 — consent banner + docs/LGPD.md)

- **Quality gates:**
  - `pnpm test` → 14 test files, 46 tests, 0 failures, ~36s
  - `pnpm typecheck` → exit 0
  - `pnpm lint` → exit 0
  - `pnpm db:check` → exit 0 (no schema drift)
  - `pnpm build` → 9 routes, exit 0
  - `pnpm db:migrate` → idempotent

- **Live PG catalog matches contract** (verified above): `audit_log` + `consent_records` both FORCE RLS; `fb_eventos_app` has INSERT/SELECT but NOT UPDATE/DELETE on `audit_log`; 12 PII column comments.

- **Plan 04's `recordConsentMetadata` flow still works:** Plan 04's auth tests (6 files / 26 tests) all still GREEN after the `consent_ip → ip_address` rename + `consent_text` DEFAULT '' change.

---
*Phase: 00-foundation-stack-lock-anti-pitfall-hardening*
*Completed: 2026-06-12*
