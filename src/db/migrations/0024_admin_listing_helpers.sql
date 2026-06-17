-- 0024_admin_listing_helpers.sql
--
-- SECURITY DEFINER helpers used by the /admin console for cross-tenant
-- reads (list all orgs, list all users with their memberships).
--
-- Same load-bearing choices as 0023:
--   - LANGUAGE plpgsql (NOT sql) so the body is lazy-parsed and the
--     RLS evaluation during CREATE doesn't fire as the migrator role.
--   - OWNED by fb_eventos_sysreader (BYPASSRLS) so FORCE RLS on
--     member/events/organization is bypassed inside the function body.
--   - GRANT EXECUTE only — TS callers gate via requireSuperAdmin().

-- Sanity: sysreader must already exist (setup-roles.sh).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_sysreader') THEN
    RAISE EXCEPTION 'fb_eventos_sysreader role missing — run scripts/db/setup-roles.sh first';
  END IF;
END $$;

--> statement-breakpoint

-- Catalog grants. organization + member from earlier migrations; user +
-- events new here.
GRANT SELECT ON "user" TO fb_eventos_sysreader;

--> statement-breakpoint

GRANT SELECT ON "events" TO fb_eventos_sysreader;

--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────
-- fb_admin_list_organizations
-- ────────────────────────────────────────────────────────────────────

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
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
END;
$$;

--> statement-breakpoint

ALTER FUNCTION public.fb_admin_list_organizations() OWNER TO fb_eventos_sysreader;

--> statement-breakpoint

REVOKE ALL ON FUNCTION public.fb_admin_list_organizations() FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.fb_admin_list_organizations() TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_admin_list_organizations() IS
  'Admin-only cross-tenant org listing with counts. OWNED by fb_eventos_sysreader (BYPASSRLS). Caller MUST verify is_super_admin in app code.';

--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────
-- fb_admin_list_users
-- ────────────────────────────────────────────────────────────────────

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
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
END;
$$;

--> statement-breakpoint

ALTER FUNCTION public.fb_admin_list_users() OWNER TO fb_eventos_sysreader;

--> statement-breakpoint

REVOKE ALL ON FUNCTION public.fb_admin_list_users() FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.fb_admin_list_users() TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_admin_list_users() IS
  'Admin-only user listing with stats. OWNED by fb_eventos_sysreader (BYPASSRLS). Caller MUST verify is_super_admin in app code.';
