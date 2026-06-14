// FB_EVENTOS — Event factory (Phase 1, Plan 01-01 — Wave 0 test infra;
// adjusted Plan 01-05 to use appPool + SET LOCAL because events carries
// FORCE RLS and the migratorPool was getting default-deny on INSERT
// — same pattern fix applied earlier to vendor-factory + lot-category-factory).
//
// Builds an `events` row with sane defaults. Uses appPool wrapped in a
// SET LOCAL transaction so the FORCE-RLS policy lets the INSERT through
// (the production path goes through withTenant which does the same).
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (events schema)
//   - src/test/db.ts (appPool + SET LOCAL pattern via insertOrganization)
//   - src/test/factories/lot-category-factory.ts (sibling pattern)

import { appPool } from '@/test/db'

export interface EventOverrides {
  name?: string
  startsAt?: Date
  endsAt?: Date
  placeName?: string
  placeAddress?: string
  capacity?: number
  timezone?: string
  currency?: string
  status?: 'draft' | 'published' | 'archived'
  plantaMinioKey?: string | null
}

export interface PersistedEvent {
  id: string
  tenantId: string
  name: string
  startsAt: Date
  endsAt: Date
  placeName: string
  placeAddress: string | null
  capacity: number | null
  timezone: string
  currency: string
  status: string
  plantaMinioKey: string | null
}

/**
 * Build + persist an event row for `tenantId`. Overrides merge into sane
 * defaults (Festa de Trindade-style metadata).
 *
 * Returns the persisted row including the generated UUID.
 */
export async function makeEvent(
  tenantId: string,
  overrides: EventOverrides = {},
): Promise<PersistedEvent> {
  const defaults = {
    name: overrides.name ?? `Festa de Teste ${Date.now()}`,
    startsAt: overrides.startsAt ?? new Date('2026-07-01T00:00:00Z'),
    endsAt: overrides.endsAt ?? new Date('2026-07-15T23:59:59Z'),
    placeName: overrides.placeName ?? 'Santuário Trindade',
    placeAddress: overrides.placeAddress ?? 'Rua Teste, 100 — Trindade/GO',
    capacity: overrides.capacity ?? 900000,
    timezone: overrides.timezone ?? 'America/Sao_Paulo',
    currency: overrides.currency ?? 'BRL',
    status: overrides.status ?? 'draft',
    plantaMinioKey: overrides.plantaMinioKey ?? null,
  }

  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<
      Array<{
        id: string
        tenant_id: string
        name: string
        starts_at: Date
        ends_at: Date
        place_name: string
        place_address: string | null
        capacity: number | null
        timezone: string
        currency: string
        status: string
        planta_minio_key: string | null
      }>
    >`
      INSERT INTO events (
        tenant_id, name, starts_at, ends_at, place_name, place_address,
        capacity, timezone, currency, status, planta_minio_key
      ) VALUES (
        ${tenantId}, ${defaults.name}, ${defaults.startsAt}, ${defaults.endsAt},
        ${defaults.placeName}, ${defaults.placeAddress}, ${defaults.capacity},
        ${defaults.timezone}, ${defaults.currency}, ${defaults.status},
        ${defaults.plantaMinioKey}
      )
      RETURNING id, tenant_id, name, starts_at, ends_at, place_name,
                place_address, capacity, timezone, currency, status,
                planta_minio_key
    `
  })

  if (!rows[0]) throw new Error('makeEvent: no row returned')
  const r = rows[0]
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    placeName: r.place_name,
    placeAddress: r.place_address,
    capacity: r.capacity,
    timezone: r.timezone,
    currency: r.currency,
    status: r.status,
    plantaMinioKey: r.planta_minio_key,
  }
}
