-- 0024_admin_listing_helpers.sql
--
-- SECURITY DEFINER helpers used by the /admin console for cross-tenant
-- reads (list all orgs, list all users with their memberships). Same
-- pattern as 0011 fb_lookup_tenant_for_org and 0023
-- fb_list_user_memberships — the function body runs with row_security
-- off so the admin can see every tenant without setting GUC per call.
--
-- AUTHZ:
--   These functions DO NOT check is_super_admin. The TS callers
--   (src/lib/admin/*) MUST gate via requireSuperAdmin() before invoking.
--   This split is intentional: SQL functions handle data, app code
--   handles policy — same as the rest of the codebase.

-- ────────────────────────────────────────────────────────────────────
-- fb_admin_list_organizations
-- ────────────────────────────────────────────────────────────────────
--
-- Returns every organization with quick stats so the /admin dashboard
-- can render a paginated list without N+1 selects per row.
--
-- count_members = active member rows (no soft-delete on member yet, so
--                 raw COUNT is accurate)
-- count_events  = events without deleted_at

CREATE OR REPLACE FUNCTION public.fb_admin_list_organizations()
RETURNS TABLE (
  id              uuid,
  tenant_id       uuid,
  slug            text,
  name            text,
  created_at      timestamptz,
  count_members   bigint,
  count_events    bigint
)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  SELECT
    o.id,
    o.tenant_id,
    o.slug,
    o.name,
    o.created_at,
    (SELECT count(*) FROM "member" m WHERE m.organization_id = o.id)             AS count_members,
    (SELECT count(*) FROM events e   WHERE e.tenant_id = o.tenant_id
                                       AND e.deleted_at IS NULL)                 AS count_events
    FROM "organization" o
   ORDER BY o.created_at DESC;
$$;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.fb_admin_list_organizations() TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_admin_list_organizations() IS
  'Admin-only cross-tenant org listing with counts. Caller MUST verify is_super_admin in app code (e.g. requireSuperAdmin TS helper) — function itself has no role gate.';

-- ────────────────────────────────────────────────────────────────────
-- fb_admin_list_users
-- ────────────────────────────────────────────────────────────────────
--
-- Returns every user with their membership count + super_admin flag, so
-- the /admin/usuarios page can show a useful summary. Filters
-- deleted_at IS NULL by default (LGPD soft-delete).

CREATE OR REPLACE FUNCTION public.fb_admin_list_users()
RETURNS TABLE (
  id                uuid,
  email             text,
  name              text,
  email_verified    boolean,
  is_super_admin    boolean,
  created_at        timestamptz,
  count_memberships bigint
)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  SELECT
    u.id,
    u.email,
    u.name,
    u.email_verified,
    u.is_super_admin,
    u.created_at,
    (SELECT count(*) FROM "member" m WHERE m.user_id = u.id) AS count_memberships
    FROM "user" u
   WHERE u.deleted_at IS NULL
   ORDER BY u.created_at DESC;
$$;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.fb_admin_list_users() TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_admin_list_users() IS
  'Admin-only user listing with stats. Caller MUST verify is_super_admin in app code — function itself has no role gate.';
