-- FB_EVENTOS — Migration 0000: Postgres roles + extensions.
--
-- This migration is HAND-WRITTEN (drizzle-kit does not generate role/extension
-- DDL). It is the first migration applied and creates the two-role security
-- model that every subsequent migration + the runtime app depend on.
--
-- Roles created:
--   fb_eventos_app        — DML only, NOBYPASSRLS (the runtime app role).
--                           Group role with no LOGIN. App login users
--                           (fb_app_user in dev, prod-specific name in
--                           Coolify) are members of this role.
--   fb_eventos_migrator   — DDL (CREATEDB), used by drizzle-kit / migrate.
--                           Group role with no LOGIN. Migrator login users
--                           (fb_migrator in dev) are members.
--
-- Extensions installed:
--   pgcrypto    — required by Plan 05's LGPD anonymize_user job (PII hashing).
--   pg_trgm     — required by Phase 1's marketplace search (ILIKE acceleration).
--
-- CONTRACTUAL: fb_eventos_app MUST have NOBYPASSRLS. The integration test
-- tests/db/role-no-bypassrls.test.ts asserts pg_roles.rolbypassrls = false
-- on every CI run. Removing NOBYPASSRLS from the CREATE ROLE statement below
-- breaks the multi-tenant safety promise of FB_EVENTOS (T-0-01).

DO $$ BEGIN
  -- Runtime role: DML only. NOBYPASSRLS is the load-bearing flag.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_app') THEN
    CREATE ROLE fb_eventos_app NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  -- Migration role: DDL privileges, drizzle-kit only.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_migrator') THEN
    CREATE ROLE fb_eventos_migrator NOLOGIN NOSUPERUSER CREATEDB;
  END IF;
END $$;

-- Schema-level grants for fb_eventos_app: USAGE on public + DML on every
-- current table + DML on every FUTURE table (ALTER DEFAULT PRIVILEGES).
-- Without ALTER DEFAULT PRIVILEGES the app role would lose access to
-- new tables created by future drizzle-kit migrations until a manual GRANT.
GRANT USAGE ON SCHEMA public TO fb_eventos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fb_eventos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fb_eventos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fb_eventos_app;

-- Extensions: pgcrypto for LGPD PII hashing (Plan 05), pg_trgm for
-- marketplace search (Phase 1).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
