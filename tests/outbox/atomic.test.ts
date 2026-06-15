// FB_EVENTOS — FORN-13: outbox + business write atomicity (Plan 02-03 Task 1).
//
// Proves: if EITHER the lot_reservations INSERT or the outbox_events INSERT
// fails, BOTH rows are absent from the DB (same Postgres transaction).

import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { withTenant } from '@/db/with-tenant'
import { reserveLotInTenant } from '@/lib/actions/reservations'
import { emitOutboxEvent } from '@/lib/outbox/emit'
import { createTenant, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

afterEach(async () => {
  await migratorPool`TRUNCATE TABLE
    outbox_events, lot_reservations, lot_assignments, lots, lot_categories,
    vendors, events
    RESTART IDENTITY CASCADE`
})

describe('FORN-13: outbox + business write atomicity', () => {
  it('lot_reservations INSERT + outbox_events INSERT in same tx → rollback ⇒ neither persists', async () => {
    const tenantId = await createTenant('tenant-atomic-rollback', 'Atomic Test Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    const SENTINEL_ERROR = new Error('forced rollback sentinel')

    await expect(
      withTenant(tenantId, async (db) => {
        // Insert a lot_reservation
        await db.execute(sql`
          INSERT INTO lot_reservations (tenant_id, lot_id, vendor_id, event_id, expires_at)
          VALUES (
            current_setting('app.current_tenant_id', true)::uuid,
            ${lot.id}::uuid,
            ${vendor.id}::uuid,
            ${event.id}::uuid,
            now() + interval '15 minutes'
          )
        `)

        // Insert an outbox event
        await emitOutboxEvent(db, 'lot.reserved', lot.id, {
          reservation_id: 'test',
          vendor_id: vendor.id,
          event_id: event.id,
        })

        // Force rollback
        throw SENTINEL_ERROR
      }),
    ).rejects.toBe(SENTINEL_ERROR)

    // Both tables must be empty — atomicity proven
    const reservationRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM lot_reservations WHERE lot_id = ${lot.id}
    `
    expect(reservationRows[0]?.n).toBe(0)

    const outboxRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${lot.id}
    `
    expect(outboxRows[0]?.n).toBe(0)
  })

  it('successful tx → both rows visible after commit', async () => {
    const tenantId = await createTenant('tenant-atomic-commit', 'Atomic Commit Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    await withTenant(tenantId, async (db) => {
      await db.execute(sql`
        INSERT INTO lot_reservations (tenant_id, lot_id, vendor_id, event_id, expires_at)
        VALUES (
          current_setting('app.current_tenant_id', true)::uuid,
          ${lot.id}::uuid,
          ${vendor.id}::uuid,
          ${event.id}::uuid,
          now() + interval '15 minutes'
        )
      `)
      await emitOutboxEvent(db, 'lot.reserved', lot.id, { test: true })
    })

    const reservationRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM lot_reservations WHERE lot_id = ${lot.id}
    `
    expect(reservationRows[0]?.n).toBe(1)

    const outboxRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${lot.id} AND event_type = 'lot.reserved'
    `
    expect(outboxRows[0]?.n).toBe(1)
  })

  it('outbox INSERT failure (invalid event_type) rolls back business write', async () => {
    const tenantId = await createTenant('tenant-atomic-fail', 'Atomic Fail Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    await expect(
      withTenant(tenantId, async (db) => {
        // Insert the reservation
        await db.execute(sql`
          INSERT INTO lot_reservations (tenant_id, lot_id, vendor_id, event_id, expires_at)
          VALUES (
            current_setting('app.current_tenant_id', true)::uuid,
            ${lot.id}::uuid,
            ${vendor.id}::uuid,
            ${event.id}::uuid,
            now() + interval '15 minutes'
          )
        `)
        // Insert an outbox event with INVALID event_type — violates CHECK constraint in migration 0018
        await db.execute(sql`
          INSERT INTO outbox_events (tenant_id, event_type, aggregate_id, payload)
          VALUES (
            current_setting('app.current_tenant_id', true)::uuid,
            'invalid.event.type.not.in.check.constraint',
            ${lot.id}::uuid,
            '{}'::jsonb
          )
        `)
      }),
    ).rejects.toThrow()

    // Business write must be rolled back too
    const reservationRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM lot_reservations WHERE lot_id = ${lot.id}
    `
    expect(reservationRows[0]?.n).toBe(0)
  })

  it('reserveLotInTenant atomicity: via the real action', async () => {
    const tenantId = await createTenant('tenant-atomic-action', 'Atomic Action Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
    const vendor = await makeVendor(tenantId, { status: 'approved' })

    const result = await withTenant(tenantId, async (db) => {
      return reserveLotInTenant(
        db,
        tenantId,
        {
          eventId: event.id,
          lotId: lot.id,
          vendorId: vendor.id,
        },
        vendor.id,
      )
    })

    // Both rows exist after success
    const [resRows, outboxRows] = await Promise.all([
      migratorPool<{ n: number }[]>`
        SELECT count(*)::int AS n FROM lot_reservations WHERE id = ${result.reservation_id}
      `,
      migratorPool<{ n: number }[]>`
        SELECT count(*)::int AS n FROM outbox_events
        WHERE aggregate_id = ${lot.id} AND event_type = 'lot.reserved'
      `,
    ])
    expect(resRows[0]?.n).toBe(1)
    expect(outboxRows[0]?.n).toBe(1)
  })
})
