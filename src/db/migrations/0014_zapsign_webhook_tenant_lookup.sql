-- FB_EVENTOS — Migration 0014: webhook tenant lookup access on
-- zapsign_documents (Phase 1, Plan 01-05 Task 3).
--
-- THE PROBLEM
-- ─────────────────────────────────────────────────────────────────────────
-- The ZapSign webhook handler at /api/webhooks/zapsign needs to resolve
-- the owning tenant_id from `zapsign_documents.zapsign_id` BEFORE entering
-- a withTenant() context. zapsign_documents has FORCE RLS and the only
-- existing policy (`tenant_isolation`) targets `fb_eventos_app` — so the
-- migrator role (which has no BYPASSRLS, only DDL privileges) gets
-- default-deny when the webhook handler tries the lookup.
--
-- THE FIX
-- ─────────────────────────────────────────────────────────────────────────
-- Add a SELECT-only permissive policy on zapsign_documents that targets
-- `fb_eventos_migrator` and uses `USING (true)` — no tenant scope is
-- applied (the migrator is by design a cross-tenant DDL/lookup role).
-- We deliberately limit `for = select` so the migrator cannot mutate
-- zapsign_documents under this policy; mutations still require either
-- fb_eventos_app inside withTenant() or a direct DDL path.
--
-- THIS IS NARROWLY SCOPED:
--   - SELECT only (no INSERT/UPDATE/DELETE).
--   - Targets the migrator role exclusively.
--   - Applies only to zapsign_documents (no other table gains broader
--     cross-tenant access).
--
-- ALTERNATIVES CONSIDERED:
--   1. SECURITY DEFINER function owned by fb_eventos_sysreader: blocked
--      because the migrator can't ALTER FUNCTION OWNER TO sysreader
--      (sysreader lacks CREATE on schema public; granting it would
--      widen its surface beyond the bounded-lookup principle).
--   2. Move the webhook through a Server Action / sysreader-owned func:
--      Server Actions require a session; webhooks have none.
--   3. Use postgres_fdw or a separate readonly connection: heavy infra
--      for a single lookup query.
--
-- The SELECT-only policy on a single table is the minimum-blast-radius
-- choice.

CREATE POLICY "webhook_tenant_lookup_migrator_read"
  ON "zapsign_documents"
  AS PERMISSIVE
  FOR SELECT
  TO fb_eventos_migrator
  USING (true);
--> statement-breakpoint

-- Ensure the migrator role has the underlying GRANT (FORCE RLS still
-- requires the role to be authorized at the catalog layer).
GRANT SELECT ON "zapsign_documents" TO fb_eventos_migrator;
--> statement-breakpoint
