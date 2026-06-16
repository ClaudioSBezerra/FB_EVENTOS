#!/bin/bash
# FB_EVENTOS — Postgres role + database bootstrap (auto-runs on first boot).
#
# Mounted at /docker-entrypoint-initdb.d/01-roles.sh by docker-compose.yml.
# Postgres image runs every .sh file in that directory ONCE on initial
# volume initialization, as the POSTGRES_USER (superuser).
#
# ROLE MODEL (Phase 0 Plan 03 + Phase 1 Plan 01-01 + Phase 2 fix 9837fc7):
#   fb_eventos_app        — DML only, NOBYPASSRLS (runtime app role)
#     ↳ fb_app_user (LOGIN, password from FB_APP_PASSWORD env)
#   fb_eventos_migrator   — DDL (CREATEDB), used by drizzle-kit only
#     ↳ fb_migrator (LOGIN, password from FB_MIGRATOR_PASSWORD env)
#   fb_eventos_sysreader  — SECURITY DEFINER owner (NOLOGIN, BYPASSRLS)
#                           for fb_lookup_tenant_for_org() in migration 0011

set -euo pipefail

# Default passwords match the docker-compose.yml ${FB_APP_PASSWORD} fallback
# pattern. Coolify env UI should set these to the same value used in
# DATABASE_URL / DATABASE_MIGRATOR_URL (the demo uses `postgres` for all).
FB_APP_PASSWORD="${FB_APP_PASSWORD:-fb_app_dev_pw}"
FB_MIGRATOR_PASSWORD="${FB_MIGRATOR_PASSWORD:-fb_migrator_dev_pw}"

echo "[01-roles.sh] Bootstrapping roles + database..."

# Step 1: create the application database. CREATE DATABASE can't run inside
# a transaction block, so it's its own one-shot psql invocation.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  SELECT 'CREATE DATABASE fb_eventos_dev'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fb_eventos_dev')\gexec
EOSQL

# Step 2: create roles + login users inside the application database.
# Passwords interpolated by bash BEFORE the heredoc reaches psql — avoids
# psql's `\set` and `:'var'` substitution quirks that crashed the SQL-only
# version of this script.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname fb_eventos_dev <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_app') THEN
      CREATE ROLE fb_eventos_app NOLOGIN NOINHERIT NOSUPERUSER
        NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_migrator') THEN
      CREATE ROLE fb_eventos_migrator NOLOGIN NOSUPERUSER CREATEDB;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_sysreader') THEN
      CREATE ROLE fb_eventos_sysreader NOLOGIN NOINHERIT NOSUPERUSER
        NOCREATEDB NOCREATEROLE BYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_app_user') THEN
      EXECUTE format('CREATE USER fb_app_user WITH PASSWORD %L IN ROLE fb_eventos_app', '${FB_APP_PASSWORD}');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_migrator') THEN
      EXECUTE format('CREATE USER fb_migrator WITH PASSWORD %L IN ROLE fb_eventos_migrator', '${FB_MIGRATOR_PASSWORD}');
    END IF;
  END
  \$\$;

  GRANT ALL ON DATABASE fb_eventos_dev TO fb_migrator;
  GRANT USAGE, CREATE ON SCHEMA public TO fb_eventos_migrator;
  -- Migration 0011 ALTER FUNCTION ... OWNER TO fb_eventos_sysreader requires
  -- the new owner to hold CREATE on the schema (PG 15+); without this the
  -- migration fails with "permission denied for schema public".
  GRANT USAGE, CREATE ON SCHEMA public TO fb_eventos_sysreader;
  GRANT fb_eventos_sysreader TO fb_eventos_migrator;
  -- Graphile-Worker bootstrap (Phase 0 Plan 06): the runner connects as
  -- fb_app_user and lazily creates the \`graphile_worker\` schema + tables
  -- on first boot. Without CREATE on the database, the runner crashes
  -- with "permission denied for database fb_eventos_dev". Granting this
  -- is intentional — fb_eventos_app remains NOBYPASSRLS so tenant
  -- isolation on domain tables stays intact; the relaxed grant only lets
  -- the role own its own queue schema. See migration 0009 for the RLS
  -- policy that gets attached after the worker schema exists.
  GRANT CREATE ON DATABASE fb_eventos_dev TO fb_eventos_app;
EOSQL

echo "[01-roles.sh] OK — roles created, db fb_eventos_dev ready"
