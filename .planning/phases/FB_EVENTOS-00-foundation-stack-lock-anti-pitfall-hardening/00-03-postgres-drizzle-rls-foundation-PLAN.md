---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 03
type: execute
wave: 2
depends_on:
  - 00-01
  - 00-02
files_modified:
  - package.json
  - pnpm-lock.yaml
  - docker/compose.yml
  - drizzle.config.ts
  - src/db/index.ts
  - src/db/migrate.ts
  - src/db/with-tenant.ts
  - src/db/schema/index.ts
  - src/db/schema/tenants.ts
  - src/db/schema/roles.ts
  - src/db/schema/auth.ts
  - src/db/schema/consent.ts
  - src/db/migrations/0000_roles_and_extensions.sql
  - src/db/migrations/0001_initial.sql
  - src/db/migrations/0002_force_rls.sql
  - src/lib/env.ts
  - vitest.config.ts
  - src/test/setup.ts
  - src/test/db.ts
  - tests/db/with-tenant.test.ts
  - tests/db/rls-forced.test.ts
  - tests/db/role-no-bypassrls.test.ts
  - scripts/db/setup-roles.sh
  - .github/workflows/ci.yml
autonomous: true
requirements:
  - FOUND-08
  - FOUND-10
  - FOUND-15
  - FOUND-16
  - TENA-01
  - TENA-02
  - TENA-03
  - TENA-04
  - TENA-05
requirements_addressed:
  - FOUND-08
  - FOUND-10
  - FOUND-15
  - FOUND-16
  - TENA-01
  - TENA-02
  - TENA-03
  - TENA-04
  - TENA-05
tags:
  - postgres
  - drizzle
  - rls
  - multi-tenancy
  - schema
  - vitest
  - testcontainers
must_haves:
  truths:
    - "PostgreSQL 16 + MinIO + Mailpit boot via `docker compose -f docker/compose.yml up -d` (Redis is intentionally absent)"
    - "Two Postgres roles exist after migration: `fb_eventos_app` (DML, NO BYPASSRLS) and `fb_eventos_migrator` (DDL)"
    - "Postgres extensions `pgcrypto` and `pg_trgm` are present after migration"
    - "Drizzle schema declares `tenants`, Better Auth tables, and the `fb_eventos_app` role via `pgRole()`"
    - "Every tenant-owned table has `tenant_id uuid not null` FK to `tenants(id)` AND a `pgPolicy('tenant_isolation', ...)` using `current_setting('app.current_tenant_id', true)::uuid` AND is `FORCE ROW LEVEL SECURITY`"
    - "`withTenant(tenantId, fn)` wrapper opens a transaction, runs `SELECT set_config('app.current_tenant_id', $1, true)`, executes `fn(db)`, and resets on COMMIT — verified by integration test"
    - "`SELECT 1` query as `fb_eventos_app` against a tenant table without prior `set_config` returns 0 rows (RLS blocks default-deny)"
    - "Integration test proves `rolbypassrls = false` for `fb_eventos_app`"
    - "Drizzle schema migration applied via `pnpm drizzle-kit generate` + `pnpm drizzle-kit migrate` (NEVER push) — verified by `psql -c '\\dt'` showing expected tables"
  artifacts:
    - path: "docker/compose.yml"
      provides: "Local dev stack: postgres:16-alpine + minio + mailpit (NO Redis)"
      contains: "postgres:16-alpine"
    - path: "drizzle.config.ts"
      provides: "Drizzle Kit config using DATABASE_MIGRATOR_URL"
      contains: "DATABASE_MIGRATOR_URL"
    - path: "src/db/with-tenant.ts"
      provides: "withTenant() wrapper enforcing SET LOCAL"
      contains: "set_config('app.current_tenant_id'"
    - path: "src/db/migrations/0000_roles_and_extensions.sql"
      provides: "Two-role setup + extensions (pgcrypto, pg_trgm)"
      contains: "CREATE ROLE fb_eventos_app"
    - path: "src/db/migrations/0002_force_rls.sql"
      provides: "ALTER TABLE ... FORCE ROW LEVEL SECURITY for every tenant-owned table"
      contains: "FORCE ROW LEVEL SECURITY"
    - path: "vitest.config.ts"
      provides: "Vitest config + testcontainers setup hook"
    - path: "tests/db/rls-forced.test.ts"
      provides: "Asserts RLS is enabled AND forced AND blocks cross-tenant reads"
  key_links:
    - from: "src/db/with-tenant.ts"
      to: "src/db/index.ts"
      via: "postgres() pool from DATABASE_URL (fb_eventos_app role)"
      pattern: "DATABASE_URL"
    - from: "drizzle.config.ts"
      to: "DATABASE_MIGRATOR_URL"
      via: "dbCredentials.url"
      pattern: "DATABASE_MIGRATOR_URL"
    - from: "src/db/migrations/0002_force_rls.sql"
      to: "every tenant-owned table"
      via: "ALTER TABLE ... FORCE ROW LEVEL SECURITY"
      pattern: "FORCE ROW LEVEL SECURITY"
---

<objective>
Stand up Postgres 16 + Drizzle ORM 0.45.2 + the two-role security model + the RLS infrastructure that every subsequent plan (and every later phase) depends on. This is the contract-critical plan: if RLS is not FORCED and `fb_eventos_app` has BYPASSRLS, the entire multi-tenant promise of FB_EVENTOS is broken. Every guard is implemented and tested HERE, before any auth or domain code is written.

Purpose: Mitigates T-0-01 (cross-tenant RLS bypass — high) at the deepest possible layer (the database itself), defuses FB_APU04 pitfalls #2 (multi-tenant via config-stem) and #17 (self-healing migrations). Provides the `withTenant()` wrapper that Plans 04+ consume.

Output: Bootable Postgres+MinIO+Mailpit compose stack; two-role Postgres setup; Drizzle schema for `tenants`, Better Auth tables, and RLS policies; `withTenant()` wrapper; first three Drizzle SQL migrations (roles+extensions, initial schema, force-RLS); Vitest infra with testcontainers; three RLS integration tests proving the contract holds.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/research/ARCHITECTURE.md
@.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md
@.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-VALIDATION.md

<interfaces>
<!-- Required imports + signatures executor MUST use exactly. -->

# from RESEARCH Pattern 1 (events example) — apply same pattern to every tenant-owned table:
from 'drizzle-orm/pg-core':
  pgTable, uuid, text, timestamp, pgPolicy, pgRole, index
from 'drizzle-orm':
  sql

# from RESEARCH Pattern 3:
src/db/with-tenant.ts exports:
  type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>
  function withTenant<T>(tenantId: string, fn: (db: DrizzleDB) => Promise<T>): Promise<T>

src/db/index.ts exports:
  const db: DrizzleDB             // singleton for non-tenant-scoped reads (tenants table lookup, health check)
  const pool: postgres.Sql        // raw postgres.js client

src/db/migrate.ts exports:
  async function runMigrations(): Promise<void>  // uses DATABASE_MIGRATOR_URL — called from CI deploy step ONLY

# Better Auth tables (Plan 04 consumes these; we declare the schema NOW so RLS policies cover them).
# We only declare structural columns required for org-as-tenant; Better Auth migrations may add more later.

# Environment contract (set by docker/compose.yml + .env.example from Plan 01):
DATABASE_URL=postgresql://fb_app_user:<pw>@localhost:5432/fb_eventos_dev
DATABASE_MIGRATOR_URL=postgresql://fb_migrator:<pw>@localhost:5432/fb_eventos_dev
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install Drizzle + postgres.js, write docker-compose, draft schema with RLS policies</name>
  <files>package.json, docker/compose.yml, drizzle.config.ts, src/db/index.ts, src/db/migrate.ts, src/db/schema/index.ts, src/db/schema/tenants.ts, src/db/schema/roles.ts, src/db/schema/auth.ts, src/db/schema/consent.ts, src/lib/env.ts, scripts/db/setup-roles.sh</files>
  <read_first>
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Standard Stack", "Pattern 1: Drizzle RLS Schema with pgPolicy", "Pattern 2: Two-Role Postgres Setup", "Pattern 3: withTenant", "Pattern 7: Drizzle Config", "Local Dev Docker Compose")
    - .env.example (from Plan 01 — has DATABASE_URL + DATABASE_MIGRATOR_URL keys)
    - CLAUDE.md (sections "Core Technologies", "Multi-Tenancy Strategy")
  </read_first>
  <behavior>
    - Schema: `tenants` table exists with `id uuid pk`, `slug text unique not null`, `name text not null`, `created_at timestamptz default now() not null`, `deleted_at timestamptz`.
    - Schema: `pgRole('fb_eventos_app', ...)` is exported from `src/db/schema/roles.ts`.
    - Schema: Better Auth tables `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` are declared with `tenant_id uuid not null references tenants(id)` on every tenant-scoped row, AND a `pgPolicy('tenant_isolation', {to: fbEventosApp, using: sql\`tenant_id = current_setting('app.current_tenant_id', true)::uuid\`})`, AND `.withRLS()`.
      - Exception: `user` and `tenants` themselves are global lookup — `user` is referenced cross-tenant via `member` join; `tenants` has no RLS (no tenant_id column).
    - docker/compose.yml boots `postgres:16-alpine` on 5432 with `pg_dev` user; `minio` on 9000/9001; `mailpit` on 1025/8025. Redis is INTENTIONALLY absent.
    - `drizzle.config.ts` uses `DATABASE_MIGRATOR_URL` (NOT `DATABASE_URL`), `strict: true`, `verbose: true`, dialect `postgresql`.
    - `src/db/index.ts` exports `db` (drizzle wrapper around `postgres(DATABASE_URL)`) and `pool` (raw postgres.js client). Default-deny: any `db.select()` outside `withTenant()` against a tenant-owned table returns 0 rows due to RLS (verified in Task 3).
    - `src/db/migrate.ts` exports `runMigrations()` that uses `DATABASE_MIGRATOR_URL`. Calling it from app boot is forbidden (T-0-03 mitigation; enforced by CI scripts/ci/check-no-drizzle-push.sh from Plan 02 and by convention here — see comment in file).
  </behavior>
  <action>
    Mitigates T-0-01 by establishing RLS in the schema declarations themselves (you cannot write a tenant-owned table without thinking about its policy because the type-level convention forces it).

    1. Install packages (per RESEARCH Standard Stack — pin exactly):
       ```
       pnpm add drizzle-orm@0.45.2 postgres@3.4.9
       pnpm add -D drizzle-kit@0.31.10 @types/pg
       ```

    2. Update `src/lib/env.ts` to Zod-validate `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_SECRET` (min length 32), `LOG_LEVEL` (enum `'fatal'|'error'|'warn'|'info'|'debug'|'trace'`), `NODE_ENV` (enum), `TZ`. Export typed `env` object. Use zod 4 syntax: `z.string().min(...)`, `z.email()` etc. (NOTE: `zod` will be added in Plan 04, so here use `process.env.X!` non-null asserts — TODO comment for Plan 04 to add Zod validation. Centralize lookups so the upgrade is mechanical.)

    3. Create `docker/compose.yml` per RESEARCH "Local Dev Docker Compose": services `postgres` (image `postgres:16-alpine`, port 5432, env `POSTGRES_USER=fb_dev`, `POSTGRES_PASSWORD=fb_dev`, `POSTGRES_DB=fb_eventos_dev`, command `postgres -c log_statement=all -c timezone=America/Sao_Paulo -c max_connections=100`, volume `pg_data:/var/lib/postgresql/data`, healthcheck `pg_isready -U fb_dev`); `minio` (image `minio/minio:RELEASE.2025-01-01` — pin a specific tag, NOT `:latest` per T-0-07; the minio team publishes weekly releases, use any recent immutable tag); `mailpit` (image `axllent/mailpit:v1.20` — pin major.minor, NOT `:latest`). Add comment `# Redis is intentionally absent. Graphile-Worker uses Postgres (Plan 06 ADR-001).` Add named volume `pg_data`.

    4. Create `scripts/db/setup-roles.sh` — bootstrap script for local dev that connects as the docker-compose superuser `fb_dev` and runs `CREATE ROLE fb_eventos_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; CREATE ROLE fb_eventos_migrator NOLOGIN NOSUPERUSER CREATEDB; CREATE USER fb_app_user WITH PASSWORD 'fb_app_dev_pw' IN ROLE fb_eventos_app; CREATE USER fb_migrator WITH PASSWORD 'fb_migrator_dev_pw' IN ROLE fb_eventos_migrator; GRANT ALL ON DATABASE fb_eventos_dev TO fb_migrator;`. The script is idempotent (`IF NOT EXISTS` where supported; otherwise wrap in DO block with PL/pgSQL EXCEPTION). This script is for local dev only; production roles are created by Coolify migration step (documented in Plan 07).

    5. Create `drizzle.config.ts` per RESEARCH Pattern 7. Critical: `dbCredentials.url: process.env.DATABASE_MIGRATOR_URL!` (NOT `DATABASE_URL`).

    6. Create `src/db/schema/roles.ts`:
       ```
       import { pgRole } from 'drizzle-orm/pg-core';
       export const fbEventosApp = pgRole('fb_eventos_app', {
         createDb: false, createRole: false, inherit: true,
       });
       ```

    7. Create `src/db/schema/tenants.ts`: `tenants` table with `id uuid pk defaultRandom`, `slug text not null unique`, `name text not null`, `createdAt`, `deletedAt`. NO RLS (global lookup). Add unique index on `slug`. Add `index('tenants_deleted_at_idx').on(table.deletedAt)`.

    8. Create `src/db/schema/auth.ts` declaring the Better Auth core tables per RESEARCH Pattern 5. EVERY org-scoped row gets `tenantId uuid not null references tenants(id)` AND a `pgPolicy('tenant_isolation', ...)` AND `.withRLS()`. The `user` table has columns required by Better Auth (`id`, `email`, `emailVerified`, `name`, `image`, `createdAt`, `updatedAt`) PLUS the LGPD additionalFields columns from RESEARCH Pattern 5 (`consentVersion text`, `consentAt timestamptz`, `consentIp text`) — these are added now so Better Auth's additionalFields read/write correctly (mitigates RESEARCH Pitfall 6). Add `deletedAt timestamptz` for soft-delete (LGPD-05 foundation, schema-only — query helpers come in Plan 05).

    8b. Create `src/db/schema/consent.ts` as a STUB declaring the `consentRecords` Drizzle table with the minimum columns required by Plan 04's `recordConsentMetadata` insert: `id uuid pk default gen_random_uuid()`, `userId uuid not null references user.id on delete cascade`, `tenantId uuid not null references tenants(id)`, `consentVersion text not null`, `consentAt timestamptz not null default now()`, `consentIp text`, `userAgent text`. Export the `consentRecords` symbol. **This is a STUB** — Plan 05 layers `FORCE ROW LEVEL SECURITY`, `REVOKE UPDATE/DELETE FROM fb_eventos_app` grants, the tenant_isolation `pgPolicy`, additional columns (`consentText`, granted_scopes), and PII `COMMENT ON COLUMN` statements on top of this base table. Do NOT add policies, FORCE RLS, or grants here — those belong to Plan 05.

    9. Create `src/db/schema/index.ts` re-exporting all schemas: `tenants`, `roles`, `auth`, `consent` (stub from step 8b). (Plan 05 will add `audit` and extend `consent` with policies/grants; Plan 04 will add anything Better Auth org plugin requires extra.)

    10. Create `src/db/index.ts` with `pool = postgres(env.DATABASE_URL, { max: 20 })` and `db = drizzle(pool, { schema })`.

    11. Create `src/db/migrate.ts` with `runMigrations()` that connects via `DATABASE_MIGRATOR_URL` and runs `migrate(drizzle(postgres(env.DATABASE_MIGRATOR_URL!, { max: 1 })), { migrationsFolder: './src/db/migrations' })`. Add a top-of-file comment: `// DO NOT call this from src/app/** or src/middleware.ts — migrations run only in CI deploy step (.github/workflows/build-and-push.yml + Coolify post-deploy hook). See pitfall #17.`

    12. Add npm scripts to `package.json`:
        - `"db:up"`: `docker compose -f docker/compose.yml up -d`
        - `"db:down"`: `docker compose -f docker/compose.yml down`
        - `"db:setup-roles"`: `bash scripts/db/setup-roles.sh`
        - `"db:generate"`: `drizzle-kit generate`
        - `"db:migrate"`: `tsx src/db/migrate.ts`
        - `"db:check"`: `drizzle-kit check` (verifies schema vs migrations are in sync — catches uncommitted schema drift)

    Per D-01/D-04 (researcher reconciliation): NO Redis container. Two-role pattern is mandatory. `DATABASE_MIGRATOR_URL` (NOT `DATABASE_URL`) drives Drizzle Kit. NO `drizzle-kit push` in any script.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && test -f docker/compose.yml && grep -q 'postgres:16-alpine' docker/compose.yml && ! grep -E 'redis|:latest' docker/compose.yml && grep -q 'pgRole.*fb_eventos_app' src/db/schema/roles.ts && grep -q "current_setting('app.current_tenant_id'" src/db/schema/auth.ts && grep -q 'withRLS' src/db/schema/auth.ts && grep -q 'DATABASE_MIGRATOR_URL' drizzle.config.ts && ! grep -q 'drizzle-kit push' package.json</automated>
  </verify>
  <acceptance_criteria>
    - `docker/compose.yml` exists with `postgres:16-alpine`, `minio` (pinned tag), `mailpit` (pinned tag); contains literal text `Redis is intentionally absent`; does NOT contain word `redis` or `:latest`
    - `drizzle.config.ts` uses `DATABASE_MIGRATOR_URL` (grep matches), has `strict: true`, dialect `postgresql`
    - `src/db/schema/roles.ts` exports `fbEventosApp` (pgRole)
    - `src/db/schema/tenants.ts` exports `tenants` table — NO RLS policy on this table (global lookup)
    - `src/db/schema/auth.ts` includes `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation` tables; every tenant-owned table has: (a) `tenantId uuid not null` column, (b) `pgPolicy('tenant_isolation', ...)` using `current_setting('app.current_tenant_id', true)::uuid`, (c) `.withRLS()` chained on the table builder
    - `src/db/schema/auth.ts` `user` table includes `consentVersion`, `consentAt`, `consentIp`, `deletedAt` columns
    - `src/db/schema/consent.ts` exists and exports `consentRecords` symbol (STUB — Plan 05 layers RLS/grants/comments on top)
    - `pnpm db:generate` (run in Task 2) produces a migration containing `CREATE TABLE "consent_records"`
    - `src/db/index.ts` exports `db` and `pool`
    - `src/db/migrate.ts` exports `runMigrations()` and the file contains the load-bearing comment forbidding boot-time invocation
    - `package.json` adds scripts `db:up`, `db:down`, `db:setup-roles`, `db:generate`, `db:migrate`, `db:check`; does NOT add `db:push`
    - `pnpm tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>Stack boots (`pnpm db:up`); schema declares RLS policies on every tenant-owned table; two-role pattern bootstrap script exists; migrations are a one-shot CLI never invoked from app code.</done>
</task>

<task type="auto" tdd="true" gate="blocking">
  <name>Task 2: [BLOCKING] Generate SQL migrations, write FORCE-RLS migration, apply migrations, verify table presence</name>
  <files>src/db/migrations/0000_roles_and_extensions.sql, src/db/migrations/0001_initial.sql, src/db/migrations/0002_force_rls.sql, src/db/migrations/meta/_journal.json, src/db/migrations/meta/0000_snapshot.json, src/db/migrations/meta/0001_snapshot.json, src/db/migrations/meta/0002_snapshot.json</files>
  <read_first>
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Pattern 1" — note the `ALTER TABLE ... FORCE ROW LEVEL SECURITY` requirement, "Pattern 2", "Pattern 9: LGPD Baseline Schema" — note the `CREATE EXTENSION IF NOT EXISTS pgcrypto/pg_trgm`)
    - src/db/schema/*.ts (from Task 1)
    - scripts/db/setup-roles.sh (from Task 1)
  </read_first>
  <behavior>
    - `0000_roles_and_extensions.sql` is hand-written (drizzle-kit doesn't generate role DDL): creates `fb_eventos_app` and `fb_eventos_migrator` roles; creates `pgcrypto` and `pg_trgm` extensions; grants USAGE on schema public + DML on all current and future tables to `fb_eventos_app`.
    - `0001_initial.sql` is generated by `pnpm db:generate` from the Drizzle schema (Task 1) — contains CREATE TABLE for tenants, user, session, account, verification, organization, member, invitation + CREATE POLICY statements (Drizzle generates these from `pgPolicy()` declarations).
    - `0002_force_rls.sql` is hand-written: `ALTER TABLE <name> FORCE ROW LEVEL SECURITY` for every tenant-owned table (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`). FORCE is what prevents the table owner (the migrator role itself!) from bypassing policies — without it, RLS only applies to non-owner roles.
    - After `pnpm db:migrate`, `psql $DATABASE_MIGRATOR_URL -c '\dt'` lists all expected tables.
    - After migration, `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('user','session','account','verification','organization','member','invitation')` returns rows where both bools are `true`.
    - After migration, `SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'` returns `false`.
  </behavior>
  <action>
    Mitigates T-0-01 (RLS bypass) and T-0-03 (self-healing migration). This is the [BLOCKING] schema migration task — phase CANNOT pass verification without it.

    1. Create `src/db/migrations/0000_roles_and_extensions.sql` BY HAND (drizzle-kit does not generate role DDL). Content (per RESEARCH Pattern 2 + Pattern 9):
       ```sql
       -- Roles: idempotent creation
       DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_app') THEN
           CREATE ROLE fb_eventos_app NOLOGIN NOINHERIT NOSUPERUSER
             NOCREATEDB NOCREATEROLE NOBYPASSRLS;
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_migrator') THEN
           CREATE ROLE fb_eventos_migrator NOLOGIN NOSUPERUSER CREATEDB;
         END IF;
       END $$;

       GRANT USAGE ON SCHEMA public TO fb_eventos_app;
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fb_eventos_app;
       ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fb_eventos_app;
       ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO fb_eventos_app;

       CREATE EXTENSION IF NOT EXISTS pgcrypto;
       CREATE EXTENSION IF NOT EXISTS pg_trgm;
       ```

    2. Run `pnpm db:up`, then `pnpm db:setup-roles` (for local dev fb_app_user and fb_migrator login users), then `pnpm db:generate`. Drizzle Kit produces `0001_initial.sql` + meta files describing tables + CREATE POLICY statements. Review the generated file: confirm it contains `CREATE TABLE "user"`, `CREATE TABLE "tenants"`, and `CREATE POLICY "tenant_isolation"` for each tenant-scoped table. If any policy is missing, fix the schema in Task 1 and regenerate.

    3. Create `src/db/migrations/0002_force_rls.sql` BY HAND:
       ```sql
       -- FORCE RLS prevents table owner (the migration role) from bypassing the policy.
       -- Without FORCE, a query as the owner role returns ALL rows (RLS only applies to non-owner roles).
       ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
       ALTER TABLE "session" FORCE ROW LEVEL SECURITY;
       ALTER TABLE "account" FORCE ROW LEVEL SECURITY;
       ALTER TABLE "verification" FORCE ROW LEVEL SECURITY;
       ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
       ALTER TABLE "member" FORCE ROW LEVEL SECURITY;
       ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
       -- tenants is intentionally NOT forced — global lookup table
       ```

    4. Update `src/db/migrations/meta/_journal.json` (manual entry for 0000 and 0002 since drizzle-kit only generated 0001) — follow the existing meta JSON format observed in the 0001 entry.

    5. Run `pnpm db:migrate`. Verify by spawning a `psql` (or `pool.unsafe()`) query: `\dt` lists 8+ tables (tenants + Better Auth core); `\du` shows fb_eventos_app with `Cannot login`, `No inheritance` flags and the BYPASSRLS column reads `false`.

    6. Run `pnpm db:check` — must exit 0 (schema in sync with migrations; catches dirty schema if Task 1 was edited after generate).

    Per CLAUDE.md "Self-healing schema migration logic": migration files are committed to git; `_journal.json` is committed; NEVER `drizzle-kit push`. NEVER `DROP TABLE schema_migrations`. If a migration is bad, generate a new corrective migration — never edit history.

    Important: Drizzle's generated `CREATE POLICY` may use a `TO public` clause when our schema specifies `to: fbEventosApp`. Verify the generated `0001_initial.sql` has `TO "fb_eventos_app"` (or whatever Drizzle emits for the pgRole reference). If not, regenerate after fixing the schema.
  </action>
  <verify>
    <automated>pnpm db:up && sleep 5 && pnpm db:setup-roles && pnpm db:generate && pnpm db:migrate && pnpm db:check && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('tenants','user','session','account','verification','organization','member','invitation')" | grep -q '^8$' && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT count(*) FROM pg_class WHERE relname IN ('user','session','organization','member') AND relforcerowsecurity=true" | grep -q '^4$' && PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -tAc "SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'" | grep -q '^f$'</automated>
  </verify>
  <acceptance_criteria>
    - File `src/db/migrations/0000_roles_and_extensions.sql` exists and contains `CREATE ROLE fb_eventos_app` AND `NOBYPASSRLS` AND `CREATE EXTENSION IF NOT EXISTS pgcrypto` AND `CREATE EXTENSION IF NOT EXISTS pg_trgm`
    - File `src/db/migrations/0001_initial.sql` exists (generated) and contains `CREATE TABLE "tenants"`, `CREATE TABLE "user"`, and `CREATE POLICY "tenant_isolation"` lines for each tenant-scoped table
    - File `src/db/migrations/0002_force_rls.sql` exists and contains `FORCE ROW LEVEL SECURITY` for: user, session, account, verification, organization, member, invitation (7+ ALTER TABLE statements)
    - `src/db/migrations/meta/_journal.json` lists all three migrations
    - `pnpm db:migrate` exits 0
    - `pnpm db:check` exits 0 (no schema drift)
    - SQL assertion: `SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'` returns `f`
    - SQL assertion: `SELECT count(*) FROM pg_class WHERE relname IN ('user','session','account','verification','organization','member','invitation') AND relforcerowsecurity=true` returns 7
    - SQL assertion: `SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','pg_trgm')` returns 2 rows
    - No file in the repo contains the string `drizzle-kit push` (verified by `bash scripts/ci/check-no-drizzle-push.sh`)
  </acceptance_criteria>
  <done>Postgres schema is materially loaded; RLS is enabled AND forced on every tenant-owned table; `fb_eventos_app` cannot bypass policies; extensions are present; migrations are explicit SQL files with no self-healing. **This task is BLOCKING — Phase 0 verification fails without this.**</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: withTenant() wrapper + Vitest harness + three load-bearing RLS integration tests</name>
  <files>src/db/with-tenant.ts, vitest.config.ts, src/test/setup.ts, src/test/db.ts, tests/db/with-tenant.test.ts, tests/db/rls-forced.test.ts, tests/db/role-no-bypassrls.test.ts, package.json</files>
  <read_first>
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Pattern 3: withTenant", "Validation Architecture", "Pitfall 3: SET vs SET LOCAL")
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-VALIDATION.md (sections "Test Infrastructure", "Wave 0 Requirements")
    - src/db/schema/*.ts (from Task 1)
    - src/db/migrations/*.sql (from Task 2)
  </read_first>
  <behavior>
    - `withTenant(tenantId, fn)` opens a postgres.js transaction, sets `app.current_tenant_id` transaction-locally via `set_config(..., true)`, calls `fn(drizzle(tx))`, returns the result; the setting resets on COMMIT (verified by a follow-up `current_setting` query returning empty string in a separate transaction).
    - Vitest harness in `src/test/setup.ts` reads `DATABASE_URL` (test compose stack on a separate db schema or the same dev db, isolated by test data prefixes). For Phase 0 we use the dev compose stack directly with truncate-between-tests.
    - `tests/db/role-no-bypassrls.test.ts` asserts `SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'` returns `false` (TENA-03).
    - `tests/db/rls-forced.test.ts` asserts that connecting AS `fb_eventos_app` and SELECTing from `user` (a tenant-owned table) WITHOUT calling `withTenant` returns 0 rows even when rows exist (RLS default-deny + FORCE prove tenant isolation). Then asserts that the SAME connection inside `withTenant(tenantId)` sees rows for `tenantId` only.
    - `tests/db/with-tenant.test.ts` asserts that `set_config` is transaction-local: opens a `withTenant` block, ends it, then queries `current_setting('app.current_tenant_id', true)` and asserts empty string (NULL semantics) — confirms RESEARCH Pitfall 3 mitigation.
  </behavior>
  <action>
    Mitigates T-0-01 by making the contract testable and asserted on every CI run.

    1. Install Vitest + testing helpers:
       ```
       pnpm add -D vitest@~4.1.8 @vitest/ui @vitejs/plugin-react@~6.0.2 tsx
       ```

    2. Create `src/db/with-tenant.ts` per RESEARCH Pattern 3. Use `pool.begin(async (tx) => { await tx\`SELECT set_config('app.current_tenant_id', ${tenantId}, true)\`; ... })`. Critical: use `set_config(..., true)` (transaction-local), NOT `SET app.current_tenant_id = ...` (connection-level — Pitfall 3). Add a JSDoc comment on the function citing Pitfall 3 explicitly.

    3. Create `vitest.config.ts` per RESEARCH "Validation Architecture":
       ```typescript
       import { defineConfig } from 'vitest/config';
       import path from 'path';
       export default defineConfig({
         test: {
           environment: 'node',
           globals: true,
           setupFiles: ['./src/test/setup.ts'],
           alias: { '@': path.resolve(__dirname, './src') },
           testTimeout: 30000,
           pool: 'forks',
           poolOptions: { forks: { singleFork: true } }, // serialize DB tests
         },
       });
       ```

    4. Create `src/test/setup.ts` — global hooks. Use `beforeAll` to truncate the relevant tables (`tenants`, `user`, `organization`, `member` etc.) using the migrator role (so RLS doesn't get in the way of cleanup); use `afterEach` to truncate.

    5. Create `src/test/db.ts` — helper exporting (a) `appPool` (postgres.js client using `DATABASE_URL` / fb_eventos_app role), (b) `migratorPool` (using `DATABASE_MIGRATOR_URL` for setup/teardown), (c) `createTenant(slug, name)` that inserts via migratorPool and returns the tenant_id, (d) `createUserInTenant(tenantId, email)`.

    6. Create `tests/db/role-no-bypassrls.test.ts`:
       ```typescript
       import { test, expect } from 'vitest';
       import { migratorPool } from '@/test/db';
       test('fb_eventos_app role does NOT have BYPASSRLS', async () => {
         const rows = await migratorPool`SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'`;
         expect(rows[0]?.rolbypassrls).toBe(false);
       });
       ```

    7. Create `tests/db/with-tenant.test.ts`:
       - Test 1: `withTenant(tenantId, async (db) => ...)` returns the callback's value.
       - Test 2: `set_config` is transaction-local: inside withTenant, `current_setting('app.current_tenant_id', true)` equals `tenantId`. Outside the block (next transaction), it equals empty string (`''` in postgres.js).
       - Test 3: Two concurrent `withTenant` calls do NOT leak: tenant A's setting cannot be read inside tenant B's block.

    8. Create `tests/db/rls-forced.test.ts`:
       - Setup: insert 1 row into `user` table for tenant A and 1 row for tenant B via migratorPool (which can bypass RLS because we're inserting via the migrator role with FORCE applied to data — note: FORCE applies to the table owner too, so the migrator must SET LOCAL during insert OR we use a `SECURITY DEFINER` helper OR we insert before policies are forced... easiest: have migratorPool `SET LOCAL app.current_tenant_id` per insert).
       - Test 1: `appPool` (fb_eventos_app role) SELECTing from `user` WITHOUT `withTenant` returns 0 rows (default-deny).
       - Test 2: `withTenant(tenantA, db => db.select().from(user))` returns exactly 1 row (tenant A's row).
       - Test 3: `withTenant(tenantB, db => db.select().from(user))` returns exactly 1 row (tenant B's row).
       - Test 4: `withTenant(tenantA, ...)` cannot read tenant B's rows (asserts isolation explicitly).

    9. Add npm scripts to `package.json`:
       - `"test:unit"`: `vitest run --reporter=verbose`
       - `"test:watch"`: `vitest`
       - `"test"`: `vitest run`

    10. Update `.github/workflows/ci.yml` `test` job (Plan 02): replace `pnpm vitest run --passWithNoTests` with `pnpm test:unit` (no `--passWithNoTests` needed now since tests exist). The job already has Postgres service per Plan 02.

    Per D-01: tests prove the contract. If any test in Tasks 6, 7, 8 above fails, the entire Phase 0 contract is broken — STOP and fix before proceeding to Plan 04.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && pnpm test:unit && grep -q "set_config('app.current_tenant_id'" src/db/with-tenant.ts && grep -q "true" src/db/with-tenant.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/db/with-tenant.ts` exports `withTenant<T>(tenantId: string, fn: (db: DrizzleDB) => Promise<T>): Promise<T>`
    - `withTenant` implementation uses `set_config('app.current_tenant_id', tenantId, true)` (with the literal `true` flag — verified by grep)
    - `withTenant` implementation does NOT use bare `SET app.current_tenant_id` (verified by `! grep -E "tx\\\`\\s*SET\\s+app" src/db/with-tenant.ts`)
    - `vitest.config.ts` exists with `pool: 'forks'`, `singleFork: true`
    - `src/test/setup.ts` truncates tables between tests
    - `tests/db/role-no-bypassrls.test.ts` exists; `pnpm test:unit -t "BYPASSRLS"` passes
    - `tests/db/with-tenant.test.ts` exists with at least 3 test cases (return value, transaction-local, concurrent isolation); all pass
    - `tests/db/rls-forced.test.ts` exists with 4+ test cases proving default-deny + per-tenant visibility + cross-tenant blocking; all pass
    - `.github/workflows/ci.yml` `test` job calls `pnpm test:unit` (not `--passWithNoTests`)
    - `pnpm test:unit` exits 0 with all RLS tests green
  </acceptance_criteria>
  <done>`withTenant()` wrapper is implemented per RESEARCH Pattern 3 with SET LOCAL semantics; Vitest harness runs RLS contract tests; three load-bearing tests prove `rolbypassrls=false`, `set_config` is transaction-local, and RLS blocks cross-tenant reads; CI test job runs all of this on every PR.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| App connection (fb_eventos_app) → tenant-owned table | RLS policy enforces tenant_id = current_setting; without `withTenant` → 0 rows returned (default-deny) |
| Migrator connection (fb_eventos_migrator) → tenant-owned table | FORCE RLS prevents owner-bypass; setup code must explicitly opt in via SET LOCAL or run before FORCE |
| App boot → schema migrations | `runMigrations()` is documented as deploy-step-only; no auto-call from app code |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-0-01 | Information Disclosure (high) | every tenant-owned table | mitigate | RLS enabled + FORCE + fb_eventos_app NO BYPASSRLS + pgPolicy on every table + withTenant() wrapper + 3 integration tests (rls-forced, with-tenant, role-no-bypassrls) |
| T-0-03 | Tampering (high) | drizzle-kit migration discipline | mitigate | Migrations are committed SQL files; runMigrations() is documented deploy-only; CI gate from Plan 02 blocks `drizzle-kit push` |
| T-0-04 | Tampering | embedded-DB drift | mitigate | docker/compose.yml uses postgres:16-alpine; no SQLite anywhere; CI gate from Plan 02 |
| (RESEARCH Pitfall 3) | Information Disclosure | SET vs SET LOCAL on pooled connections | mitigate | withTenant uses `set_config(..., true)` exclusively; with-tenant.test.ts proves transaction-local semantics |
| (RESEARCH Pitfall 8) | Information Disclosure | Graphile-Worker uses pg driver, separate pool | accept-now-document | Plan 06 will instrument Graphile-Worker task handlers to call withTenant() — flagged for Plan 06's design |
</threat_model>

<verification>
1. `pnpm db:up && pnpm db:setup-roles && pnpm db:generate && pnpm db:migrate && pnpm db:check` succeeds end-to-end.
2. `PGPASSWORD=fb_dev psql -h localhost -U fb_dev -d fb_eventos_dev -c '\dt'` lists tenants + Better Auth tables.
3. `pnpm test:unit` is green; specifically the three load-bearing tests in `tests/db/`.
4. `SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'` returns `false`.
5. `SELECT count(*) FROM pg_class WHERE relname IN ('user','session','account','verification','organization','member','invitation') AND relforcerowsecurity=true` returns 7.
</verification>

<success_criteria>
- Postgres 16 + Drizzle 0.45.2 + postgres.js 3.4.9 installed at pinned versions
- docker/compose.yml boots local stack (postgres + minio + mailpit, NO Redis)
- Two-role pattern (fb_eventos_app NO BYPASSRLS, fb_eventos_migrator with DDL) materialized in DB
- RLS is `FORCE ROW LEVEL SECURITY` on every tenant-owned Better Auth table
- `withTenant()` wrapper enforces transaction-local SET via `set_config(..., true)`
- Three RLS contract integration tests pass: BYPASSRLS=false, SET LOCAL transaction-local, cross-tenant blocked
- Drizzle migrations are committed SQL files; `db:check` exits 0 (no drift)
- TENA-01..05 covered by schema + tests; FOUND-15/16 covered by version pin + extensions migration
</success_criteria>

<output>
Create `.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-03-SUMMARY.md` listing:
- Migration file names + what each does
- `withTenant` import path + signature
- The three load-bearing RLS tests + their assertion summaries
- T-0-01 mitigation status (mitigated, with test evidence pointers)
- Open items for Plan 04 (Better Auth integration consumes the user/session/organization tables declared here)
</output>
