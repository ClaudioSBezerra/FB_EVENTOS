"use strict";
// FB_EVENTOS — Events schema (Phase 1, Plan 01-01).
//
// The `events` table is the top of the Phase 1 domain hierarchy. Every
// other Phase 1 table (lots, contracts, payments, vendor_applications,
// lot_assignments) carries an `event_id` foreign key.
//
// RLS SHAPE (per Phase 0 Pattern 1):
//   - tenant_id NOT NULL references tenants(id)
//   - pgPolicy('tenant_isolation', { to: fbEventosApp, ... })
//   - .enableRLS() on the table builder (drizzle-orm@0.45.2)
//   - ALTER TABLE events FORCE ROW LEVEL SECURITY  (in 0011 migration)
//
// PII INVENTORY:
//   - place_address — venue street address (low-sensitivity but may
//     identify the organizadora's commercial footprint). Annotated via
//     COMMENT ON COLUMN in migration 0011.
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (events schema highlights)
//   - 01-CONTEXT.md D-01..D-12 (event metadata + planta key)
Object.defineProperty(exports, "__esModule", { value: true });
exports.events = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
exports.events = (0, pg_core_1.pgTable)('events', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    name: (0, pg_core_1.text)('name').notNull(),
    startsAt: (0, pg_core_1.timestamp)('starts_at', { withTimezone: true }).notNull(),
    endsAt: (0, pg_core_1.timestamp)('ends_at', { withTimezone: true }).notNull(),
    placeName: (0, pg_core_1.text)('place_name').notNull(),
    // PII (low-sensitivity): venue address. Tagged via COMMENT ON COLUMN
    // in migration 0011 (LGPD-03 inventory).
    placeAddress: (0, pg_core_1.text)('place_address'),
    capacity: (0, pg_core_1.integer)('capacity'),
    timezone: (0, pg_core_1.text)('timezone').notNull().default('America/Sao_Paulo'),
    currency: (0, pg_core_1.text)('currency').notNull().default('BRL'),
    // Planta upload — MinIO object key inside `{tenant-slug}-uploads`.
    // Null until the organizadora uploads a planta. Content-type lives
    // alongside so downstream readers can render correctly.
    plantaMinioKey: (0, pg_core_1.text)('planta_minio_key'),
    plantaContentType: (0, pg_core_1.text)('planta_content_type'),
    // FSM: draft → published → archived
    status: (0, pg_core_1.text)('status').notNull().default('draft'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
}, (table) => [
    (0, pg_core_1.index)('events_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('events_status_idx').on(table.status),
    (0, pg_core_1.index)('events_starts_at_idx').on(table.startsAt),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
