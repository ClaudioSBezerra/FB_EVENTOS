-- 0025_user_memberships_helper_v2.sql
--
-- Recria fb_list_user_memberships incluindo member_id na linha retornada.
-- O admin user detail page (2026-06-17) precisa do member.id para
-- permitir DELETE específico (detach). Antes ele tinha que fazer um
-- SELECT extra; com isso fica em uma chamada só.
--
-- Por que DROP + CREATE em vez de CREATE OR REPLACE:
--   Postgres rejeita CREATE OR REPLACE FUNCTION quando o RETURNS TABLE
--   muda — precisamos derrubar e recriar.

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
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
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
$$;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.fb_list_user_memberships(uuid) TO fb_eventos_app;

--> statement-breakpoint

COMMENT ON FUNCTION public.fb_list_user_memberships(uuid) IS
  'Cross-tenant probe v2: returns member.id + org info for a user. SECURITY DEFINER bypass scoped to the function body. Caller supplies user_id from their own session (no leak).';
