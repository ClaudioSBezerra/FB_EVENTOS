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

import { sql } from 'drizzle-orm'
import { index, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    placeName: text('place_name').notNull(),
    // PII (low-sensitivity): venue address. Tagged via COMMENT ON COLUMN
    // in migration 0011 (LGPD-03 inventory).
    placeAddress: text('place_address'),
    capacity: integer('capacity'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    currency: text('currency').notNull().default('BRL'),
    // Planta upload — MinIO object key inside `{tenant-slug}-uploads`.
    // Null until the organizadora uploads a planta. Content-type lives
    // alongside so downstream readers can render correctly.
    plantaMinioKey: text('planta_minio_key'),
    plantaContentType: text('planta_content_type'),
    // FSM: draft → published → archived
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('events_tenant_id_idx').on(table.tenantId),
    index('events_status_idx').on(table.status),
    index('events_starts_at_idx').on(table.startsAt),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
