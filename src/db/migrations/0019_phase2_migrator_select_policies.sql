-- FB_EVENTOS — Migration 0019: SELECT-only policies for fb_eventos_migrator
-- on Phase 2 cross-tenant-scan tables (Plan 02-01 Task 2).
--
-- THE PROBLEM (mirrors the analysis in 0014_zapsign_webhook_tenant_lookup.sql)
-- ─────────────────────────────────────────────────────────────────────────
-- Three Phase 2 Graphile-Worker tasks scan across ALL tenants without a
-- withTenant() context:
--   - payment.process-webhook : reads payment_webhooks_inbox by gateway_event_id
--   - outbox.drain            : reads + updates outbox_events (pending → processed)
--   - reservation.expire      : reads + updates lot_reservations (released_at)
--
-- All three tables have FORCE RLS and the only existing policy
-- ('tenant_isolation') targets fb_eventos_app — which requires a valid
-- current_setting('app.current_tenant_id'). The migratorPool runs as
-- fb_eventos_migrator (DDL/cross-tenant role) which has no such setting.
--
-- THE FIX
-- ─────────────────────────────────────────────────────────────────────────
-- Add SELECT-only (and minimal UPDATE for drain + expire) permissive policies
-- targeting fb_eventos_migrator with USING (true) — no tenant scope applied.
--
-- NARROWLY SCOPED:
--   payment_webhooks_inbox : SELECT only (processing done inside withTenant)
--   outbox_events          : SELECT + UPDATE on processed_at, processing_status,
--                            attempt_count (drain updates these columns)
--   lot_reservations       : SELECT + UPDATE on released_at (expire task sets this)
--
-- This mirrors 0014_zapsign_webhook_tenant_lookup and 0015_pagarme_webhook_tenant_lookup.

-- ────────────────────────────────────────────────────────────────────────────
-- payment_webhooks_inbox — SELECT only for migrator (D-14 / Open Q4)
-- ────────────────────────────────────────────────────────────────────────────

CREATE POLICY "webhook_inbox_migrator_read"
  ON "payment_webhooks_inbox"
  AS PERMISSIVE
  FOR SELECT
  TO fb_eventos_migrator
  USING (true);
--> statement-breakpoint

GRANT SELECT ON "payment_webhooks_inbox" TO fb_eventos_migrator;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- outbox_events — SELECT + UPDATE for migrator (outbox.drain task — AM-03)
-- ────────────────────────────────────────────────────────────────────────────

CREATE POLICY "outbox_events_migrator_read"
  ON "outbox_events"
  AS PERMISSIVE
  FOR SELECT
  TO fb_eventos_migrator
  USING (true);
--> statement-breakpoint

CREATE POLICY "outbox_events_migrator_update"
  ON "outbox_events"
  AS PERMISSIVE
  FOR UPDATE
  TO fb_eventos_migrator
  USING (true);
--> statement-breakpoint

GRANT SELECT, UPDATE ("processed_at", "processing_status", "attempt_count")
  ON "outbox_events" TO fb_eventos_migrator;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- lot_reservations — SELECT + UPDATE for migrator (reservation.expire task)
-- ────────────────────────────────────────────────────────────────────────────

CREATE POLICY "lot_reservations_migrator_read"
  ON "lot_reservations"
  AS PERMISSIVE
  FOR SELECT
  TO fb_eventos_migrator
  USING (true);
--> statement-breakpoint

CREATE POLICY "lot_reservations_migrator_update"
  ON "lot_reservations"
  AS PERMISSIVE
  FOR UPDATE
  TO fb_eventos_migrator
  USING (true);
--> statement-breakpoint

GRANT SELECT, UPDATE ("released_at")
  ON "lot_reservations" TO fb_eventos_migrator;
--> statement-breakpoint
