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

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { events } from './events'
import { lots } from './lots'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** PII: razão social (legal name). */
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    /** PII: CNPJ digits-only. Unique per tenant (Phase 4 may relax). */
    cnpj: text('cnpj').notNull(),
    cnpjVerified: boolean('cnpj_verified').notNull().default(false),
    cnpjCheckedAt: timestamp('cnpj_checked_at', { withTimezone: true }),
    /** Cache of last BrasilAPI response (24h TTL on read path). */
    cnpjLookupCache: jsonb('cnpj_lookup_cache'),
    /** PII: contact email. */
    email: text('email').notNull(),
    /** PII: contact phone. */
    phone: text('phone'),
    // FSM: pending → approved | rejected
    status: text('status').notNull().default('pending'),
    /** Free-text reason recorded on rejection (or approval notes). */
    approvalReason: text('approval_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('vendors_tenant_id_idx').on(table.tenantId),
    index('vendors_status_idx').on(table.status),
    index('vendors_cnpj_idx').on(table.cnpj),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

export const vendorDocuments = pgTable(
  'vendor_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    /** MinIO object key inside `{tenant-slug}-uploads`. */
    minioKey: text('minio_key').notNull(),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /**
     * Document category: e.g. 'rg' | 'contrato_social' | 'comprovante_endereco'
     * | 'cnpj_card' | 'outros'. Free-form text — UI offers a select but DB
     * does not enum-constrain (organizadoras may need ad-hoc categories).
     */
    docType: text('doc_type').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('vendor_documents_tenant_id_idx').on(table.tenantId),
    index('vendor_documents_vendor_id_idx').on(table.vendorId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

export const vendorApplications = pgTable(
  'vendor_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    // FSM: open → approved | rejected
    status: text('status').notNull().default('open'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('vendor_applications_tenant_id_idx').on(table.tenantId),
    index('vendor_applications_vendor_id_idx').on(table.vendorId),
    index('vendor_applications_event_id_idx').on(table.eventId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

export const lotAssignments = pgTable(
  'lot_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    /** UNIQUE — one active assignment per lot at a time. Enforced via migration. */
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lots.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
    assignedBy: uuid('assigned_by').references(() => user.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('lot_assignments_tenant_id_idx').on(table.tenantId),
    index('lot_assignments_vendor_id_idx').on(table.vendorId),
    index('lot_assignments_lot_id_idx').on(table.lotId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
