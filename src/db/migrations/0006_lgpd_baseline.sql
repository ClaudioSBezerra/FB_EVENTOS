-- FB_EVENTOS — Migration 0006: LGPD baseline (Plan 05).
--
-- HAND-WRITTEN (drizzle-kit detects the consent_records column rename
-- consent_ip → ip_address as interactive — and the script context here
-- is non-TTY). Hand-writing also lets us thread the ALTER COLUMN DROP
-- NOT NULL on tenant_id + the new columns in a single atomic file with
-- explicit ordering.
--
-- This migration does NOT include the GRANT changes or PII COMMENT ON
-- COLUMN statements — those live in 0007_pii_comments_and_audit_grants.sql
-- so the LGPD audit trail clearly shows which migration introduced each
-- constraint (LGPD-03 = comments + LGPD-04 = REVOKE = 0007).
--
-- Order matters:
--   1. ALTER consent_records (Plan 03 stub → Plan 05 shape)
--   2. CREATE audit_log + indexes + RLS policy + .enableRLS()
--   3. Re-apply consent_records policy with the new tenant_id-nullable
--      semantics (drop old policy if exists; create the relaxed policy)

-- ────────────────────────────────────────────────────────────────────────────
-- consent_records: extend Plan 03 STUB to Plan 05 shape
-- ────────────────────────────────────────────────────────────────────────────

-- (a) Relax tenant_id to nullable (pre-signup capture flows in Phase 2+).
ALTER TABLE "consent_records" ALTER COLUMN "tenant_id" DROP NOT NULL;
--> statement-breakpoint

-- (b) Rename consent_ip → ip_address (LGPD-standard naming, aligns with
--     audit_log.ip_address). Existing Plan 04 rows (if any) carry over.
ALTER TABLE "consent_records" RENAME COLUMN "consent_ip" TO "ip_address";
--> statement-breakpoint

-- (c) Add consent_text snapshot column. Default '' so existing rows from
--     Plan 04's recordConsentMetadata (which doesn't pass consentText)
--     stay valid; Plan 05's updated code path passes the snapshot through.
ALTER TABLE "consent_records" ADD COLUMN "consent_text" text NOT NULL DEFAULT '';
--> statement-breakpoint

-- (d) Add granted_scopes jsonb for granular consent (analytics/marketing
--     opt-in flow from the LGPD-02 cookie banner).
ALTER TABLE "consent_records" ADD COLUMN "granted_scopes" jsonb;
--> statement-breakpoint

-- (e) Enable RLS on consent_records (Plan 03 STUB did not). The
--     tenant_isolation policy is created below.
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- (f) Drop the implicit "anyone can read" default policy (if any leftover)
--     and create the tenant_isolation policy. The USING clause permits
--     reads when tenant_id matches OR tenant_id IS NULL (pre-signup).
CREATE POLICY "tenant_isolation" ON "consent_records"
  AS PERMISSIVE FOR ALL TO "fb_eventos_app"
  USING ("consent_records"."tenant_id" IS NULL OR "consent_records"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("consent_records"."tenant_id" IS NULL OR "consent_records"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- audit_log: new table (LGPD-04 append-only base)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "action" text NOT NULL,
  "entity" text NOT NULL,
  "entity_id" uuid,
  "payload" jsonb,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");
--> statement-breakpoint

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "audit_log"
  AS PERMISSIVE FOR ALL TO "fb_eventos_app"
  USING ("audit_log"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("audit_log"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
