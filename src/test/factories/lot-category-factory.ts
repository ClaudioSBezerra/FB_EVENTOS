// FB_EVENTOS — Lot category factory (Phase 1, Plan 01-03 — Task 1).
//
// Builds a `lot_categories` row tied to (tenantId, eventId). Defaults model
// the simplest aditivo combo from ADR-0003: base_fixed=0, per_sqm_rate=50
// (R$ 50/m²). Override either or both to test fixed-only, per-sqm-only, or
// hybrid pricing.
//
// REFERENCES:
//   - 01-CONTEXT.md D-09 (aditivo formula)
//   - docs/adr/0003-pricing-model.md (Plan 01-03)
//   - src/test/db.ts (migratorPool pattern)

import { appPool } from '@/test/db'

export interface LotCategoryOverrides {
  name?: string
  baseFixed?: number
  perSqmRate?: number
  color?: string | null
}

export interface PersistedLotCategory {
  id: string
  tenantId: string
  eventId: string
  name: string
  baseFixed: number
  perSqmRate: number
  color: string | null
}

/**
 * Build + persist a lot_categories row. Defaults: name "Default Category",
 * base_fixed=0, per_sqm_rate=50 (R$ 50/m²), color=#22c55e (Tailwind green).
 */
export async function makeLotCategory(
  tenantId: string,
  eventId: string,
  overrides: LotCategoryOverrides = {},
): Promise<PersistedLotCategory> {
  const defaults = {
    name: overrides.name ?? `Categoria ${Math.random().toString(36).slice(2, 8)}`,
    baseFixed: overrides.baseFixed ?? 0,
    perSqmRate: overrides.perSqmRate ?? 50,
    color: overrides.color ?? '#22c55e',
  }

  // lot_categories has FORCE RLS; INSERT via appPool wrapped in a
  // SET LOCAL transaction (same pattern as insertOrganization in test/db.ts).
  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<
      Array<{
        id: string
        tenant_id: string
        event_id: string
        name: string
        base_fixed: string
        per_sqm_rate: string
        color: string | null
      }>
    >`
      INSERT INTO lot_categories (
        tenant_id, event_id, name, base_fixed, per_sqm_rate, color
      ) VALUES (
        ${tenantId}, ${eventId}, ${defaults.name},
        ${defaults.baseFixed.toFixed(2)}, ${defaults.perSqmRate.toFixed(4)},
        ${defaults.color}
      )
      RETURNING id, tenant_id, event_id, name, base_fixed, per_sqm_rate, color
    `
  })

  if (!rows[0]) throw new Error('makeLotCategory: no row returned')
  const r = rows[0]
  return {
    id: r.id,
    tenantId: r.tenant_id,
    eventId: r.event_id,
    name: r.name,
    baseFixed: Number(r.base_fixed),
    perSqmRate: Number(r.per_sqm_rate),
    color: r.color,
  }
}
