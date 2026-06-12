-- FB_EVENTOS — Migration 0007: PII inventory comments + audit_log
-- append-only GRANT enforcement (Plan 05).
--
-- HAND-WRITTEN — drizzle-kit does not emit COMMENT ON COLUMN or REVOKE
-- statements. This migration is the SOURCE OF TRUTH for LGPD-03 (PII tags
-- queryable via information_schema + pg_description) and LGPD-04
-- (append-only at the GRANT layer for audit_log).
--
-- What this migration does (atomic application):
--   1. FORCE ROW LEVEL SECURITY on audit_log + consent_records (drizzle-kit
--      generates ENABLE only; FORCE applies the policy to the table OWNER
--      role too — without it, the migrator silently sees every row).
--   2. REVOKE UPDATE, DELETE on audit_log from fb_eventos_app (append-only
--      contract at the catalog layer; INSERT remains, SELECT remains).
--   3. COMMENT ON COLUMN for every PII column in audit_log, consent_records,
--      and user. Queryable via:
--        SELECT c.table_name, c.column_name, d.description
--          FROM information_schema.columns c
--          JOIN pg_description d
--            ON d.objoid = (quote_ident(c.table_name))::regclass::oid
--           AND d.objsubid = c.ordinal_position
--         WHERE d.description LIKE 'PII:%';
--
-- The append-only contract is asserted in tests/lgpd/audit-log-append-only.test.ts
-- (UPDATE/DELETE attempts must fail with permission denied). The PII
-- inventory contract is asserted in tests/lgpd/pii-comments.test.ts.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. FORCE RLS — close the table-owner bypass on the two new LGPD tables.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "consent_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 2. GRANT layer: audit_log is INSERT-ONLY for fb_eventos_app.
--    SELECT stays (so withTenant() can read audit trail). UPDATE + DELETE
--    are revoked — the append-only contract is enforced by the catalog.
-- ────────────────────────────────────────────────────────────────────────────

REVOKE UPDATE, DELETE ON "audit_log" FROM fb_eventos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 3. PII inventory via COMMENT ON COLUMN (LGPD-03).
--    Convention: every comment starts with "PII:" so the inventory query
--    can use a LIKE 'PII:%' filter. Sensitivity hints in parens.
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN "audit_log"."user_id"
  IS 'PII: natural person identifier; retention 5 yrs post-event';
--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."ip_address"
  IS 'PII: network identifier; retained for fraud/legal evidence';
--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."user_agent"
  IS 'PII: low-sensitivity: device fingerprint';
--> statement-breakpoint
COMMENT ON COLUMN "audit_log"."payload"
  IS 'PII: variable — may contain sanitized references; NEVER raw passwords or full card data';
--> statement-breakpoint

COMMENT ON COLUMN "consent_records"."user_id"
  IS 'PII: natural person identifier';
--> statement-breakpoint
COMMENT ON COLUMN "consent_records"."ip_address"
  IS 'PII: consent evidence per LGPD Art. 8';
--> statement-breakpoint
COMMENT ON COLUMN "consent_records"."user_agent"
  IS 'PII: low-sensitivity: consent evidence';
--> statement-breakpoint

COMMENT ON COLUMN "user"."email"
  IS 'PII: primary contact identifier; consent inventory';
--> statement-breakpoint
COMMENT ON COLUMN "user"."name"
  IS 'PII: natural person name';
--> statement-breakpoint
COMMENT ON COLUMN "user"."consent_version"
  IS 'PII: low-sensitivity: LGPD-01 consent versioning';
--> statement-breakpoint
COMMENT ON COLUMN "user"."consent_at"
  IS 'PII: low-sensitivity: LGPD-01 consent timestamp (ISO 8601)';
--> statement-breakpoint
COMMENT ON COLUMN "user"."consent_ip"
  IS 'PII: LGPD-01 consent evidence IP';
