#!/usr/bin/env bash
# FB_EVENTOS — Bootstrap Postgres roles + login users for LOCAL DEV ONLY.
#
# Production roles are created by the Coolify post-deploy migration step
# (documented in Plan 07). This script targets the docker-compose Postgres
# (services.postgres in docker/compose.yml) using the compose superuser
# `fb_dev`. If you are running against a native Postgres on the host
# instead of the docker stack, export PG_BOOTSTRAP_URL to your superuser
# DSN before running:
#   PG_BOOTSTRAP_URL=postgresql://postgres:postgres@localhost:5432/postgres \
#     pnpm db:setup-roles
#
# This script is IDEMPOTENT — re-running on a clean DB recreates roles, and
# re-running on an already-bootstrapped DB is a no-op (DO blocks guard
# CREATE ROLE / CREATE USER / CREATE DATABASE).
#
# Two roles + two login users:
#   fb_eventos_app       — DML, NOBYPASSRLS (runtime app role)
#     ↳ fb_app_user / password=fb_app_dev_pw (DATABASE_URL)
#   fb_eventos_migrator  — DDL (CREATEDB), used by drizzle-kit only
#     ↳ fb_migrator / password=fb_migrator_dev_pw (DATABASE_MIGRATOR_URL)
#
# Critical contract: fb_eventos_app must NEVER gain BYPASSRLS. The CREATE
# ROLE statement below sets NOBYPASSRLS explicitly. tests/db/role-no-bypassrls.test.ts
# asserts this on every CI run.

set -euo pipefail

# Default to the compose superuser; override for native dev.
: "${PG_BOOTSTRAP_URL:=postgresql://fb_dev:fb_dev@localhost:5432/fb_eventos_dev}"

echo "[setup-roles] bootstrapping via: ${PG_BOOTSTRAP_URL%%:*}://…@${PG_BOOTSTRAP_URL##*@}"

# Step 1: create the dev database if missing (CREATE DATABASE cannot run
# inside a transaction block, so it's its own connection).
psql "$PG_BOOTSTRAP_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = 'fb_eventos_dev'" \
  | grep -q 1 || psql "$PG_BOOTSTRAP_URL" -c "CREATE DATABASE fb_eventos_dev"

# Step 2: create roles + users idempotently against the dev database.
psql "${PG_BOOTSTRAP_URL%/*}/fb_eventos_dev" <<'SQL'
DO $$ BEGIN
  -- Runtime role: DML only, NO BYPASSRLS. This is the load-bearing constraint.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_app') THEN
    CREATE ROLE fb_eventos_app NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  -- Migration role: DDL privileges, used only by drizzle-kit.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_migrator') THEN
    CREATE ROLE fb_eventos_migrator NOLOGIN NOSUPERUSER CREATEDB;
  END IF;

  -- Phase 1, Plan 01-01: system-reader role for SECURITY DEFINER lookup
  -- functions (e.g. fb_lookup_tenant_for_org used by Better Auth's
  -- session.update.before hook). NOLOGIN — no human/app authenticates
  -- as it. BYPASSRLS — required so SECURITY DEFINER functions OWNED by
  -- this role can read RLS-FORCED tables when no tenant context is set.
  -- The runtime fb_eventos_app role keeps its NOBYPASSRLS attribute;
  -- only EXECUTE on specific, narrowly-scoped functions is granted to
  -- the app. See src/db/migrations/0011_phase1_force_rls.sql.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_sysreader') THEN
    CREATE ROLE fb_eventos_sysreader NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;

  -- App login user (group member of fb_eventos_app).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_app_user') THEN
    CREATE USER fb_app_user WITH PASSWORD 'fb_app_dev_pw' IN ROLE fb_eventos_app;
  END IF;

  -- Migrator login user (group member of fb_eventos_migrator).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_migrator') THEN
    CREATE USER fb_migrator WITH PASSWORD 'fb_migrator_dev_pw' IN ROLE fb_eventos_migrator;
  END IF;
END $$;

-- Grant database-level privileges to the migrator so drizzle-kit can
-- run CREATE EXTENSION + CREATE TABLE + ALTER TABLE.
GRANT ALL ON DATABASE fb_eventos_dev TO fb_migrator;

-- Allow the migrator role to use the public schema (Postgres 15+ requires
-- explicit USAGE+CREATE on public schema for non-owner roles).
GRANT USAGE, CREATE ON SCHEMA public TO fb_eventos_migrator;

-- Make fb_eventos_migrator a member of fb_eventos_sysreader so it can
-- ALTER FUNCTION ... OWNER TO fb_eventos_sysreader in migration 0011
-- (PostgreSQL requires the role doing the ALTER to be a member of the
-- target ownership role). This is the ONLY membership grant — the app
-- role NEVER becomes a member of sysreader.
GRANT fb_eventos_sysreader TO fb_eventos_migrator;
SQL

echo "[setup-roles] OK — fb_eventos_app + fb_eventos_migrator + login users ready"
