# Coolify Service Manifest — `fb-eventos-postgres`

**Plan 07, Phase 0 — Coolify-managed Postgres + RLS two-role model.**

PostgreSQL is the **single source of truth** for FB_EVENTOS (CLAUDE.md
"Embedded-DB Anti-Pattern: Explicit Architecture Guard"). The Coolify-
managed Postgres service is the only persistence layer.

---

## Image

```
postgres:16-alpine
```

- Coolify provides Postgres 16 as a managed service. NO custom image.
- **NO floating tag** — Coolify pins the major (`16`); the alpine variant
  matches `docker/compose.yml` (local dev parity).
- Version 16 matches Plan 03 RESEARCH; logical replication on partitioned
  tables (Phase 4 audit_log partitioning).

## Volume

```
pg_data: persistent volume (Coolify managed)
```

Coolify provides the volume; do NOT bind-mount the host filesystem in
production (different driver semantics break PITR).

## Connection Strings

Two connection strings, one per role. Coolify exposes the internal
hostname (e.g. `coolify-postgres-internal`) and a managed secret for
each user.

```
DATABASE_URL=postgresql://fb_app_user:{{DB_APP_PASSWORD}}@{{COOLIFY_PG_HOST}}:5432/fb_eventos
DATABASE_MIGRATOR_URL=postgresql://fb_migrator:{{DB_MIGRATOR_PASSWORD}}@{{COOLIFY_PG_HOST}}:5432/fb_eventos
```

- `{{COOLIFY_PG_HOST}}` — Coolify-internal hostname; not exposed publicly.
- Passwords stored in Coolify env UI (NEVER committed).
- Database name `fb_eventos` (production); `fb_eventos_dev` in dev/CI.

## Roles to Provision (one-time, post-deploy)

The bootstrap script `scripts/db/setup-roles.sh` (Plan 03) creates the
two-role model. Run it ONCE after Coolify provisions the Postgres service:

```bash
PG_BOOTSTRAP_URL='postgresql://coolify_pg_admin:CHANGE@host:5432/postgres' \
  bash scripts/db/setup-roles.sh
```

This creates:

- **`fb_eventos_app`** — runtime role used by web + worker.
  - `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, **`NOBYPASSRLS`** (critical).
  - GRANT `SELECT, INSERT, UPDATE, DELETE` on tenant-scoped tables.
  - GRANT `USAGE` on `graphile_worker` schema + DML on its tables.
- **`fb_eventos_migrator`** — DDL role used by the pre-deploy hook ONLY.
  - `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, **`NOBYPASSRLS`**
    (yes — even the migrator does not bypass RLS; it doesn't need to).
  - `CREATE` on schema, table owner of every Drizzle-managed table.
  - Pre-deploy hook reads `DATABASE_MIGRATOR_URL` exclusively.

## Verification SQL (run during Task 3 checkpoint)

```sql
-- 1. Roles + bypass-rls invariant (TENA-03 / T-0-01)
SELECT rolname, rolbypassrls
FROM pg_roles
WHERE rolname IN ('fb_eventos_app', 'fb_eventos_migrator');
-- Expected:
--   fb_eventos_app       | f
--   fb_eventos_migrator  | f

-- 2. FORCE RLS still active on every tenant-owned table
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN (
  'user', 'session', 'account', 'verification',
  'organization', 'member', 'invitation',
  'audit_log', 'consent_records'
)
ORDER BY relname;
-- Expected: every row has relrowsecurity=true AND relforcerowsecurity=true.

-- 3. Required extensions (FOUND-16)
\dx
-- Expected output includes:
--   pgcrypto    1.3+
--   pg_trgm     1.6+
-- If missing, run as superuser (or Coolify Postgres "Extensions" UI panel):
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Note (RESEARCH Open Question #2): on managed Postgres, CREATE EXTENSION
-- may require superuser. If migration 0000's CREATE EXTENSION IF NOT EXISTS
-- fails as the migrator role, enable via Coolify dashboard's Extensions
-- panel BEFORE the next deploy.

-- 4. Audit-log append-only GRANT layer (LGPD-04)
SELECT has_table_privilege('fb_eventos_app', 'audit_log', 'UPDATE') AS app_update,
       has_table_privilege('fb_eventos_app', 'audit_log', 'DELETE') AS app_delete,
       has_table_privilege('fb_eventos_app', 'audit_log', 'INSERT') AS app_insert,
       has_table_privilege('fb_eventos_app', 'audit_log', 'SELECT') AS app_select;
-- Expected: app_update=f, app_delete=f, app_insert=t, app_select=t.
```

If ANY of the four checks fail, abort the deploy — the multi-tenant
promise of FB_EVENTOS depends on every row above being exactly the
expected value.

## Backup Configuration

See `docs/deploy/BACKUP.md`. Coolify's Postgres backup tier is configured
through the service settings — target ≥7 days PITR retention. If Coolify
only supports snapshot-based backups (RESEARCH Open Question #3 / A6 —
LOW confidence pre-deploy), provision the `pg_dump → MinIO` supplement
documented in BACKUP.md.

## Restart Policy

```
restart: always (Coolify managed)
```

Postgres restarts are operator-coordinated only — Coolify exposes a
"Restart Service" button.

## Resource Hints (Phase 0 piloto sizing)

- CPU: 1 vCPU baseline, 4 vCPU burst (Festa de Trindade peak)
- Memory: 1 GiB baseline, 4 GiB ceiling
- Disk: 50 GiB starting (extend as Phase 1+ tenant data grows)
- `shared_buffers` = 25% of memory ceiling
- `work_mem` = 16 MiB (raise for analytics queries in Phase 4)

## See Also

- Plan 03 SUMMARY — two-role model invention + 10 RLS contract tests.
- `scripts/db/setup-roles.sh` — bootstrap script.
- `docs/deploy/BACKUP.md` — PITR + pg_dump supplement.
- `docs/RUNBOOK.md` — incident response (data corruption, rollback).
