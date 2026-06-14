// FB_EVENTOS — Lot categories + aditivo pricing tests
// (Phase 1, Plan 01-03 — Task 3).
//
// Five load-bearing cases:
//
//   1. Aditivo formula: base=0 + per_sqm=R$50/m² + area=4m² → R$200
//   2. Aditivo formula: base=R$1000 + per_sqm=0 → R$1000 (area ignored)
//   3. Aditivo formula: base=R$500 + per_sqm=R$30 + area=10m² → R$800
//   4. Category CRUD round-trip: createLotCategory → updateLotCategory →
//      listEventCategories returns the updated row; deleteLotCategory
//      hides it from future lists.
//   5. deleteLotCategory rejects when a non-deleted lot references it.

import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import { createEventInTenant } from '@/lib/actions/eventos'
import {
  createLotCategoryInTenant,
  deleteLotCategoryInTenant,
  listEventCategoriesInTenant,
  updateLotCategoryInTenant,
} from '@/lib/actions/lot-categories'
import { createLotInTenant } from '@/lib/actions/lots'
import { computeLotPrice, formatBRL } from '@/lib/lots/price'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'

let tenantAId = ''
let userId = ''
let eventAId = ''

beforeEach(async () => {
  const stamp = Date.now()
  tenantAId = await createTenant(`cat-a-${stamp}`, 'Categories Tenant A')
  userId = await insertUser(`cat-actor-${stamp}@example.test`, 'Cat Actor')

  const ev = await withTenant(tenantAId, async (db) => {
    return createEventInTenant(
      db,
      tenantAId,
      {
        name: 'Festa A — Categories',
        startsAt: new Date('2026-09-01T08:00:00Z'),
        endsAt: new Date('2026-09-02T22:00:00Z'),
        placeName: 'Santuário A',
        placeAddress: 'Endereço A',
        capacity: 5000,
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
      },
      userId,
    )
  })
  eventAId = ev.id
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

describe('lot categories — aditivo pricing (ADR-0003) + CRUD (Plan 01-03 Task 3)', () => {
  test('aditivo: base=0 + per_sqm=R$50/m² + area=4m² → R$200', () => {
    const price = computeLotPrice({ baseFixed: 0, perSqmRate: 50 }, { areaM2: 4 })
    expect(price).toBe(200)
    expect(formatBRL(price)).toContain('200')
  })

  test('aditivo: base=R$1000 + per_sqm=0 → R$1000 (area ignored)', () => {
    expect(computeLotPrice({ baseFixed: 1000, perSqmRate: 0 }, { areaM2: 9999 })).toBe(1000)
  })

  test('aditivo: base=R$500 + per_sqm=R$30 + area=10m² → R$800', () => {
    expect(computeLotPrice({ baseFixed: 500, perSqmRate: 30 }, { areaM2: 10 })).toBe(800)
  })

  test('aditivo: numeric string inputs (Postgres mapping) coerce correctly', () => {
    // postgres.js maps numeric → string by default. computeLotPrice must
    // accept both number and string for safe consumption.
    expect(
      computeLotPrice({ baseFixed: '500.00', perSqmRate: '30.0000' }, { areaM2: '10.00' }),
    ).toBe(800)
    expect(computeLotPrice({ baseFixed: 0, perSqmRate: 0 }, { areaM2: 100 })).toBe(0)
  })

  test('CRUD round-trip: create + update + list shows updated values; delete hides it', async () => {
    const created = await withTenant(tenantAId, async (db) => {
      return createLotCategoryInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          name: 'Stand 4m²',
          baseFixed: 200,
          perSqmRate: 0,
          color: '#22c55e',
        },
        userId,
      )
    })
    expect(created.baseFixed).toBe(200)
    expect(created.perSqmRate).toBe(0)
    expect(created.color).toBe('#22c55e')

    const updated = await withTenant(tenantAId, async (db) => {
      return updateLotCategoryInTenant(db, { id: created.id, baseFixed: 0, perSqmRate: 50 }, userId)
    })
    expect(updated).not.toBeNull()
    expect(updated?.baseFixed).toBe(0)
    expect(updated?.perSqmRate).toBe(50)

    const listBefore = await withTenant(tenantAId, async (db) => {
      return listEventCategoriesInTenant(db, { eventId: eventAId })
    })
    expect(listBefore.length).toBe(1)
    expect(listBefore[0]?.perSqmRate).toBe(50)

    const deleted = await withTenant(tenantAId, async (db) => {
      return deleteLotCategoryInTenant(db, { id: created.id }, userId)
    })
    expect(deleted).toBe(true)

    const listAfter = await withTenant(tenantAId, async (db) => {
      return listEventCategoriesInTenant(db, { eventId: eventAId })
    })
    expect(listAfter.length).toBe(0)
  })

  test('deleteLotCategory rejects when a non-deleted lot still references it', async () => {
    // Seed a category + a lot that references it.
    const cat = await withTenant(tenantAId, async (db) => {
      return createLotCategoryInTenant(
        db,
        tenantAId,
        { eventId: eventAId, name: 'In-use category', baseFixed: 0, perSqmRate: 50, color: null },
        userId,
      )
    })
    await withTenant(tenantAId, async (db) => {
      return createLotInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          categoryId: cat.id,
          code: 'A-100',
          geometry: {
            version: 1,
            type: 'polygon2d',
            points: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
            z_index: 0,
          },
        },
        userId,
      )
    })

    await expect(
      withTenant(tenantAId, async (db) => {
        return deleteLotCategoryInTenant(db, { id: cat.id }, userId)
      }),
    ).rejects.toThrow(/existem lotes nesta categoria/)
  })
})
