-- FB_EVENTOS — Migration 0011: FORCE RLS + PII comments + GRANTs + uniques
-- on Phase 1 domain tables (Plan 01-01 Task 3).
--
-- HAND-WRITTEN (drizzle-kit does not emit FORCE, COMMENT ON COLUMN, GRANT,
-- or partial unique constraints — these are the load-bearing hardening
-- statements that close the multi-tenant + LGPD contract).
--
-- WHAT THIS MIGRATION DOES (atomic application):
--   1. ALTER TABLE ... FORCE ROW LEVEL SECURITY on every tenant-scoped
--      Phase 1 table — applies the tenant_isolation policy to the table
--      OWNER too (closes the migrator-bypass gap, same as Phase 0's 0002
--      and 0007).
--   2. GRANT SELECT, INSERT, UPDATE, DELETE on each new table to
--      fb_eventos_app (the runtime DML role, NOBYPASSRLS — see Plan 03).
--   3. COMMENT ON COLUMN for every PII column in vendors + events
--      (LGPD-03 inventory; queryable via the same information_schema +
--      pg_description query as Phase 0's PII baseline).
--   4. UNIQUE constraint on lot_assignments(lot_id) — enforces "one
--      active assignment per lot" at the catalog layer (Phase 2 will
--      relax this when lot reservations with TTL land; today it's an
--      invariant).
--
-- The Phase 0 contract tests (rls-forced, role-no-bypassrls, with-tenant)
-- will pick up these tables automatically once they run pg_class assertions
-- against the new table names. Phase 1 tests for the new tables
-- (tests/eventos/, tests/lotes/, etc.) inherit the full RLS contract.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. FORCE RLS — close the table-owner bypass for every Phase 1 table
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lot_categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vendors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vendor_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vendor_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lot_assignments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contracts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "zapsign_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pagarme_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- contract_template_versions is intentionally NOT forced — it has no
-- tenant_id and no RLS policy (global lookup table).

-- ────────────────────────────────────────────────────────────────────────────
-- 2. GRANT SELECT/INSERT/UPDATE/DELETE to fb_eventos_app (runtime DML role).
--    The migrator role owns the tables (it created them); the app role
--    needs explicit DML grants since by default Postgres only grants to the
--    table owner.
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "events" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lot_categories" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lots" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vendors" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vendor_documents" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vendor_applications" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lot_assignments" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "contracts" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "zapsign_documents" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payments" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "pagarme_orders" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT ON "contract_template_versions" TO fb_eventos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 3. PII inventory via COMMENT ON COLUMN (LGPD-03).
--    Convention (matches Phase 0 migration 0007): every comment starts with
--    "PII:" so the inventory query uses LIKE 'PII:%' to enumerate.
--
--    Coverage:
--      vendors: legal_name, cnpj, email, phone   (4)
--      events:  place_address                    (1)
--      vendor_documents: minio_key               (1 — object key may
--                                                  embed identifying info)
--      lot_assignments: assigned_by              (1 — who assigned)
--      contracts: zapsign_doc_id                 (1 — external identifier
--                                                  linking back to a person)
--    Total Phase 1 PII columns: 8 (plus the 12 from Phase 0 = 20 total)
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN "vendors"."legal_name"
  IS 'PII: vendor legal name (razão social); LGPD-03 inventory';
--> statement-breakpoint
COMMENT ON COLUMN "vendors"."cnpj"
  IS 'PII: tax identifier (CNPJ); LGPD-03 inventory, retention per vendor doc lifecycle';
--> statement-breakpoint
COMMENT ON COLUMN "vendors"."email"
  IS 'PII: vendor contact email; consent inventory';
--> statement-breakpoint
COMMENT ON COLUMN "vendors"."phone"
  IS 'PII: vendor contact phone; consent inventory';
--> statement-breakpoint
COMMENT ON COLUMN "events"."place_address"
  IS 'PII: low-sensitivity: venue street address may identify organization';
--> statement-breakpoint
COMMENT ON COLUMN "vendor_documents"."minio_key"
  IS 'PII: low-sensitivity: object path may embed vendor identifiers';
--> statement-breakpoint
COMMENT ON COLUMN "lot_assignments"."assigned_by"
  IS 'PII: low-sensitivity: user identifier — who assigned the lot';
--> statement-breakpoint
COMMENT ON COLUMN "contracts"."zapsign_doc_id"
  IS 'PII: low-sensitivity: external ZapSign document identifier linking to signers';
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 4. UNIQUE constraint on lot_assignments(lot_id) — one ACTIVE assignment
--    per lot. Partial unique on deleted_at IS NULL so a soft-deleted
--    assignment can coexist with a new active assignment for the same lot
--    (lot re-sold to a different vendor after the first vendor cancels).
-- ────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "lot_assignments_lot_id_active_unique"
  ON "lot_assignments" ("lot_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Geometry shape CHECK constraint on lots (D-10 invariant).
--    Today the only supported geometry is {"version":1,"type":"polygon2d"}.
--    Future 3D upgrade (v2/v3) will relax this CHECK to accept v2 too.
--    DO block keeps the statement idempotent across re-runs.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'lots_geometry_v1_polygon2d_check'
       AND conrelid = 'lots'::regclass
  ) THEN
    ALTER TABLE "lots"
      ADD CONSTRAINT "lots_geometry_v1_polygon2d_check"
      CHECK (
        ("geometry"->>'version')::int = 1
        AND "geometry"->>'type' = 'polygon2d'
      );
  END IF;
END
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 6. SECURITY DEFINER helper for setActiveOrganization → tenant_id lookup
--    (Phase 1, Plan 01-01 Task 3).
--
--    Better Auth's `databaseHooks.session.update.before` runs in a path
--    where the runtime tenant context is by definition UNKNOWN (user just
--    picked the active org — we are RESOLVING tenant_id, we don't have it
--    yet). The organization table is RLS-protected (FORCE), so a normal
--    SELECT under fb_eventos_app returns 0 rows because the policy
--    predicate evaluates against an empty current_setting.
--
--    SECURITY ARCHITECTURE — fb_eventos_sysreader role:
--      A NEW group role `fb_eventos_sysreader` is created with the
--      BYPASSRLS attribute. It is NOT a LOGIN role — no human, app, or
--      worker can authenticate as it. Its ONLY purpose is to OWN the
--      `fb_lookup_tenant_for_org` SECURITY DEFINER function. Because the
--      function runs with the owner's privileges, the BYPASSRLS attribute
--      kicks in for the duration of the function body — but the function
--      body is bounded to a single SELECT … FROM organization WHERE id = $1
--      LIMIT 1 (no filters injected by the caller other than the PK).
--
--      Threat surface: the function leaks tenant_id for an org_id the
--      caller already knows (it came from the user's session-update
--      payload). It cannot enumerate orgs, cannot pull other columns,
--      and cannot be redefined by anyone other than the owner.
--
--      The `fb_eventos_app` runtime role receives EXECUTE on this single
--      function. Its own role attributes (NOBYPASSRLS) are UNCHANGED —
--      the rls-forced / role-no-bypassrls invariants from Phase 0 keep
--      passing. The bypass is bounded to this one function call.
--
--    Used by src/lib/auth/set-active-org.ts:lookupTenantIdForOrganization.
-- ────────────────────────────────────────────────────────────────────────────

-- Role bootstrap: the canonical creation path is scripts/db/setup-roles.sh
-- (runs once per database). This migration ASSERTS the role exists. If
-- you're running migrations on a fresh DB without first running
-- setup-roles.sh, this statement raises a clear error:
--   ERROR: fb_eventos_sysreader role missing — run pnpm db:setup-roles first.
-- That's the same operator contract as fb_eventos_app + fb_eventos_migrator
-- from Phase 0 (see scripts/db/setup-roles.sh comment block).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fb_eventos_sysreader') THEN
    RAISE EXCEPTION 'fb_eventos_sysreader role missing — run pnpm db:setup-roles first (see Plan 01-01 Task 3)';
  END IF;
END $$;
--> statement-breakpoint

-- Grant fb_eventos_sysreader SELECT on the organization table so the
-- SECURITY DEFINER function body can read it.
GRANT SELECT ON "organization" TO fb_eventos_sysreader;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.fb_lookup_tenant_for_org(p_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Bounded surface: single row by primary key. The caller already has
  -- the org_id; this function only returns the tenant_id for that org.
  SELECT tenant_id INTO v_tenant_id
    FROM organization
   WHERE id = p_org_id
   LIMIT 1;
  RETURN v_tenant_id;
END;
$$;
--> statement-breakpoint

-- Re-own the function to fb_eventos_sysreader (the BYPASSRLS role). The
-- migration role created it, but SECURITY DEFINER means the function runs
-- as the OWNER — and we need the owner to have BYPASSRLS.
ALTER FUNCTION public.fb_lookup_tenant_for_org(uuid) OWNER TO fb_eventos_sysreader;
--> statement-breakpoint

-- The fb_eventos_app runtime role receives EXECUTE only.
REVOKE ALL ON FUNCTION public.fb_lookup_tenant_for_org(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fb_lookup_tenant_for_org(uuid) TO fb_eventos_app;
