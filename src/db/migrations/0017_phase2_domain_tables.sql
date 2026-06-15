-- FB_EVENTOS — Migration 0017: Phase 2 domain tables (Plan 02-01 Task 2).
--
-- Adds the 8 domain tables that Plans 02-02 through 02-08 depend on:
--   event_addons, cart_addon_lines, lot_reservations, lot_waitlist,
--   outbox_events, payment_webhooks_inbox, refund_requests, vendor_consents.
--
-- GENERATED BASE: drizzle-kit generate (0017_bright_hawkeye.sql) + hand-edited:
--   - Removed cnpj_lookup_cache (already in 0012_cnpj_lookup_cache.sql)
--   - Removed tenants.platform_commission_pct (already in 0016_tenant_platform_commission.sql)
--   - Removed tenants.vendor_auto_approve + refund_policy_json → moved to 0020
--   - Removed cnpj_lookup_cache_cached_at_idx (already applied via migration 0012)
--
-- All tenant-scoped tables carry:
--   - tenant_id uuid NOT NULL REFERENCES tenants(id)
--   - pgPolicy('tenant_isolation') targeting fb_eventos_app (DML role)
--   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY (drizzle-generated)
--
-- FORCE RLS, PII column comments, GRANT to fb_eventos_app, CHECK constraints,
-- and the lot_reservations partial UNIQUE live in migration 0018 so the
-- LGPD audit trail clearly separates "schema creation" from "hardening" —
-- same pattern as Phase 1's 0010/0011 split.

CREATE TABLE "cart_addon_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"addon_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price_brl_cents_snapshot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_addon_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_brl_cents" integer NOT NULL,
	"max_qty" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event_addons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lot_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"payment_method" text
);
--> statement-breakpoint
ALTER TABLE "lot_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lot_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"token_jti" uuid
);
--> statement-breakpoint
ALTER TABLE "lot_waitlist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_webhooks_inbox" (
	"gateway_event_id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_webhooks_inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refund_pct" numeric(5, 2) NOT NULL,
	"refund_amount_brl_cents" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"pagarme_refund_id" text,
	"completed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "refund_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendor_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"consent_type" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"consent_text" text,
	"consent_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cart_addon_lines" ADD CONSTRAINT "cart_addon_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_addon_lines" ADD CONSTRAINT "cart_addon_lines_reservation_id_lot_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."lot_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_addon_lines" ADD CONSTRAINT "cart_addon_lines_addon_id_event_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."event_addons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_addons" ADD CONSTRAINT "event_addons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_addons" ADD CONSTRAINT "event_addons_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_reservations" ADD CONSTRAINT "lot_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_reservations" ADD CONSTRAINT "lot_reservations_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_reservations" ADD CONSTRAINT "lot_reservations_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_reservations" ADD CONSTRAINT "lot_reservations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_waitlist" ADD CONSTRAINT "lot_waitlist_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_waitlist" ADD CONSTRAINT "lot_waitlist_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_waitlist" ADD CONSTRAINT "lot_waitlist_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_waitlist" ADD CONSTRAINT "lot_waitlist_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhooks_inbox" ADD CONSTRAINT "payment_webhooks_inbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_consents" ADD CONSTRAINT "vendor_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_consents" ADD CONSTRAINT "vendor_consents_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_addon_lines_tenant_id_idx" ON "cart_addon_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "cart_addon_lines_reservation_id_idx" ON "cart_addon_lines" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "event_addons_tenant_id_idx" ON "event_addons" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "event_addons_event_id_idx" ON "event_addons" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_addons_active_idx" ON "event_addons" USING btree ("active");--> statement-breakpoint
CREATE INDEX "lot_reservations_tenant_id_idx" ON "lot_reservations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lot_reservations_vendor_id_idx" ON "lot_reservations" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "lot_reservations_lot_id_idx" ON "lot_reservations" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "lot_reservations_expires_at_idx" ON "lot_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lot_waitlist_tenant_id_idx" ON "lot_waitlist" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lot_waitlist_lot_id_joined_at_idx" ON "lot_waitlist" USING btree ("lot_id","joined_at");--> statement-breakpoint
CREATE INDEX "outbox_events_tenant_id_idx" ON "outbox_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "outbox_events_event_type_idx" ON "outbox_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "outbox_events_unprocessed_idx" ON "outbox_events" USING btree ("created_at") WHERE processed_at IS NULL AND processing_status != 'failed';--> statement-breakpoint
CREATE INDEX "payment_webhooks_inbox_tenant_id_idx" ON "payment_webhooks_inbox" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_webhooks_inbox_status_received_idx" ON "payment_webhooks_inbox" USING btree ("processing_status","received_at");--> statement-breakpoint
CREATE INDEX "refund_requests_tenant_id_idx" ON "refund_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "refund_requests_payment_id_idx" ON "refund_requests" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "vendor_consents_tenant_id_idx" ON "vendor_consents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vendor_consents_vendor_id_idx" ON "vendor_consents" USING btree ("vendor_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cart_addon_lines" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("cart_addon_lines"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("cart_addon_lines"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "event_addons" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("event_addons"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("event_addons"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lot_reservations" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("lot_reservations"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("lot_reservations"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lot_waitlist" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("lot_waitlist"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("lot_waitlist"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox_events" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("outbox_events"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("outbox_events"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_webhooks_inbox" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("payment_webhooks_inbox"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("payment_webhooks_inbox"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "refund_requests" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("refund_requests"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("refund_requests"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vendor_consents" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("vendor_consents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("vendor_consents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);