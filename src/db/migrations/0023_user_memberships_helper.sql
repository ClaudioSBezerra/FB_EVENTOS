-- 0023_user_memberships_helper.sql
--
-- Cross-tenant probe used by the new login-first router (/page.tsx) and
-- the /select-org page. Returns the org rows a user belongs to without
-- requiring `app.current_tenant_id` to be set — which is precisely the
-- chicken-and-egg the post-login state machine needs to escape:
--
--   "I just logged in, I don't know which org to scope to yet — so what
--    are my options?"
--
-- Without this function the app would either need to (a) DROP the FORCE
-- RLS on `member` and `organization` for these reads (lose isolation),
-- (b) trust client-supplied tenant context (lose security), or (c) try
-- one SET LOCAL per known tenant in sequence (no list to iterate).
--
-- This is the same pattern migration 0011 used for
-- fb_lookup_tenant_for_org. SECURITY DEFINER runs as the migrator role
-- (table owner) with row_security disabled inside the function body.
-- Input is a single user_id — the caller already has that from their
-- session, so no new data is leaked.
--
-- USAGE:
--   SELECT * FROM fb_list_user_memberships('<uuid>'::uuid)
--   ORDER BY name;
--
-- ROWS RETURNED:
--   organization_id  uuid
--   tenant_id        uuid
--   slug             text
--   name             text
--   role             text   (from member.role: 'owner' | 'member' | ...)

CREATE OR REPLACE FUNCTION public.fb_list_user_memberships(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  tenant_id       uuid,
  slug            text,
  name            text,
  role            text
)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
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
$$;

--> statement-breakpoint

-- GRANT EXECUTE — the app role needs to call this; default is owner-only.
GRANT EXECUTE ON FUNCTION public.fb_list_user_memberships(uuid) TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_list_user_memberships(uuid) IS
  'Cross-tenant probe: returns org memberships for a user without requiring app.current_tenant_id to be set. SECURITY DEFINER bypass scoped to the function body. Caller supplies user_id from their own session (no leak).';
