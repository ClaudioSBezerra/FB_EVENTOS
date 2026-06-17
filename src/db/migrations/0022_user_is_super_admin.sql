-- 0022_user_is_super_admin.sql
--
-- Adds the global-scope role flag `user.is_super_admin` that gates the
-- /admin/* surface (CRUD of organizadoras, usuarios). Super admins are
-- NOT members of a specific tenant by virtue of this flag — they can
-- still be added to `member` for normal org-scoped work. The flag is
-- intentionally a single boolean (not a role enum) because the only
-- system-wide role we model today is super_admin; if/when more global
-- roles emerge (read-only auditor, billing admin, etc.) this evolves
-- to `user_system_roles` join table.
--
-- WHY ON `user` (NOT a separate table):
--   - Single column lookup keeps the requireSuperAdmin guard a one-liner.
--   - The flag travels with the user row through Better Auth's session
--     fetch (`additionalFields` exposes it without an extra query).
--   - Soft-delete via user.deleted_at already covers off-boarding.
--
-- SECURITY:
--   - The column has NO RLS — `user` is a global table (cross-tenant by
--     design, see Plan 03 comment block).
--   - DDL is reviewable here; the seed (next migration step) is the only
--     INSERT/UPDATE that flips the bit. Future flips happen via the
--     /admin/usuarios surface (audit-logged Server Action).
--
-- SEED:
--   Marks claudiosousadebezerra@gmail.com as the bootstrap super admin so
--   the /admin surface is reachable on first deploy. Idempotent — uses
--   WHERE clause guard, runs cleanly if the row already exists with the
--   flag set, or skips silently if the email is missing (e.g. fresh DB
--   spun up via tests that have not seeded that user yet).

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "user".is_super_admin IS
  'Global system role flag. true → user can access /admin/* (CRUD of tenants + users). NO RLS — user table is global by design.';

--> statement-breakpoint

UPDATE "user"
   SET is_super_admin = true
 WHERE email = 'claudiosousadebezerra@gmail.com'
   AND is_super_admin = false;
