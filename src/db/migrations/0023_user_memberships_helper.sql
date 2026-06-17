-- 0023_user_memberships_helper.sql
--
-- Cross-tenant probe used by the new login-first router (/page.tsx) and
-- the /select-org page. Returns the org rows a user belongs to without
-- requiring `app.current_tenant_id` to be set.
--
-- LANGUAGE plpgsql (NOT sql) — load-bearing choice. Postgres parses
-- LANGUAGE sql function bodies eagerly at CREATE time and runs RLS
-- evaluation as the *current* role (the migrator) which lacks BYPASSRLS.
-- That hits 42501 on member/organization during the CREATE itself,
-- before ALTER FUNCTION OWNER gets a chance to retag the function to
-- the BYPASSRLS sysreader. plpgsql is lazily parsed → CREATE succeeds,
-- ALTER OWNER moves the function to sysreader, and the function body
-- only executes (and RLS evaluates against the new owner) on the first
-- runtime call. Same pattern as 0011 fb_lookup_tenant_for_org.

-- Sanity: sysreader must already exist (setup-roles.sh).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_sysreader') THEN
    RAISE EXCEPTION 'fb_eventos_sysreader role missing — run scripts/db/setup-roles.sh first';
  END IF;
END $$;

--> statement-breakpoint

-- Catalog grants for sysreader on the tables this function scans.
-- organization is already granted by 0011; member is new here.
GRANT SELECT ON "member" TO fb_eventos_sysreader;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.fb_list_user_memberships(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  tenant_id       uuid,
  slug            text,
  name            text,
  role            text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT
      o.id    AS organization_id,
      o.tenant_id,
      o.slug,
      o.name,
      m.role
      FROM "member" m
      JOIN "organization" o ON o.id = m.organization_id
     WHERE m.user_id = p_user_id
     ORDER BY o.name ASC;
END;
$$;

--> statement-breakpoint

-- Re-own to the BYPASSRLS role so FORCE RLS on member + organization is
-- transparently bypassed inside the function body at runtime.
ALTER FUNCTION public.fb_list_user_memberships(uuid) OWNER TO fb_eventos_sysreader;

--> statement-breakpoint

REVOKE ALL ON FUNCTION public.fb_list_user_memberships(uuid) FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.fb_list_user_memberships(uuid) TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_list_user_memberships(uuid) IS
  'Cross-tenant probe: returns org memberships for a user. OWNED by fb_eventos_sysreader (BYPASSRLS). Caller supplies user_id from their own session (no leak).';
