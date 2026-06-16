-- FB_EVENTOS — Cleanup of orphan tenants/orgs/members from failed onboarding.
--
-- Context (2026-06-16 incident): bootstrapOrganization committed a
-- tenants+organization+member triple inside its transaction, then attempted a
-- SEPARATE UPDATE of session.active_organization_id OUTSIDE that transaction.
-- The UPDATE hit RLS policy `current_setting('app.current_tenant_id', true)::uuid`
-- with empty GUC → 22P02 cast error → action returned create_failed, but the
-- already-committed triple stayed in the DB. Next submit failed with slug_taken.
--
-- Migration 0021 (NULLIF guard) + commit e8f8548 (UPDATE moved into the tx)
-- close the bug going forward. This script cleans the leftover rows so the
-- affected user can retry onboarding from a clean slate.
--
-- USAGE (from within the Postgres container, as the migrator role):
--   psql -v target_email='claudiosousadebezerra@gmail.com' -f cleanup-orphan-tenants.sql
--
-- Wrapped in a transaction with a SELECT before and after so you can see what
-- gets deleted. If anything looks wrong, ROLLBACK; instead of COMMIT.

\set ON_ERROR_STOP on

BEGIN;

\echo ''
\echo '=== BEFORE: user + member + organization + tenant for target email ==='
SELECT u.id AS user_id, u.email,
       m.id AS member_id, m.role,
       o.id AS org_id, o.slug AS org_slug, o.name AS org_name,
       t.id AS tenant_id, t.slug AS tenant_slug
  FROM "user" u
  LEFT JOIN "member" m       ON m.user_id = u.id
  LEFT JOIN "organization" o ON o.id = m.organization_id
  LEFT JOIN tenants t        ON t.id = o.tenant_id
 WHERE u.email = :'target_email';

\echo ''
\echo '=== BEFORE: orphan organizations (no session points at them) ==='
SELECT o.id, o.slug, o.tenant_id
  FROM "organization" o
 WHERE o.id NOT IN (
   SELECT active_organization_id FROM "session" WHERE active_organization_id IS NOT NULL
 );

-- 1. Wipe the user's membership rows.
DELETE FROM "member"
 WHERE user_id = (SELECT id FROM "user" WHERE email = :'target_email');

-- 2. Wipe organizations that no session points at AND no member row references.
--    After step 1 above, the user's orphan orgs become eligible.
DELETE FROM "organization"
 WHERE id NOT IN (
   SELECT active_organization_id FROM "session" WHERE active_organization_id IS NOT NULL
 )
   AND id NOT IN (
   SELECT organization_id FROM "member"
 );

-- 3. Wipe tenants no organization references anymore.
DELETE FROM tenants
 WHERE id NOT IN (SELECT tenant_id FROM "organization");

-- 4. Kill the user's sessions so the next login forces a fresh onboarding.
DELETE FROM "session"
 WHERE user_id = (SELECT id FROM "user" WHERE email = :'target_email');

\echo ''
\echo '=== AFTER ==='
SELECT u.id AS user_id, u.email,
       m.id AS member_id,
       o.id AS org_id, o.slug AS org_slug
  FROM "user" u
  LEFT JOIN "member" m       ON m.user_id = u.id
  LEFT JOIN "organization" o ON o.id = m.organization_id
 WHERE u.email = :'target_email';

\echo ''
\echo 'Review the output above. If it looks right, type COMMIT; otherwise ROLLBACK;'

-- Intentionally DO NOT commit here — the operator inspects the output and
-- decides. Replace this comment with `COMMIT;` only if you want hands-off mode.
