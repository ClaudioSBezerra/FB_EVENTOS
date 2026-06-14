// FB_EVENTOS — Lot auto-save Server Action tests
// (Phase 1, Plan 01-03 — Task 1).
//
// Four load-bearing cases for the per-lot auto-save contract (D-11):
//
//   1. updateLotGeometry persists the new geometry + recomputes area_m².
//   2. Two consecutive updates land both — and DO NOT emit audit rows
//      (Phase 1 deliberately keeps auto-save quiet to avoid audit_log
//      noise; only create + delete + status change audit).
//   3. Tenant B cannot update tenant A's lot — the UPDATE silently affects
//      0 rows and returns null (FORCE RLS default-deny).
//   4. Concurrent updates on different lots within the same event do NOT
//      conflict — per-lot scoping is independent.
//
// Tests bypass the next-safe-action wrapper by calling the pure helpers
// directly inside withTenant() — same pattern as Plan 01-02.

import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { auditLog } from '@/db/schema/audit'
import { withTenant } from '@/db/with-tenant'
import { createEventInTenant } from '@/lib/actions/eventos'
import {
  createLotInTenant,
  deleteLotInTenant,
  listEventLotsInTenant,
  updateLotGeometryInTenant,
} from '@/lib/actions/lots'
import type { Geometry } from '@/lib/validators/geometry'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'
import { makeLotCategory } from '@/test/factories/lot-category-factory'

let tenantAId = ''
let tenantBId = ''
let userId = ''
let eventAId = ''
let categoryAId = ''

const baseSquare: Geometry = {
  version: 1,
  type: 'polygon2d',
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  z_index: 0,
}

const movedSquare: Geometry = {
  version: 1,
  type: 'polygon2d',
  points: [
    [50, 50],
    [60, 50],
    [60, 60],
    [50, 60],
  ],
  z_index: 0,
}

const resizedSquare: Geometry = {
  version: 1,
  type: 'polygon2d',
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
  z_index: 0,
}

beforeEach(async () => {
  const stamp = Date.now()
  tenantAId = await createTenant(`auto-a-${stamp}`, 'Auto-Save Tenant A')
  tenantBId = await createTenant(`auto-b-${stamp}`, 'Auto-Save Tenant B')
  userId = await insertUser(`auto-actor-${stamp}@example.test`, 'Auto Actor')

  // Seed event for tenant A.
  const ev = await withTenant(tenantAId, async (db) => {
    return createEventInTenant(
      db,
      tenantAId,
      {
        name: 'Festa A — Auto-save',
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

  // Seed a category via migratorPool (factory bypasses RLS for fast setup).
  const cat = await makeLotCategory(tenantAId, eventAId, {
    name: 'Stand 10m²',
    baseFixed: 0,
    perSqmRate: 50,
  })
  categoryAId = cat.id
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

describe('lot auto-save — per-lot UPDATE + RLS isolation (Plan 01-03 Task 1)', () => {
  test('updateLotGeometry persists the new geometry AND recomputes area_m² server-side', async () => {
    const created = await withTenant(tenantAId, async (db) => {
      return createLotInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          categoryId: categoryAId,
          code: 'A-01',
          geometry: baseSquare,
        },
        userId,
      )
    })

    // 10×10 square → 100 m²
    expect(created.areaM2).toBeCloseTo(100, 2)
    expect(created.geometry.type).toBe('polygon2d')

    // Now resize to 20×20 → 400 m².
    const updated = await withTenant(tenantAId, async (db) => {
      return updateLotGeometryInTenant(db, { lotId: created.id, geometry: resizedSquare })
    })
    expect(updated).not.toBeNull()
    expect(updated?.areaM2).toBeCloseTo(400, 2)
    if (updated?.geometry.type === 'polygon2d') {
      expect(updated.geometry.points).toEqual(resizedSquare.points)
    }
  })

  test('two consecutive updates land, audit_log only has create row (no per-drag audit)', async () => {
    const created = await withTenant(tenantAId, async (db) => {
      return createLotInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          categoryId: categoryAId,
          code: 'A-02',
          geometry: baseSquare,
        },
        userId,
      )
    })

    // Auto-save 1: move it.
    const a = await withTenant(tenantAId, async (db) => {
      return updateLotGeometryInTenant(db, { lotId: created.id, geometry: movedSquare })
    })
    expect(a).not.toBeNull()

    // Auto-save 2: resize it.
    const b = await withTenant(tenantAId, async (db) => {
      return updateLotGeometryInTenant(db, { lotId: created.id, geometry: resizedSquare })
    })
    expect(b).not.toBeNull()
    expect(b?.areaM2).toBeCloseTo(400, 2)

    // Audit log should contain ONLY the create row — geometry updates are
    // intentionally not audited (Phase 1, D-11 + RESEARCH §A5 pitfall 7).
    const auditRows = await withTenant(tenantAId, async (db) => {
      return db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, created.id))
    })
    const actions = auditRows.map((r) => r.action)
    expect(actions).toEqual(['lot.created'])
  })

  test('cross-tenant: tenant B cannot UPDATE tenant A geometry (RLS default-deny → null)', async () => {
    const aLot = await withTenant(tenantAId, async (db) => {
      return createLotInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          categoryId: categoryAId,
          code: 'A-03',
          geometry: baseSquare,
        },
        userId,
      )
    })

    // Tenant B tries to update tenant A's lot — RLS hides it, UPDATE affects
    // 0 rows, helper returns null (silent default-deny by design).
    const result = await withTenant(tenantBId, async (db) => {
      return updateLotGeometryInTenant(db, { lotId: aLot.id, geometry: resizedSquare })
    })
    expect(result).toBeNull()

    // Tenant A reads back: still the original geometry.
    const readback = await withTenant(tenantAId, async (db) => {
      return listEventLotsInTenant(db, { eventId: eventAId })
    })
    const lot = readback.find((l) => l.id === aLot.id)
    expect(lot).toBeTruthy()
    expect(lot?.areaM2).toBeCloseTo(100, 2)
  })

  test('concurrent updates on DIFFERENT lots within same event do not conflict', async () => {
    const lotA = await withTenant(tenantAId, async (db) => {
      return createLotInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          categoryId: categoryAId,
          code: 'A-CONCURRENT-1',
          geometry: baseSquare,
        },
        userId,
      )
    })
    const lotB = await withTenant(tenantAId, async (db) => {
      return createLotInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          categoryId: categoryAId,
          code: 'A-CONCURRENT-2',
          geometry: baseSquare,
        },
        userId,
      )
    })

    // Fire two concurrent updateLotGeometry calls — distinct lotIds, so
    // postgres handles them independently. Both must succeed.
    const [resA, resB] = await Promise.all([
      withTenant(tenantAId, async (db) =>
        updateLotGeometryInTenant(db, { lotId: lotA.id, geometry: movedSquare }),
      ),
      withTenant(tenantAId, async (db) =>
        updateLotGeometryInTenant(db, { lotId: lotB.id, geometry: resizedSquare }),
      ),
    ])
    expect(resA).not.toBeNull()
    expect(resB).not.toBeNull()
    expect(resA?.areaM2).toBeCloseTo(100, 2) // movedSquare is still 10×10
    expect(resB?.areaM2).toBeCloseTo(400, 2) // resizedSquare 20×20

    // Both lots persisted independently.
    const lots = await withTenant(tenantAId, async (db) => {
      return listEventLotsInTenant(db, { eventId: eventAId })
    })
    expect(lots.length).toBe(2)
  })

  test('deleteLot soft-deletes AND emits audit row; listEventLots hides deleted rows', async () => {
    const created = await withTenant(tenantAId, async (db) => {
      return createLotInTenant(
        db,
        tenantAId,
        {
          eventId: eventAId,
          categoryId: categoryAId,
          code: 'A-DEL',
          geometry: baseSquare,
        },
        userId,
      )
    })

    const ok = await withTenant(tenantAId, async (db) => {
      return deleteLotInTenant(db, { lotId: created.id }, userId)
    })
    expect(ok).toBe(true)

    const remaining = await withTenant(tenantAId, async (db) => {
      return listEventLotsInTenant(db, { eventId: eventAId })
    })
    expect(remaining.find((l) => l.id === created.id)).toBeUndefined()

    const deleteAudit = await withTenant(tenantAId, async (db) => {
      return db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, created.id), eq(auditLog.action, 'lot.deleted')))
    })
    expect(deleteAudit.length).toBe(1)
  })
})
