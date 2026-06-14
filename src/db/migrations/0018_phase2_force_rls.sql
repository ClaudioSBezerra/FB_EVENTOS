-- FB_EVENTOS — Migration 0018: FORCE RLS + PII comments + GRANTs + CHECK
-- constraints on Phase 2 domain tables (Plan 02-01 Task 2).
--
-- HAND-WRITTEN (drizzle-kit does not emit FORCE, COMMENT ON COLUMN, GRANT,
-- CHECK constraints, or partial unique indexes — these are the load-bearing
-- hardening statements that close the multi-tenant + LGPD contract).
--
-- WHAT THIS MIGRATION DOES (atomic application):
--   1. ALTER TABLE ... FORCE ROW LEVEL SECURITY on all 8 new Phase 2
--      tenant-scoped tables — closes the table-owner bypass (same as
--      Phase 0's 0002, 0007 and Phase 1's 0011).
--   2. GRANT SELECT, INSERT, UPDATE, DELETE on each new table to
--      fb_eventos_app (the runtime DML role, NOBYPASSRLS).
--   3. COMMENT ON COLUMN for PII columns:
--        vendor_consents.ip_address     — consent IP (low-sensitivity)
--        refund_requests.reason         — free-text; may contain CNPJ/email
--        lot_waitlist.token_jti         — ties vendor to lot notification
--   4. CHECK constraints for FSM enums (not emitted by drizzle-kit):
--        outbox_events.event_type       — 8 allowed values
--        outbox_events.processing_status — pending|processed|failed
--        vendor_consents.consent_type   — marketing|analytics|payment_data
--        refund_requests.status         — pending|processing|completed|failed
--   5. Partial UNIQUE index on lot_reservations(lot_id) — one active
--      reservation per lot at a time (released_at IS NULL AND expires_at > now()).
--
-- Mirrors the structure of 0011_phase1_force_rls.sql exactly.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. FORCE RLS — close the table-owner bypass for every Phase 2 table
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "event_addons" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cart_addon_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lot_reservations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lot_waitlist" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_webhooks_inbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vendor_consents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "refund_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 2. GRANT SELECT/INSERT/UPDATE/DELETE to fb_eventos_app (runtime DML role).
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "event_addons" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cart_addon_lines" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lot_reservations" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lot_waitlist" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_events" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_webhooks_inbox" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vendor_consents" TO fb_eventos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "refund_requests" TO fb_eventos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 3. PII inventory via COMMENT ON COLUMN (LGPD-03).
--    Convention: every comment starts with "PII:" (matches Phase 0+1 pattern).
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN "vendor_consents"."ip_address"
  IS 'PII: low-sensitivity: client IP at consent time; LGPD-03 consent inventory';
--> statement-breakpoint
COMMENT ON COLUMN "refund_requests"."reason"
  IS 'PII: free-text refund reason — may contain CNPJ or email; LGPD-03 retention policy applies';
--> statement-breakpoint
COMMENT ON COLUMN "lot_waitlist"."token_jti"
  IS 'PII: not by itself; but ties vendor identity to lot release notification (single-use JWT)';
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 4. CHECK constraints for FSM enums (drizzle-kit does not emit these).
-- ────────────────────────────────────────────────────────────────────────────

-- outbox_events.event_type — 8 allowed values (D-16)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outbox_events_event_type_check'
       AND conrelid = 'outbox_events'::regclass
  ) THEN
    ALTER TABLE "outbox_events"
      ADD CONSTRAINT "outbox_events_event_type_check"
      CHECK (
        "event_type" IN (
          'payment.created', 'payment.paid', 'payment.failed',
          'lot.reserved', 'lot.sold', 'lot.released',
          'lot.status_changed', 'refund.created'
        )
      );
  END IF;
END
$$;
--> statement-breakpoint

-- outbox_events.processing_status — 3 allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outbox_events_processing_status_check'
       AND conrelid = 'outbox_events'::regclass
  ) THEN
    ALTER TABLE "outbox_events"
      ADD CONSTRAINT "outbox_events_processing_status_check"
      CHECK ("processing_status" IN ('pending', 'processed', 'failed'));
  END IF;
END
$$;
--> statement-breakpoint

-- vendor_consents.consent_type — 3 allowed values (D-24)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vendor_consents_consent_type_check'
       AND conrelid = 'vendor_consents'::regclass
  ) THEN
    ALTER TABLE "vendor_consents"
      ADD CONSTRAINT "vendor_consents_consent_type_check"
      CHECK ("consent_type" IN ('marketing', 'analytics', 'payment_data'));
  END IF;
END
$$;
--> statement-breakpoint

-- refund_requests.status — 4 allowed values (D-07/AM-04)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'refund_requests_status_check'
       AND conrelid = 'refund_requests'::regclass
  ) THEN
    ALTER TABLE "refund_requests"
      ADD CONSTRAINT "refund_requests_status_check"
      CHECK ("status" IN ('pending', 'processing', 'completed', 'failed'));
  END IF;
END
$$;
--> statement-breakpoint

-- payment_webhooks_inbox.processing_status — 3 allowed values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_webhooks_inbox_processing_status_check'
       AND conrelid = 'payment_webhooks_inbox'::regclass
  ) THEN
    ALTER TABLE "payment_webhooks_inbox"
      ADD CONSTRAINT "payment_webhooks_inbox_processing_status_check"
      CHECK ("processing_status" IN ('pending', 'processed', 'failed'));
  END IF;
END
$$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Partial UNIQUE index on lot_reservations(lot_id) — one ACTIVE
--    reservation per lot at a time.
--    Active = released_at IS NULL (soft-delete pattern, same as lot_assignments).
--    NOTE: The WHERE clause uses released_at IS NULL only — NOT expires_at > now()
--    because now() is VOLATILE and cannot appear in index predicates (Postgres
--    ERROR 42P17: functions in index predicate must be marked IMMUTABLE).
--    The reservation.expire task sets released_at when a reservation expires,
--    which promotes the expired row out of the "active" set — the application
--    enforces expiry at read time AND the expire task enforces it at write time.
-- ────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "lot_reservations_lot_id_active_unique"
  ON "lot_reservations" ("lot_id")
  WHERE "released_at" IS NULL;
--> statement-breakpoint
