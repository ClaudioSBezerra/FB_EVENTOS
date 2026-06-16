-- 0021_rls_policies_nullif_safe.sql
--
-- Defensive rewrite of every `tenant_isolation` RLS policy: replace
-- `current_setting('app.current_tenant_id', true)::uuid` with
-- `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`.
--
-- WHY:
--   `current_setting(name, true)` returns the empty string when the GUC
--   is not set. Postgres's planner can hoist a stable function call out
--   of the row scan and evaluate it once per query, even when the row's
--   leading `IS NULL` condition would have short-circuited the OR. When
--   the GUC is unset, the cast `''::uuid` raises 22P02
--   ("invalid input syntax for type uuid: ''"), aborting the whole
--   query.
--
--   This bit Better Auth in production (2026-06-16):
--     SELECT FROM session WHERE token = $1 → policy fired → cast '' →
--     22P02 → getSession() crashed → every page that calls auth.api
--     500'd → users got a redirect loop on /onboarding.
--
--   `NULLIF(current_setting(...), '')` converts '' to NULL before the
--   cast. NULL::uuid is legal. `tenant_id = NULL` evaluates to NULL
--   (UNKNOWN), which the policy treats as "exclude this row" — exactly
--   the right behavior for cross-tenant queries that lack a setting.
--
-- WHAT THIS DOES NOT CHANGE:
--   - Behavior with a valid GUC: identical (NULLIF passes the value
--     through unmodified).
--   - Behavior of policies that compare a non-uuid column: not touched.
--   - Behavior of withTenant blocks: identical, because withTenant
--     always sets a valid uuid before issuing queries.
--
-- The session policy keeps its `IS NULL OR ...` branch so Better Auth
-- can still look up tokens before any tenant context exists.

ALTER POLICY tenant_isolation ON session
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );


--> statement-breakpoint
ALTER POLICY tenant_isolation ON organization
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON "member"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON invitation
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON audit_log
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON consent_records
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON cart_addon_lines
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON contracts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON event_addons
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON lot_assignments
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON lot_categories
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON lot_reservations
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON lot_waitlist
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON lots
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON outbox_events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON pagarme_orders
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON payment_webhooks_inbox
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON payments
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON refund_requests
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON vendor_applications
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON vendor_consents
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON vendor_documents
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON vendors
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


--> statement-breakpoint
ALTER POLICY tenant_isolation ON zapsign_documents
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
