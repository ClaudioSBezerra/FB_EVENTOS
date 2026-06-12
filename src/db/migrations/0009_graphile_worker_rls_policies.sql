-- FB_EVENTOS — Migration 0009: Graphile-Worker RLS policy hook (Plan 06 Task 3).
--
-- WHY THIS EXISTS
-- ---------------
-- Graphile-Worker enables row-level security on every table it creates
-- (_private_jobs, _private_tasks, _private_job_queues, _private_known_crontabs)
-- but ships NO policies. Its expected operational model is: connect the
-- worker as the table owner (or a BYPASSRLS role). Our two-role model
-- (fb_eventos_app NOBYPASSRLS + fb_eventos_migrator) deliberately denies
-- BYPASSRLS to every runtime path. Without a policy, the worker connects
-- as fb_eventos_app, sees 0 rows on every poll, and silently never picks
-- up enqueued jobs. (Discovered during Plan 06 Task 3 — tests/jobs/
-- worker-without-with-tenant.test.ts failed with "task did not run in
-- time" until this migration was added.)
--
-- TENANT ISOLATION CLARIFICATION
-- -------------------------------
-- This policy gives fb_eventos_app full visibility on graphile_worker.*
-- tables — the queue itself is NOT a tenant boundary. Tenant isolation on
-- JOBS lives in the PAYLOAD: every task handler that reads tenant-scoped
-- data MUST extract `tenantId` from `payload` and wrap its body in
-- `withTenant(tenantId, fn)`. Proven loud by tests/jobs/
-- worker-without-with-tenant.test.ts: a task that omits withTenant() reads
-- 0 rows from a tenant-scoped business table even though it sees its own
-- job row just fine.
--
-- IDEMPOTENCY + FORWARD-COMPAT
-- ----------------------------
-- The function below loops every current+future RLS-enabled table in the
-- graphile_worker schema and installs a single permissive policy named
-- `fb_eventos_app_full_access`. The IF NOT EXISTS check on the policy name
-- makes the function safe to re-run after a graphile-worker minor bump
-- adds a new table.
--
-- This migration also CALLS the function once. If you bump graphile-worker
-- and the runtime bootstrap creates a NEW table, scripts/jobs/start-worker.ts
-- can re-invoke this function (see runner.ts).

CREATE OR REPLACE FUNCTION fb_install_graphile_worker_policies() RETURNS void AS $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'graphile_worker'::regnamespace
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid
          AND p.polname = 'fb_eventos_app_full_access'
      )
  LOOP
    EXECUTE format(
      'CREATE POLICY fb_eventos_app_full_access ON graphile_worker.%I '
      'AS PERMISSIVE FOR ALL TO fb_eventos_app USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run once at migration time. By the time migrations run (Plan 07 deploy
-- hook), the worker has already booted at least once in CI and installed
-- the schema; in production the migration runs AFTER the worker's first
-- boot so all tables exist. If a fresh-db install runs migrations BEFORE
-- the first worker boot, this is a no-op — runner.ts re-invokes the
-- function on startup so policies attach right after the runtime bootstrap.
SELECT fb_install_graphile_worker_policies();
