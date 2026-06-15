// FB_EVENTOS — Dashboard occupancy aggregates tests (Phase 1, Plan 01-07 Task 1).
//
// Six load-bearing cases for getEventOccupancyInTenant:
//   1. Empty event (no lots) → totals + percentages all zero
//   2. Mixed status (1 available + 1 reserved + 2 sold of 4) → percentLotsSold=50
//   3. Mixed area sizes → percentM2Sold tracks area, not count
//   4. Mixed prices via categories → totalRevenueBRL reflects base + area×rate
//   5. Cross-tenant isolation — tenant B sees 0 for tenant A's event
//   6. Soft-deleted lots are excluded
//
// Helper fixtures use the same appPool + SET LOCAL pattern as the other
// Phase 1 tests (lot-factory, lot-category-factory, event-factory).

import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import { getEventOccupancyInTenant } from '@/lib/actions/dashboard'
import { appPool, createTenant, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// Reset state between tests: create a fresh tenant + event per test so we
// don't bleed previous fixtures into the GROUP BY result set.
let tenantId = ''
let eventId = ''

beforeEach(async () => {
  const stamp = `dash-occ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  tenantId = await createTenant(stamp, `Tenant ${stamp}`)
  const ev = await makeEvent(tenantId)
  eventId = ev.id
})

describe('getEventOccupancy — empty event', () => {
  test('event with no lots returns all-zero counts + percents', async () => {
    const result = await withTenant(tenantId, async (db) =>
      getEventOccupancyInTenant(db, { eventId }),
    )
    expect(result.totalLots).toBe(0)
    expect(result.byStatus).toEqual({ available: 0, reserved: 0, sold: 0 })
    expect(result.percentLotsSold).toBe(0)
    expect(result.percentM2Sold).toBe(0)
    expect(result.percentRevenueSold).toBe(0)
    expect(result.totalRevenueBRL).toBe(0)
    expect(result.soldRevenueBRL).toBe(0)
    expect(result.totalAreaM2).toBe(0)
    expect(result.soldAreaM2).toBe(0)
  })
})

describe('getEventOccupancy — mixed statuses', () => {
  test('4 lots (1 available, 1 reserved, 2 sold) → percentLotsSold=50%', async () => {
    const cat = await makeLotCategory(tenantId, eventId, { baseFixed: 0, perSqmRate: 50 })
    // All same size to isolate the count-based percentage.
    await makeLot(tenantId, eventId, cat.id, { code: 'L-1', areaM2: 100, status: 'available' })
    await makeLot(tenantId, eventId, cat.id, { code: 'L-2', areaM2: 100, status: 'reserved' })
    await makeLot(tenantId, eventId, cat.id, { code: 'L-3', areaM2: 100, status: 'sold' })
    await makeLot(tenantId, eventId, cat.id, { code: 'L-4', areaM2: 100, status: 'sold' })

    const result = await withTenant(tenantId, async (db) =>
      getEventOccupancyInTenant(db, { eventId }),
    )
    expect(result.totalLots).toBe(4)
    expect(result.byStatus).toEqual({ available: 1, reserved: 1, sold: 2 })
    expect(result.percentLotsSold).toBe(50)
    // 50 m² × 100 each at R$ 50/m² + base=0 → R$ 5000 each, sold=2 → R$10000
    expect(result.totalRevenueBRL).toBe(20000)
    expect(result.soldRevenueBRL).toBe(10000)
    expect(result.percentRevenueSold).toBe(50)
  })
})

describe('getEventOccupancy — mixed area sizes', () => {
  test('percentM2Sold tracks area, not lot count', async () => {
    const cat = await makeLotCategory(tenantId, eventId, { baseFixed: 0, perSqmRate: 50 })
    // 1 sold of 50 m² + 2 available of 25 m² each → sold area = 50, total = 100 → 50%
    await makeLot(tenantId, eventId, cat.id, { code: 'A-1', areaM2: 50, status: 'sold' })
    await makeLot(tenantId, eventId, cat.id, { code: 'A-2', areaM2: 25, status: 'available' })
    await makeLot(tenantId, eventId, cat.id, { code: 'A-3', areaM2: 25, status: 'available' })

    const result = await withTenant(tenantId, async (db) =>
      getEventOccupancyInTenant(db, { eventId }),
    )
    expect(result.totalLots).toBe(3)
    expect(result.totalAreaM2).toBe(100)
    expect(result.soldAreaM2).toBe(50)
    expect(result.percentM2Sold).toBe(50)
    // percentLotsSold ≠ percentM2Sold here (1/3 ≈ 33.3% vs 50% by area).
    expect(result.percentLotsSold).toBeCloseTo(33.3, 1)
  })
})

describe('getEventOccupancy — mixed prices via different categories', () => {
  test('totalRevenueBRL reflects base + area×rate per category', async () => {
    // Two categories at different price points.
    const premium = await makeLotCategory(tenantId, eventId, {
      name: 'Premium',
      baseFixed: 1000,
      perSqmRate: 100,
    })
    const standard = await makeLotCategory(tenantId, eventId, {
      name: 'Standard',
      baseFixed: 0,
      perSqmRate: 50,
    })
    // Premium 10 m² → 1000 + 10×100 = 2000
    await makeLot(tenantId, eventId, premium.id, { code: 'P-1', areaM2: 10, status: 'sold' })
    // Standard 20 m² → 0 + 20×50 = 1000
    await makeLot(tenantId, eventId, standard.id, { code: 'S-1', areaM2: 20, status: 'available' })

    const result = await withTenant(tenantId, async (db) =>
      getEventOccupancyInTenant(db, { eventId }),
    )
    expect(result.totalLots).toBe(2)
    expect(result.totalRevenueBRL).toBe(3000)
    expect(result.soldRevenueBRL).toBe(2000)
    expect(result.percentRevenueSold).toBeCloseTo(66.7, 1)
  })
})

describe('getEventOccupancy — tenant isolation', () => {
  test('tenant B sees zero for tenant A event (RLS hides cross-tenant rows)', async () => {
    // Tenant A: populated event
    const catA = await makeLotCategory(tenantId, eventId, { baseFixed: 0, perSqmRate: 50 })
    await makeLot(tenantId, eventId, catA.id, { code: 'A-X', areaM2: 100, status: 'sold' })

    // Tenant B: separate tenant, queries with tenant A's event id
    const stamp = `dash-occ-rls-b-${Date.now()}`
    const tenantBId = await createTenant(stamp, `Tenant B ${stamp}`)

    const result = await withTenant(tenantBId, async (db) =>
      getEventOccupancyInTenant(db, { eventId }),
    )
    expect(result.totalLots).toBe(0)
    expect(result.byStatus).toEqual({ available: 0, reserved: 0, sold: 0 })
    expect(result.totalRevenueBRL).toBe(0)
  })
})

describe('getEventOccupancy — soft-deleted lots excluded', () => {
  test('soft-deleted lots do not contribute to counts / revenue', async () => {
    const cat = await makeLotCategory(tenantId, eventId, { baseFixed: 0, perSqmRate: 50 })
    const live = await makeLot(tenantId, eventId, cat.id, {
      code: 'LIVE',
      areaM2: 100,
      status: 'sold',
    })
    const dead = await makeLot(tenantId, eventId, cat.id, {
      code: 'DEAD',
      areaM2: 999, // would skew area if counted
      status: 'sold',
    })

    // Soft-delete the second lot via app pool + SET LOCAL.
    await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      await tx`UPDATE lots SET deleted_at = now() WHERE id = ${dead.id}`
    })

    const result = await withTenant(tenantId, async (db) =>
      getEventOccupancyInTenant(db, { eventId }),
    )
    expect(result.totalLots).toBe(1)
    expect(result.byStatus.sold).toBe(1)
    expect(result.totalAreaM2).toBe(100)
    // Live = 100 m² × R$50 = R$5000 (dead excluded).
    expect(result.totalRevenueBRL).toBe(5000)
    // Sanity: the deleted lot's id is still in the DB.
    expect(live.id).not.toBe(dead.id)
  })
})
