-- FB_EVENTOS — Migration 0016: tenant platform commission rate
-- (Phase 1, Plan 01-07 Task 1).
--
-- The financial dashboard (Plan 01-07) needs to compute the platform
-- commission on paid charges:
--
--   comissao = SUM(payments.amount_brl_cents WHERE status='paid') / 100
--              × tenants.platform_commission_pct
--
-- Default 5% (0.0500). Range 0..1 — modeled as numeric(5,4) so values like
-- 0.0825 (8.25%) fit without rounding. Existing tenants get the default
-- applied via the NOT NULL DEFAULT clause.
--
-- NOTE on numbering (#dev-note for future contributors):
--   01-PLAN.md originally targeted "0013" for this migration, but 0013
--   was already claimed by 0013_contract_templates_seed.sql (Plan 01-05).
--   Plans 01-05 and 01-06 each consumed one migration slot (0013, 0014,
--   0015). 0016 is the next free index after 0015_pagarme_webhook_tenant_lookup.
--
-- NOT PII — this is operational config, not a user identifier; no
-- COMMENT ON COLUMN 'PII:' annotation needed.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "platform_commission_pct" numeric(5,4) NOT NULL DEFAULT 0.0500;
--> statement-breakpoint

COMMENT ON COLUMN "tenants"."platform_commission_pct" IS
  'Platform commission rate (0..1) applied to paid charges; default 5%';
--> statement-breakpoint
