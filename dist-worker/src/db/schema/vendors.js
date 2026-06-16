"use strict";
// FB_EVENTOS — Vendors + vendor documents + vendor applications +
// lot assignments schema (Phase 1, Plan 01-01).
//
// PII INVENTORY (LGPD-03, comments installed in migration 0011):
//   - vendors.legal_name      — razão social
//   - vendors.cnpj            — CNPJ (PII identifier)
//   - vendors.email           — contact email
//   - vendors.phone           — contact phone
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (vendors + vendor_documents + lot_assignments)
//   - 01-CONTEXT.md ORG-07..09, ORG-15 (vendor CRUD + doc vault + assignment)
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotAssignments = exports.vendorApplications = exports.vendorDocuments = exports.vendors = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const auth_1 = require("./auth");
const events_1 = require("./events");
const lots_1 = require("./lots");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.vendors = (0, pg_core_1.pgTable)('vendors', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    /** PII: razão social (legal name). */
    legalName: (0, pg_core_1.text)('legal_name').notNull(),
    tradeName: (0, pg_core_1.text)('trade_name'),
    /** PII: CNPJ digits-only. Unique per tenant (Phase 4 may relax). */
    cnpj: (0, pg_core_1.text)('cnpj').notNull(),
    cnpjVerified: (0, pg_core_1.boolean)('cnpj_verified').notNull().default(false),
    cnpjCheckedAt: (0, pg_core_1.timestamp)('cnpj_checked_at', { withTimezone: true }),
    /** Cache of last BrasilAPI response (24h TTL on read path). */
    cnpjLookupCache: (0, pg_core_1.jsonb)('cnpj_lookup_cache'),
    /** PII: contact email. */
    email: (0, pg_core_1.text)('email').notNull(),
    /** PII: contact phone. */
    phone: (0, pg_core_1.text)('phone'),
    // FSM: pending → approved | rejected
    status: (0, pg_core_1.text)('status').notNull().default('pending'),
    /** Free-text reason recorded on rejection (or approval notes). */
    approvalReason: (0, pg_core_1.text)('approval_reason'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('vendors_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('vendors_status_idx').on(table.status),
    (0, pg_core_1.index)('vendors_cnpj_idx').on(table.cnpj),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
exports.vendorDocuments = (0, pg_core_1.pgTable)('vendor_documents', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => exports.vendors.id),
    /** MinIO object key inside `{tenant-slug}-uploads`. */
    minioKey: (0, pg_core_1.text)('minio_key').notNull(),
    contentType: (0, pg_core_1.text)('content_type'),
    sizeBytes: (0, pg_core_1.bigint)('size_bytes', { mode: 'number' }),
    /**
     * Document category: e.g. 'rg' | 'contrato_social' | 'comprovante_endereco'
     * | 'cnpj_card' | 'outros'. Free-form text — UI offers a select but DB
     * does not enum-constrain (organizadoras may need ad-hoc categories).
     */
    docType: (0, pg_core_1.text)('doc_type').notNull(),
    uploadedAt: (0, pg_core_1.timestamp)('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('vendor_documents_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('vendor_documents_vendor_id_idx').on(table.vendorId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
exports.vendorApplications = (0, pg_core_1.pgTable)('vendor_applications', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => exports.vendors.id),
    eventId: (0, pg_core_1.uuid)('event_id')
        .notNull()
        .references(() => events_1.events.id),
    // FSM: open → approved | rejected
    status: (0, pg_core_1.text)('status').notNull().default('open'),
    notes: (0, pg_core_1.text)('notes'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('vendor_applications_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('vendor_applications_vendor_id_idx').on(table.vendorId),
    (0, pg_core_1.index)('vendor_applications_event_id_idx').on(table.eventId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
exports.lotAssignments = (0, pg_core_1.pgTable)('lot_assignments', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => exports.vendors.id),
    /** UNIQUE — one active assignment per lot at a time. Enforced via migration. */
    lotId: (0, pg_core_1.uuid)('lot_id')
        .notNull()
        .references(() => lots_1.lots.id),
    assignedAt: (0, pg_core_1.timestamp)('assigned_at', { withTimezone: true }).defaultNow().notNull(),
    assignedBy: (0, pg_core_1.uuid)('assigned_by').references(() => auth_1.user.id),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('lot_assignments_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('lot_assignments_vendor_id_idx').on(table.vendorId),
    (0, pg_core_1.index)('lot_assignments_lot_id_idx').on(table.lotId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
