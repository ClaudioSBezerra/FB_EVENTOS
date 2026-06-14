// FB_EVENTOS — Lot factory (Phase 1, Plan 01-01 — Wave 0 test infra;
// adjusted Plan 01-05 to use appPool + SET LOCAL — FORCE RLS on lots
// blocks migratorPool writes).
//
// Builds a `lots` row with default polygon2d geometry and computed area
// (10,000 m² = 100x100 square by default).
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (lots schema + geometry shape)
//   - D-10: jsonb geometry shape — `{"version":1,"type":"polygon2d", ...}`
//   - src/test/factories/lot-category-factory.ts (sibling pattern)

import { appPool } from '@/test/db'

export type Polygon2DGeometry = {
  version: 1
  type: 'polygon2d'
  points: Array<[number, number]>
  z_index: number
}

export interface LotOverrides {
  code?: string
  areaM2?: number
  geometry?: Polygon2DGeometry
  status?: 'available' | 'reserved' | 'sold'
}

export interface PersistedLot {
  id: string
  tenantId: string
  eventId: string
  categoryId: string
  code: string
  areaM2: number
  geometry: Polygon2DGeometry
  status: string
}

/** Default polygon: 100 m × 100 m square = 10,000 m². */
export const DEFAULT_POLYGON: Polygon2DGeometry = {
  version: 1,
  type: 'polygon2d',
  points: [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ],
  z_index: 0,
}

/**
 * Build + persist a lot row tied to (tenantId, eventId, categoryId). By
 * default the lot occupies a 100×100 polygon (10,000 m²) with status
 * 'available'. Pass a different `geometry` to test irregular shapes; the
 * `areaM2` value defaults to 10000 unless overridden.
 */
export async function makeLot(
  tenantId: string,
  eventId: string,
  categoryId: string,
  overrides: LotOverrides = {},
): Promise<PersistedLot> {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  const defaults = {
    code: overrides.code ?? `A-${suffix}`,
    areaM2: overrides.areaM2 ?? 10000,
    geometry: overrides.geometry ?? DEFAULT_POLYGON,
    status: overrides.status ?? 'available',
  }

  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<
      Array<{
        id: string
        tenant_id: string
        event_id: string
        category_id: string
        code: string
        area_m2: string
        geometry: Polygon2DGeometry
        status: string
      }>
    >`
      INSERT INTO lots (
        tenant_id, event_id, category_id, code, area_m2, geometry, status
      ) VALUES (
        ${tenantId}, ${eventId}, ${categoryId}, ${defaults.code},
        ${defaults.areaM2}, ${JSON.stringify(defaults.geometry)}::jsonb,
        ${defaults.status}
      )
      RETURNING id, tenant_id, event_id, category_id, code, area_m2,
                geometry, status
    `
  })

  if (!rows[0]) throw new Error('makeLot: no row returned')
  const r = rows[0]
  return {
    id: r.id,
    tenantId: r.tenant_id,
    eventId: r.event_id,
    categoryId: r.category_id,
    code: r.code,
    areaM2: typeof r.area_m2 === 'string' ? Number(r.area_m2) : (r.area_m2 as number),
    geometry: r.geometry,
    status: r.status,
  }
}
