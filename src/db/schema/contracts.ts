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

import { sql } from 'drizzle-orm'
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { events } from './events'
import { lots } from './lots'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'
import { vendors } from './vendors'

export const contractTemplateVersions = pgTable(
  'contract_template_versions',
  {
    // `version` is the PK — string identifier like 'fornecedor-stand-v1'
    // (D-08: hardcoded TS template per category). New version = new row +
    // new file under src/contracts/templates/.
    version: text('version').primaryKey(),
    description: text('description'),
    /** Relative path under src/contracts/templates/ (e.g. fornecedor-stand-v1.tsx). */
    filePath: text('file_path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // No RLS — this is a GLOBAL lookup table shared across all tenants
  // (Phase 3+ may add tenant-override rows; the policy in that case will
  // permit (tenant_id IS NULL OR tenant_id = current_setting)).
)

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    /** FK to contract_template_versions.version (text PK). */
    templateVersion: text('template_version')
      .notNull()
      .references(() => contractTemplateVersions.version),
    /** Draft PDF MinIO key — minted by the Graphile-Worker pdf.generate-contract task. */
    pdfMinioKey: text('pdf_minio_key'),
    /** ZapSign document ID once the contract is sent for signing. */
    zapsignDocId: text('zapsign_doc_id'),
    /** Signed PDF MinIO key — populated by the doc_signed webhook handler. */
    signedPdfMinioKey: text('signed_pdf_minio_key'),
    /**
     * FSM: draft → awaiting_org → awaiting_fornecedor → signed
     *                                                 → expired
     *                                                 → cancelled
     */
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('contracts_tenant_id_idx').on(table.tenantId),
    index('contracts_vendor_id_idx').on(table.vendorId),
    index('contracts_event_id_idx').on(table.eventId),
    index('contracts_status_idx').on(table.status),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

export const zapsignDocuments = pgTable(
  'zapsign_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    /** ZapSign-side ID (the integration's primary key). Unique. */
    zapsignId: text('zapsign_id').notNull(),
    /** Last payload sent to ZapSign (for replay / audit). */
    payloadSend: jsonb('payload_send'),
    /** Last callback payload received from ZapSign. */
    payloadCallback: jsonb('payload_callback'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('zapsign_documents_tenant_id_idx').on(table.tenantId),
    index('zapsign_documents_contract_id_idx').on(table.contractId),
    index('zapsign_documents_zapsign_id_idx').on(table.zapsignId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
