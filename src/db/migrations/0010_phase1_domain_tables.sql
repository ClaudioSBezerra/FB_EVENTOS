-- FB_EVENTOS — Migration 0010: Phase 1 domain tables (Plan 01-01 Task 3).
--
-- Adds the 12 domain tables that 01-02 through 01-08 depend on:
--   events, lot_categories, lots,
--   vendors, vendor_documents, vendor_applications, lot_assignments,
--   contracts, contract_template_versions, zapsign_documents,
--   payments, pagarme_orders.
--
-- All tenant-scoped tables carry:
--   - tenant_id uuid NOT NULL REFERENCES tenants(id)
--   - pgPolicy('tenant_isolation') targeting fb_eventos_app (DML role)
--   - ALTER TABLE ... ENABLE ROW LEVEL SECURITY (drizzle-generated)
--
-- FORCE RLS, PII column comments, GRANT to fb_eventos_app, and the
-- lot_assignments(lot_id) unique constraint live in migration 0011 so the
-- LGPD audit trail clearly separates "schema" from "hardening" — same
-- pattern as Phase 0's 0006/0007 split (LGPD baseline vs PII comments + grants).
--
-- contract_template_versions is GLOBAL (no tenant_id, no RLS) — a static
-- lookup table of available template IDs.

CREATE TABLE "contract_template_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"description" text,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"template_version" text NOT NULL,
	"pdf_minio_key" text,
	"zapsign_doc_id" text,
	"signed_pdf_minio_key" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "zapsign_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"zapsign_id" text NOT NULL,
	"payload_send" jsonb,
	"payload_callback" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zapsign_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"place_name" text NOT NULL,
	"place_address" text,
	"capacity" integer,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"planta_minio_key" text,
	"planta_content_type" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lot_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_fixed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"per_sqm_rate" numeric(10, 4) DEFAULT '0' NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lot_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"code" text NOT NULL,
	"area_m2" numeric(10, 2) NOT NULL,
	"geometry" jsonb NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pagarme_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pagarme_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"gateway" text DEFAULT 'pagarme' NOT NULL,
	"gateway_order_id" text,
	"gateway_charge_id" text,
	"amount_brl_cents" integer NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lot_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lot_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendor_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendor_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"minio_key" text NOT NULL,
	"content_type" text,
	"size_bytes" bigint,
	"doc_type" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendor_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"cnpj" text NOT NULL,
	"cnpj_verified" boolean DEFAULT false NOT NULL,
	"cnpj_checked_at" timestamp with time zone,
	"cnpj_lookup_cache" jsonb,
	"email" text NOT NULL,
	"phone" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_version_contract_template_versions_version_fk" FOREIGN KEY ("template_version") REFERENCES "public"."contract_template_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zapsign_documents" ADD CONSTRAINT "zapsign_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zapsign_documents" ADD CONSTRAINT "zapsign_documents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_categories" ADD CONSTRAINT "lot_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_categories" ADD CONSTRAINT "lot_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_category_id_lot_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lot_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagarme_orders" ADD CONSTRAINT "pagarme_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagarme_orders" ADD CONSTRAINT "pagarme_orders_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_assignments" ADD CONSTRAINT "lot_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_assignments" ADD CONSTRAINT "lot_assignments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_assignments" ADD CONSTRAINT "lot_assignments_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_assignments" ADD CONSTRAINT "lot_assignments_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_applications" ADD CONSTRAINT "vendor_applications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_tenant_id_idx" ON "contracts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "contracts_vendor_id_idx" ON "contracts" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "contracts_event_id_idx" ON "contracts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "zapsign_documents_tenant_id_idx" ON "zapsign_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "zapsign_documents_contract_id_idx" ON "zapsign_documents" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "zapsign_documents_zapsign_id_idx" ON "zapsign_documents" USING btree ("zapsign_id");--> statement-breakpoint
CREATE INDEX "events_tenant_id_idx" ON "events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "events_status_idx" ON "events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "lot_categories_tenant_id_idx" ON "lot_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lot_categories_event_id_idx" ON "lot_categories" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "lots_tenant_id_idx" ON "lots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lots_event_id_idx" ON "lots" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "lots_category_id_idx" ON "lots" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "lots_status_idx" ON "lots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pagarme_orders_tenant_id_idx" ON "pagarme_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pagarme_orders_payment_id_idx" ON "pagarme_orders" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pagarme_orders_idempotency_key_unique" ON "pagarme_orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_tenant_id_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payments_contract_id_idx" ON "payments" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lot_assignments_tenant_id_idx" ON "lot_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lot_assignments_vendor_id_idx" ON "lot_assignments" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "lot_assignments_lot_id_idx" ON "lot_assignments" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "vendor_applications_tenant_id_idx" ON "vendor_applications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vendor_applications_vendor_id_idx" ON "vendor_applications" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendor_applications_event_id_idx" ON "vendor_applications" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "vendor_documents_tenant_id_idx" ON "vendor_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vendor_documents_vendor_id_idx" ON "vendor_documents" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "vendors_tenant_id_idx" ON "vendors" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vendors_status_idx" ON "vendors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vendors_cnpj_idx" ON "vendors" USING btree ("cnpj");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contracts" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("contracts"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("contracts"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "zapsign_documents" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("zapsign_documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("zapsign_documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "events" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("events"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("events"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lot_categories" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("lot_categories"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("lot_categories"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lots" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("lots"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("lots"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pagarme_orders" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("pagarme_orders"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("pagarme_orders"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("payments"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("payments"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lot_assignments" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("lot_assignments"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("lot_assignments"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vendor_applications" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("vendor_applications"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("vendor_applications"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vendor_documents" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("vendor_documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("vendor_documents"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vendors" AS PERMISSIVE FOR ALL TO "fb_eventos_app" USING ("vendors"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK ("vendors"."tenant_id" = current_setting('app.current_tenant_id', true)::uuid);