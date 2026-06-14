// FB_EVENTOS — Lot assignment tests (Phase 1, Plan 01-03 — Task 3).
//
// Five load-bearing cases:
//
//   1. Approved vendor → assignment succeeds + audit_log row written.
//   2. Pending vendor  → rejected with descriptive error (no row, no audit).
//   3. Double-assign on the same lot rejected by partial UNIQUE
//      `lot_assignments_lot_id_active_unique` (lot_id WHERE deleted_at IS NULL).
//   4. Tenant B cannot assign tenant A's lot (RLS proof: lot lookup returns
//      0 rows under tenant B context → action raises 'Lote não encontrado').
//   5. unassign → re-assign on the same lot succeeds (soft-delete unblocks
//      the partial UNIQUE).
//
// REFERENCES:
//   - src/lib/actions/lot-assignments.ts (assignLotToVendorInTenant,
//     unassignLotInTenant, listAssignedLotsInTenant)
//   - src/db/migrations/0011_phase1_force_rls.sql (partial UNIQUE index)
//   - 01-CONTEXT.md D-08 / D-09 (assignment FSM)

import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { withTenant } from '@/db/with-tenant'
import { createEventInTenant } from '@/lib/actions/eventos'
import {
  assignLotToVendorInTenant,
  listAssignedLotsInTenant,
  unassignLotInTenant,
} from '@/lib/actions/lot-assignments'
import { createLotCategoryInTenant } from '@/lib/actions/lot-categories'
import { createLotInTenant } from '@/lib/actions/lots'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'
import { makeVendor } from '@/test/factories/vendor-factory'

const SQUARE_10x10 = {
  version: 1 as const,
  type: 'polygon2d' as const,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ] as Array<[number, number]>,
  z_index: 0,
}

let lotSeq = 0
const mkCode = () => `L-${++lotSeq}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

async function makeLotForTenant(tenantId: string, eventId: string, categoryId: string, code?: string) {
  return withTenant(tenantId, async (db) =>
    createLotInTenant(
      db,
      tenantId,
      { eventId, categoryId, code: code ?? mkCode(), geometry: SQUARE_10x10 },
      userId,
    ),
  )
}

let tenantAId = ''
let tenantBId = ''
let userId = ''
let eventAId = ''
let categoryAId = ''

beforeEach(async () => {
  const stamp = Date.now()
  tenantAId = await createTenant(`asgn-a-${stamp}`, 'Assignment Tenant A')
  tenantBId = await createTenant(`asgn-b-${stamp}`, 'Assignment Tenant B')
  userId = await insertUser(`asgn-actor-${stamp}@example.test`, 'Asgn Actor')

  const ev = await withTenant(tenantAId, async (db) =>
    createEventInTenant(
      db,
      tenantAId,
      {
        name: 'Festa A — Assignment',
        startsAt: new Date('2026-10-01T08:00:00Z'),
        endsAt: new Date('2026-10-02T22:00:00Z'),
        placeName: 'Santuário A',
        placeAddress: 'Endereço A',
        capacity: 5000,
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
      },
      userId,
    ),
  )
  eventAId = ev.id

  const cat = await withTenant(tenantAId, async (db) =>
    createLotCategoryInTenant(
      db,
      tenantAId,
      {
        eventId: eventAId,
        name: 'Stand 4m²',
        baseFixed: 200,
        perSqmRate: 0,
        color: '#10B981',
      },
      userId,
    ),
  )
  categoryAId = cat.id
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
})

describe('lot_assignments — approved vendor flow', () => {
  test('assigning an approved vendor succeeds + writes audit row', async () => {
    const vendor = await makeVendor(tenantAId, {
      legalName: 'Aprovado LTDA',
      status: 'approved',
    })
    const lot = await makeLotForTenant(tenantAId, eventAId, categoryAId)

    const assignment = await withTenant(tenantAId, async (db) =>
      assignLotToVendorInTenant(
        db,
        tenantAId,
        { lotId: lot.id, vendorId: vendor.id },
        userId,
      ),
    )

    expect(assignment.lotId).toBe(lot.id)
    expect(assignment.vendorId).toBe(vendor.id)
    expect(assignment.tenantId).toBe(tenantAId)
    expect(assignment.assignedBy).toBe(userId)

    // Audit row exists with the right action. audit_log has FORCE RLS so
    // read via appPool inside a SET LOCAL transaction.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ action: string; entity_id: string }>>`
        SELECT action, entity_id FROM audit_log
        WHERE action = 'lot_assignment.created' AND entity_id = ${assignment.id}
      `
    })
    expect(audits).toHaveLength(1)
  })

  test('listAssignedLots returns the active assignment with vendor label', async () => {
    const vendor = await makeVendor(tenantAId, {
      legalName: 'Outra Aprovada LTDA',
      status: 'approved',
    })
    const lot = await makeLotForTenant(tenantAId, eventAId, categoryAId, 'B-LIST')

    await withTenant(tenantAId, async (db) =>
      assignLotToVendorInTenant(db, tenantAId, { lotId: lot.id, vendorId: vendor.id }, userId),
    )

    const rows = await withTenant(tenantAId, async (db) =>
      listAssignedLotsInTenant(db, { eventId: eventAId }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      lotId: lot.id,
      lotCode: 'B-LIST',
      vendorId: vendor.id,
      vendorLegalName: 'Outra Aprovada LTDA',
      vendorStatus: 'approved',
    })
  })
})

describe('lot_assignments — guards', () => {
  test('vendor.status=pending rejects with descriptive error', async () => {
    const vendor = await makeVendor(tenantAId, { status: 'pending' })
    const lot = await makeLotForTenant(tenantAId, eventAId, categoryAId)

    await expect(
      withTenant(tenantAId, async (db) =>
        assignLotToVendorInTenant(
          db,
          tenantAId,
          { lotId: lot.id, vendorId: vendor.id },
          userId,
        ),
      ),
    ).rejects.toThrow(/aprovado/i)

    // No row, no audit.
    const found = await migratorPool<Array<{ id: string }>>`
      SELECT id FROM lot_assignments WHERE lot_id = ${lot.id}
    `
    expect(found).toHaveLength(0)
  })

  test('vendor.status=rejected rejects with descriptive error', async () => {
    const vendor = await makeVendor(tenantAId, {
      status: 'rejected',
      approvalReason: 'Docs incompletos',
    })
    const lot = await makeLotForTenant(tenantAId, eventAId, categoryAId)

    await expect(
      withTenant(tenantAId, async (db) =>
        assignLotToVendorInTenant(
          db,
          tenantAId,
          { lotId: lot.id, vendorId: vendor.id },
          userId,
        ),
      ),
    ).rejects.toThrow(/aprovado/i)
  })

  test('double-assign on the same lot rejects on partial UNIQUE', async () => {
    const vendor1 = await makeVendor(tenantAId, { status: 'approved' })
    const vendor2 = await makeVendor(tenantAId, { status: 'approved' })
    const lot = await makeLotForTenant(tenantAId, eventAId, categoryAId)

    await withTenant(tenantAId, async (db) =>
      assignLotToVendorInTenant(db, tenantAId, { lotId: lot.id, vendorId: vendor1.id }, userId),
    )

    await expect(
      withTenant(tenantAId, async (db) =>
        assignLotToVendorInTenant(
          db,
          tenantAId,
          { lotId: lot.id, vendorId: vendor2.id },
          userId,
        ),
      ),
    ).rejects.toThrow(/já está atribuído/i)
  })

  test('tenant B cannot assign tenant A\'s lot (RLS lot lookup → 0 rows)', async () => {
    const vendorB = await makeVendor(tenantBId, { status: 'approved' })
    const lotA = await makeLotForTenant(tenantAId, eventAId, categoryAId)

    await expect(
      withTenant(tenantBId, async (db) =>
        assignLotToVendorInTenant(
          db,
          tenantBId,
          { lotId: lotA.id, vendorId: vendorB.id },
          userId,
        ),
      ),
    ).rejects.toThrow(/(vendor|lote|fornecedor).*(não encontrado|inacessível)/i)

    // Confirm no cross-tenant row was inserted under either tenant.
    const cross = await migratorPool<Array<{ id: string }>>`
      SELECT id FROM lot_assignments WHERE lot_id = ${lotA.id}
    `
    expect(cross).toHaveLength(0)
  })
})

describe('lot_assignments — unassign flow', () => {
  test('unassign soft-deletes the assignment + reassign on same lot succeeds', async () => {
    const vendor1 = await makeVendor(tenantAId, { status: 'approved' })
    const vendor2 = await makeVendor(tenantAId, { status: 'approved' })
    const lot = await makeLotForTenant(tenantAId, eventAId, categoryAId)

    const first = await withTenant(tenantAId, async (db) =>
      assignLotToVendorInTenant(db, tenantAId, { lotId: lot.id, vendorId: vendor1.id }, userId),
    )

    const ok = await withTenant(tenantAId, async (db) =>
      unassignLotInTenant(db, { lotId: lot.id }, userId),
    )
    expect(ok).toBe(true)

    // Soft-delete stamped deleted_at on the old row.
    const oldRows = await migratorPool<Array<{ deleted_at: Date | null }>>`
      SELECT deleted_at FROM lot_assignments WHERE id = ${first.id}
    `
    expect(oldRows[0]?.deleted_at).not.toBeNull()

    // Second assign now unblocked.
    const second = await withTenant(tenantAId, async (db) =>
      assignLotToVendorInTenant(db, tenantAId, { lotId: lot.id, vendorId: vendor2.id }, userId),
    )
    expect(second.id).not.toBe(first.id)
    expect(second.vendorId).toBe(vendor2.id)

    // Audit captured both create + delete (audit_log FORCE RLS — use appPool with SET LOCAL).
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE entity = 'lot_assignment'
        ORDER BY created_at ASC
      `
    })
    const actions = audits.map((a) => a.action)
    expect(actions).toContain('lot_assignment.created')
    expect(actions).toContain('lot_assignment.deleted')
  })
})
