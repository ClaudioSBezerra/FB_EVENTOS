-- 0025_user_memberships_helper_v2.sql
--
-- Recria fb_list_user_memberships incluindo member_id na linha retornada.
-- O admin user detail page (2026-06-17) precisa do member.id para
-- permitir DELETE específico (detach).
--
-- Por que DROP + CREATE:
--   Postgres rejeita CREATE OR REPLACE FUNCTION quando o RETURNS TABLE
--   muda — precisamos derrubar e recriar.
--
-- LANGUAGE plpgsql + ALTER OWNER sysreader pelo mesmo motivo de 0023.

DROP FUNCTION IF EXISTS public.fb_list_user_memberships(uuid);

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.fb_list_user_memberships(p_user_id uuid)
RETURNS TABLE (
  member_id       uuid,
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
      m.id    AS member_id,
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

ALTER FUNCTION public.fb_list_user_memberships(uuid) OWNER TO fb_eventos_sysreader;

--> statement-breakpoint

REVOKE ALL ON FUNCTION public.fb_list_user_memberships(uuid) FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.fb_list_user_memberships(uuid) TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_list_user_memberships(uuid) IS
  'Cross-tenant probe v2: returns member.id + org info. OWNED by fb_eventos_sysreader (BYPASSRLS). Caller supplies user_id from their own session (no leak).';
