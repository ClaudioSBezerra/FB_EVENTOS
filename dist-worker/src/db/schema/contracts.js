"use strict";
// FB_EVENTOS — Contracts + contract template versions + ZapSign documents
// schema (Phase 1, Plan 01-01).
//
// FSM: draft → awaiting_org → awaiting_fornecedor → signed
//                                                  → expired
//                                                  → cancelled
//
// ZapSign linkage lives in `zapsign_documents` (separate table — webhook
// payloads are large; we don't bloat `contracts` rows on every callback).
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (contracts + contract_template_versions schema)
//   - 01-CONTEXT.md D-02 (sequential signing), D-08 (template versioning)
//   - ADR-0002 (ZapSign), ADR-0004 (@react-pdf/renderer) — to be authored
Object.defineProperty(exports, "__esModule", { value: true });
exports.zapsignDocuments = exports.contracts = exports.contractTemplateVersions = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const events_1 = require("./events");
const lots_1 = require("./lots");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
const vendors_1 = require("./vendors");
exports.contractTemplateVersions = (0, pg_core_1.pgTable)('contract_template_versions', {
    // `version` is the PK — string identifier like 'fornecedor-stand-v1'
    // (D-08: hardcoded TS template per category). New version = new row +
    // new file under src/contracts/templates/.
    version: (0, pg_core_1.text)('version').primaryKey(),
    description: (0, pg_core_1.text)('description'),
    /** Relative path under src/contracts/templates/ (e.g. fornecedor-stand-v1.tsx). */
    filePath: (0, pg_core_1.text)('file_path').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
});
exports.contracts = (0, pg_core_1.pgTable)('contracts', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    vendorId: (0, pg_core_1.uuid)('vendor_id')
        .notNull()
        .references(() => vendors_1.vendors.id),
    lotId: (0, pg_core_1.uuid)('lot_id')
        .notNull()
        .references(() => lots_1.lots.id),
    eventId: (0, pg_core_1.uuid)('event_id')
        .notNull()
        .references(() => events_1.events.id),
    /** FK to contract_template_versions.version (text PK). */
    templateVersion: (0, pg_core_1.text)('template_version')
        .notNull()
        .references(() => exports.contractTemplateVersions.version),
    /** Draft PDF MinIO key — minted by the Graphile-Worker pdf.generate-contract task. */
    pdfMinioKey: (0, pg_core_1.text)('pdf_minio_key'),
    /** ZapSign document ID once the contract is sent for signing. */
    zapsignDocId: (0, pg_core_1.text)('zapsign_doc_id'),
    /** Signed PDF MinIO key — populated by the doc_signed webhook handler. */
    signedPdfMinioKey: (0, pg_core_1.text)('signed_pdf_minio_key'),
    /**
     * FSM: draft → awaiting_org → awaiting_fornecedor → signed
     *                                                 → expired
     *                                                 → cancelled
     */
    status: (0, pg_core_1.text)('status').notNull().default('draft'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('contracts_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('contracts_vendor_id_idx').on(table.vendorId),
    (0, pg_core_1.index)('contracts_event_id_idx').on(table.eventId),
    (0, pg_core_1.index)('contracts_status_idx').on(table.status),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
exports.zapsignDocuments = (0, pg_core_1.pgTable)('zapsign_documents', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    contractId: (0, pg_core_1.uuid)('contract_id')
        .notNull()
        .references(() => exports.contracts.id),
    /** ZapSign-side ID (the integration's primary key). Unique. */
    zapsignId: (0, pg_core_1.text)('zapsign_id').notNull(),
    /** Last payload sent to ZapSign (for replay / audit). */
    payloadSend: (0, pg_core_1.jsonb)('payload_send'),
    /** Last callback payload received from ZapSign. */
    payloadCallback: (0, pg_core_1.jsonb)('payload_callback'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('zapsign_documents_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('zapsign_documents_contract_id_idx').on(table.contractId),
    (0, pg_core_1.index)('zapsign_documents_zapsign_id_idx').on(table.zapsignId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
