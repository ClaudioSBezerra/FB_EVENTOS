-- FB_EVENTOS — Migration 0015: webhook tenant lookup access on
-- payments (Phase 1, Plan 01-06 Task 2).
--
-- THE PROBLEM
-- ─────────────────────────────────────────────────────────────────────────
-- The Pagar.me webhook handler at /api/webhooks/pagarme needs to resolve
-- the owning tenant_id from `payments.gateway_order_id` BEFORE entering a
-- withTenant() context. payments has FORCE RLS and the only existing
-- policy (`tenant_isolation`) targets `fb_eventos_app` — so the migrator
-- role (no BYPASSRLS, only DDL privileges) gets default-deny when the
-- webhook handler tries the lookup.
--
-- THE FIX (mirrors Migration 0014 for zapsign_documents)
-- ─────────────────────────────────────────────────────────────────────────
-- Add a SELECT-only permissive policy on payments that targets
-- `fb_eventos_migrator` and uses `USING (true)` — no tenant scope is
-- applied (the migrator is by design a cross-tenant DDL/lookup role).
-- We deliberately limit `for = select` so the migrator cannot mutate
-- payments under this policy; mutations still require either
-- fb_eventos_app inside withTenant() or a direct DDL path.
--
-- THIS IS NARROWLY SCOPED:
--   - SELECT only (no INSERT/UPDATE/DELETE).
--   - Targets the migrator role exclusively.
--   - Applies only to payments (no other table gains broader access).
--
-- ALTERNATIVES CONSIDERED:
--   1. SECURITY DEFINER function owned by fb_eventos_sysreader: blocked
--      by PG 18 ALTER FUNCTION OWNER schema-CREATE check on `public`
--      (sysreader lacks CREATE on public; granting widens its surface).
--   2. Move webhook through a Server Action: Server Actions require a
--      session; webhooks have none.
--
-- The SELECT-only policy on a single table is the minimum-blast-radius
-- choice. (Same rationale as Migration 0014.)

CREATE POLICY "webhook_tenant_lookup_migrator_read"
  ON "payments"
  AS PERMISSIVE
  FOR SELECT
  TO fb_eventos_migrator
  USING (true);
--> statement-breakpoint

-- Ensure the migrator role has the underlying GRANT (FORCE RLS still
-- requires the role to be authorized at the catalog layer).
GRANT SELECT ON "payments" TO fb_eventos_migrator;
--> statement-breakpoint
