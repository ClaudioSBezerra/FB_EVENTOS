-- FB_EVENTOS — Migration 0020: tenants Phase 2 columns (Plan 02-01 Task 2).
--
-- Adds two configuration columns to the tenants GLOBAL LOOKUP table:
--   vendor_auto_approve  — when true, vendor signups skip manual review (D-23)
--   refund_policy_json   — tenant-specific refund tier override (D-07)
--
-- Mirrors 0016_tenant_platform_commission.sql exactly (ALTER TABLE ADD COLUMN
-- IF NOT EXISTS + COMMENT ON COLUMN).
--
-- NOT PII — both columns are operational config, not user identifiers.
-- NO RLS — tenants table has no RLS (global lookup table; see tenants.ts
-- header comment for why).

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "vendor_auto_approve" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

COMMENT ON COLUMN "tenants"."vendor_auto_approve" IS
  'When true, vendor signups are auto-approved without manual organizadora review (D-23 escape hatch). Default false.';
--> statement-breakpoint

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "refund_policy_json" jsonb;
--> statement-breakpoint

COMMENT ON COLUMN "tenants"."refund_policy_json" IS
  'Tenant-specific refund tier policy override. Null = use DEFAULT_POLICY from src/lib/refund/policy.ts. Structure: {tiers:[{daysBeforeEvent:N,pct:N}]} (D-07).';
--> statement-breakpoint
