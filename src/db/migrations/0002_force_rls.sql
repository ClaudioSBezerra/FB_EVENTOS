-- FB_EVENTOS — Migration 0002: FORCE ROW LEVEL SECURITY on every tenant-owned table.
--
-- HAND-WRITTEN (drizzle-kit does not emit FORCE RLS — the post-1.0-beta
-- API exposes `.withRLS()` which generates `ENABLE` only). FORCE is the
-- load-bearing flag: without it, RLS applies only to NON-OWNER roles, so a
-- query as the table owner (the migrator role used by drizzle-kit) would
-- silently return every row regardless of the tenant_isolation policy. FORCE
-- closes that gap by applying the policy to the owner role too.
--
-- Verified by tests/db/rls-forced.test.ts:
--   SELECT relname, relrowsecurity, relforcerowsecurity
--     FROM pg_class
--    WHERE relname IN ('session','organization','member','invitation')
-- must return rows where BOTH bools are `true`.
--
-- NOT forced:
--   tenants               — global lookup, no tenant_id column, no RLS policy
--   user / account /      — cross-tenant by design (a user has one OAuth
--   verification            account regardless of which tenant they sign into)
--   consent_records       — STUB owned by Plan 05; Plan 05 adds FORCE RLS
--                           after layering the policy + grants
--
-- If a future plan adds a new tenant-scoped table, the verifier scan in
-- Plan 07 expects that table to appear here. Forgetting to add the
-- FORCE statement is a CONTRACT VIOLATION; the rls-forced integration
-- test should be extended at the same time.

ALTER TABLE "session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
