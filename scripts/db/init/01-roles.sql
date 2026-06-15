-- FB_EVENTOS — Postgres role + database bootstrap (auto-runs on first boot).
--
-- Mounted at /docker-entrypoint-initdb.d/01-roles.sql by docker-compose.yml.
-- Postgres image runs every .sql file in that directory ONCE on initial
-- volume initialization, as the POSTGRES_USER (superuser).
--
-- This mirrors scripts/db/setup-roles.sh but inline so the demo Coolify
-- deploy is single-button: bring up the stack and migrations apply
-- automatically via the web service's pre-deploy hook.
--
-- ROLE MODEL (Phase 0 Plan 03 + Phase 1 Plan 01-01 + Phase 2 fix 9837fc7):
--   fb_eventos_app        — DML only, NOBYPASSRLS (runtime app role)
--     ↳ fb_app_user (LOGIN, password from FB_APP_PASSWORD env)
--   fb_eventos_migrator   — DDL (CREATEDB), used by drizzle-kit only
--     ↳ fb_migrator (LOGIN, password from FB_MIGRATOR_PASSWORD env)
--   fb_eventos_sysreader  — SECURITY DEFINER owner (NOLOGIN, BYPASSRLS)
--                           for fb_lookup_tenant_for_org() in migration 0011

\set fb_app_password `echo "$FB_APP_PASSWORD"`
\set fb_migrator_password `echo "$FB_MIGRATOR_PASSWORD"`

-- Step 1: create the application database.
SELECT 'CREATE DATABASE fb_eventos_dev'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fb_eventos_dev')\gexec

-- Step 2: create roles + login users inside the application database.
\c fb_eventos_dev

DO $$ BEGIN
  -- Runtime role: DML only, NO BYPASSRLS. Load-bearing constraint.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_app') THEN
    CREATE ROLE fb_eventos_app NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  -- Migration role: DDL privileges.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_migrator') THEN
    CREATE ROLE fb_eventos_migrator NOLOGIN NOSUPERUSER CREATEDB;
  END IF;

  -- System reader: SECURITY DEFINER owner for fb_lookup_tenant_for_org().
  -- BYPASSRLS — required so a function owned by this role can read
  -- RLS-FORCED tables when called BEFORE a tenant context is set.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_sysreader') THEN
    CREATE ROLE fb_eventos_sysreader NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END $$;

-- Step 3: login users (password substituted from env vars at init).
DO $$
DECLARE
  app_pw   text := COALESCE(NULLIF(:'fb_app_password', ''), 'fb_app_dev_pw');
  mig_pw   text := COALESCE(NULLIF(:'fb_migrator_password', ''), 'fb_migrator_dev_pw');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_app_user') THEN
    EXECUTE format('CREATE USER fb_app_user WITH PASSWORD %L IN ROLE fb_eventos_app', app_pw);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_migrator') THEN
    EXECUTE format('CREATE USER fb_migrator WITH PASSWORD %L IN ROLE fb_eventos_migrator', mig_pw);
  END IF;
END $$;

-- Step 4: schema privileges.
GRANT ALL ON DATABASE fb_eventos_dev TO fb_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO fb_eventos_migrator;
-- 9837fc7 — fb_eventos_sysreader also needs CREATE on schema public,
-- otherwise migration 0011 `ALTER FUNCTION ... OWNER TO sysreader` fails.
GRANT USAGE, CREATE ON SCHEMA public TO fb_eventos_sysreader;

-- Step 5: migrator must be a member of sysreader so it can ALTER FUNCTION
-- ownership in migration 0011 (PG requires member-of for ALTER OWNER).
GRANT fb_eventos_sysreader TO fb_eventos_migrator;
