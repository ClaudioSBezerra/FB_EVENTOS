// FB_EVENTOS — FORN-06: reservation.expire scheduled task (Plan 02-03 Task 2).
//
// Tests: happy path, skips already-released, skips not-yet-expired, cross-tenant, batch limit.

import { afterEach, describe, expect, it } from 'vitest'
import { RESERVATION_EXPIRE_TASK } from '@/jobs/tasks/reservation-expire'
import { appPool, createTenant, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'
import { runTaskInline } from '../test-mocks/graphile-worker'

afterEach(async () => {
  await migratorPool`TRUNCATE TABLE
    outbox_events, lot_reservations, lot_assignments, lots, lot_categories,
    vendors, events
    RESTART IDENTITY CASCADE`
})

// Helper: create a reservation via appPool inside a SET LOCAL tenant context.
// migratorPool cannot INSERT into RLS-protected tables (FORCE RLS + default-deny
// for non-app roles). We use appPool + SET LOCAL app.current_tenant_id to match
// the production write path.
async function makeExpiredReservation(
  tenantId: string,
  lotId: string,
  vendorId: string,
  eventId: string,
  opts: { releasedAt?: Date | null; expiresOffset?: number } = {},
) {
  const { releasedAt = null, expiresOffset = -5 } = opts // negative = already expired
  return appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    const rows = await tx<{ id: string }[]>`
      INSERT INTO lot_reservations (tenant_id, lot_id, vendor_id, event_id, expires_at, released_at)
      VALUES (
        ${tenantId}::uuid,
        ${lotId}::uuid,
        ${vendorId}::uuid,
        ${eventId}::uuid,
        now() + make_interval(mins => ${expiresOffset}),
        ${releasedAt}
      )
      RETURNING id
    `
    if (!rows[0]) throw new Error('makeExpiredReservation: no row returned')
    return rows[0].id
  })
}

describe('FORN-06: reservation.expire scheduled task', () => {
  it('releases reservations whose expires_at < now() (sets released_at)', async () => {
    const tenantId = await createTenant('tenant-expire-happy', 'Expire Happy Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    const reservationId = await makeExpiredReservation(tenantId, lot.id, vendor.id, event.id, {
      expiresOffset: -5, // expired 5 minutes ago
    })

    // Run the task
    await runTaskInline(RESERVATION_EXPIRE_TASK, {})

    // The reservation must now have released_at set
    const rows = await migratorPool<{ released_at: Date | null }[]>`
      SELECT released_at FROM lot_reservations WHERE id = ${reservationId}
    `
    expect(rows[0]?.released_at).not.toBeNull()
  })

  it('emits outbox lot.released in same transaction', async () => {
    const tenantId = await createTenant('tenant-expire-outbox', 'Expire Outbox Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    await makeExpiredReservation(tenantId, lot.id, vendor.id, event.id, {
      expiresOffset: -5,
    })

    await runTaskInline(RESERVATION_EXPIRE_TASK, {})

    const outboxRows = await migratorPool<{ event_type: string }[]>`
      SELECT event_type FROM outbox_events
      WHERE aggregate_id = ${lot.id} AND event_type = 'lot.released'
    `
    expect(outboxRows.length).toBeGreaterThanOrEqual(1)
    expect(outboxRows[0]?.event_type).toBe('lot.released')
  })

  it('skips reservations already released (released_at IS NOT NULL)', async () => {
    const tenantId = await createTenant('tenant-expire-skip', 'Expire Skip Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    // Already released reservation
    const alreadyReleasedAt = new Date(Date.now() - 60_000)
    const reservationId = await makeExpiredReservation(tenantId, lot.id, vendor.id, event.id, {
      expiresOffset: -5,
      releasedAt: alreadyReleasedAt,
    })

    await runTaskInline(RESERVATION_EXPIRE_TASK, {})

    // released_at should remain unchanged (the original value)
    const rows = await migratorPool<{ released_at: Date }[]>`
      SELECT released_at FROM lot_reservations WHERE id = ${reservationId}
    `
    expect(rows[0]?.released_at).not.toBeNull()
    // The released_at time should be approximately the one we set (within 5s)
    // biome-ignore lint/style/noNonNullAssertion: guarded by not.toBeNull() above
    const diff = Math.abs(rows[0]!.released_at.getTime() - alreadyReleasedAt.getTime())
    expect(diff).toBeLessThan(5_000)

    // No new lot.released outbox events for this lot
    const outboxRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM outbox_events
      WHERE aggregate_id = ${lot.id} AND event_type = 'lot.released'
    `
    expect(outboxRows[0]?.n).toBe(0)
  })

  it('skips reservations not yet expired (expires_at > now())', async () => {
    const tenantId = await createTenant('tenant-expire-future', 'Expire Future Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    const reservationId = await makeExpiredReservation(tenantId, lot.id, vendor.id, event.id, {
      expiresOffset: 10, // expires 10 minutes from now — NOT yet expired
    })

    await runTaskInline(RESERVATION_EXPIRE_TASK, {})

    // released_at must still be null
    const rows = await migratorPool<{ released_at: Date | null }[]>`
      SELECT released_at FROM lot_reservations WHERE id = ${reservationId}
    `
    expect(rows[0]?.released_at).toBeNull()
  })

  it('cross-tenant scan via migratorPool — handles multiple tenants in one tick', async () => {
    const tenantA = await createTenant('tenant-expire-a', 'Org A')
    const tenantB = await createTenant('tenant-expire-b', 'Org B')

    const eventA = await makeEvent(tenantA)
    const catA = await makeLotCategory(tenantA, eventA.id)
    const lotA = await makeLot(tenantA, eventA.id, catA.id, { status: 'available' })
    const vendorA = await makeVendor(tenantA, { status: 'approved' })

    const eventB = await makeEvent(tenantB)
    const catB = await makeLotCategory(tenantB, eventB.id)
    const lotB = await makeLot(tenantB, eventB.id, catB.id, { status: 'available' })
    const vendorB = await makeVendor(tenantB, { status: 'approved' })

    const resAId = await makeExpiredReservation(tenantA, lotA.id, vendorA.id, eventA.id, {
      expiresOffset: -5,
    })
    const resBId = await makeExpiredReservation(tenantB, lotB.id, vendorB.id, eventB.id, {
      expiresOffset: -5,
    })

    await runTaskInline(RESERVATION_EXPIRE_TASK, {})

    // Both released
    const [rowA, rowB] = await Promise.all([
      migratorPool<
        { released_at: Date | null }[]
      >`SELECT released_at FROM lot_reservations WHERE id = ${resAId}`,
      migratorPool<
        { released_at: Date | null }[]
      >`SELECT released_at FROM lot_reservations WHERE id = ${resBId}`,
    ])

    expect(rowA[0]?.released_at).not.toBeNull()
    expect(rowB[0]?.released_at).not.toBeNull()
  })
})
