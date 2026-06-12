-- FB_EVENTOS — Migration 0008: Graphile-Worker schema bootstrap (Plan 06 Task 2).
--
-- HAND-WRITTEN. This migration:
--   (a) Reserves the `graphile_worker` schema so it appears in deploy
--       inventory and pre-grants USAGE to fb_eventos_app so the runtime
--       worker process can read/write jobs without DDL privileges.
--   (b) Ensures fb_eventos_app can INSERT/UPDATE/DELETE/SELECT on every
--       table created later by Graphile-Worker's `run()` bootstrap (the
--       bundled SQL migrations at node_modules/graphile-worker/sql/
--       000001..000018.sql, applied when `startWorker()` first connects).
--
-- WHY THE SCHEMA IS NOT FULLY HAND-CREATED HERE
-- ---------------------------------------------
-- Graphile-Worker ships its own breakpointed SQL migration chain in
-- node_modules/graphile-worker/sql/. Re-typing those here would freeze a
-- version of the schema that drifts every minor release. Instead we let
-- the runtime install — and Plan 06 Task 2's probe test
-- (`tests/jobs/add-job-signature-probe.test.ts`) asserts that the resulting
-- `graphile_worker.add_job` signature still matches our enqueueJob() call
-- shape. If a future graphile-worker version drifts, the probe fails loudly.
--
-- VERIFIED add_job() SIGNATURES (captured by probe test, graphile-worker 0.16.6)
-- ----------------------------------------------------------------------------
--   add_job(
--     identifier text,
--     payload json DEFAULT NULL,
--     queue_name text DEFAULT NULL,
--     run_at timestamptz DEFAULT NULL,
--     max_attempts integer DEFAULT NULL,
--     job_key text DEFAULT NULL,
--     priority integer DEFAULT NULL,
--     flags text[] DEFAULT NULL,
--     job_key_mode text DEFAULT 'replace'
--   ) RETURNS graphile_worker._private_jobs
--
-- src/jobs/enqueue.ts uses the named-arg form:
--   SELECT graphile_worker.add_job(
--     identifier => $1, payload => $2::json,
--     run_at => $3, job_key => $4, max_attempts => $5
--   )
--
-- If the probe fails on a future bump, update both the signature comment
-- above AND src/jobs/enqueue.ts to match.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Pre-create the schema so it exists even before the first worker boot.
--    Graphile-Worker's own bootstrap also calls CREATE SCHEMA IF NOT EXISTS,
--    so this is a no-op safety net (and a deploy-inventory hook).
-- ────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS graphile_worker;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Grant USAGE so the app role can resolve the schema namespace at all.
--    Without USAGE on the schema, even SELECT on `graphile_worker.jobs` fails
--    with "permission denied for schema graphile_worker" REGARDLESS of any
--    table-level GRANT we apply below.
-- ────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA graphile_worker TO fb_eventos_app;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Default privileges: every table / sequence / function created LATER
--    inside `graphile_worker` (by the runtime bootstrap) automatically gets
--    SELECT/INSERT/UPDATE/DELETE granted to fb_eventos_app. This makes the
--    runtime app pool (which the worker process and enqueueJob() both use)
--    able to call add_job and let the worker harness consume rows.
--
--    DEFAULT PRIVILEGES applies only to objects owned by the CURRENT role
--    when this migration runs (fb_eventos_migrator). Graphile-Worker's
--    bootstrap connects as fb_eventos_migrator too (see DATABASE_MIGRATOR_URL
--    in scripts/jobs/start-worker.ts) so the FOR ROLE clause is implicit.
-- ────────────────────────────────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA graphile_worker
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fb_eventos_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA graphile_worker
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO fb_eventos_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA graphile_worker
  GRANT EXECUTE ON FUNCTIONS TO fb_eventos_app;
