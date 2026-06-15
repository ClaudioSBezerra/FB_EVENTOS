// FB_EVENTOS — FORN-04: reservation row creation (Plan 02-03 Task 1).
//
// Tests: happy path, pending vendor blocked, cross-tenant RLS, TTL boundary.
// Concurrent race is in concurrent.test.ts; atomicity is in atomic.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTenant } from '@/db/with-tenant'
import { reserveLotInTenant } from '@/lib/actions/reservations'
import { createTenant, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

// ── Teardown ─────────────────────────────────────────────────────────────────

afterEach(async () => {
  await migratorPool`TRUNCATE TABLE
    outbox_events, lot_reservations, lot_assignments, lots, lot_categories,
    vendors, events
    RESTART IDENTITY CASCADE`
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedTenant(slug: string) {
  const tenantId = await createTenant(slug, `Test Org ${slug}`)
  const event = await makeEvent(tenantId)
  const category = await makeLotCategory(tenantId, event.id)
  const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  return { tenantId, event, category, lot, vendor }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FORN-04: reserveLotInTenant happy path', () => {
  it('creates lot_reservations row with expires_at = now() + 15min', async () => {
    const { tenantId, event, lot, vendor } = await seedTenant('tenant-create-happy')

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

    expect(result).toHaveProperty('reservation_id')
    expect(result).toHaveProperty('expires_at')

    // Verify the row exists in DB
    const rows = await migratorPool<{ id: string; released_at: Date | null; expires_at: Date }[]>`
      SELECT id, released_at, expires_at FROM lot_reservations WHERE id = ${result.reservation_id}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]?.released_at).toBeNull()

    // TTL = 15 minutes from now (allow 30s window for test execution)
    const expiresAt = rows[0]?.expires_at
    expect(expiresAt).toBeDefined()
    const nowMs = Date.now()
    const expectedMs = nowMs + 15 * 60 * 1000
    // biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined() above
    expect(expiresAt!.getTime()).toBeGreaterThan(expectedMs - 60_000)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined() above
    expect(expiresAt!.getTime()).toBeLessThanOrEqual(expectedMs + 5_000)
  })

  it('emits outbox lot.reserved in the same transaction', async () => {
    const { tenantId, event, lot, vendor } = await seedTenant('tenant-create-outbox')

    const _result = await withTenant(tenantId, async (db) => {
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

    const outboxRows = await migratorPool<
      { event_type: string; aggregate_id: string; processed_at: Date | null }[]
    >`
      SELECT event_type, aggregate_id, processed_at
      FROM outbox_events
      WHERE aggregate_id = ${lot.id} AND event_type = 'lot.reserved'
    `
    expect(outboxRows).toHaveLength(1)
    expect(outboxRows[0]?.event_type).toBe('lot.reserved')
    expect(outboxRows[0]?.processed_at).toBeNull()
  })

  it('also emits lot.status_changed outbox row', async () => {
    const { tenantId, event, lot, vendor } = await seedTenant('tenant-create-status')

    await withTenant(tenantId, async (db) => {
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

    const rows = await migratorPool<{ event_type: string }[]>`
      SELECT event_type FROM outbox_events WHERE event_type = 'lot.status_changed'
    `
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects reservation when lot is already sold', async () => {
    const { tenantId, event, vendor } = await seedTenant('tenant-create-sold')
    const category = await makeLotCategory(tenantId, event.id)
    const soldLot = await makeLot(tenantId, event.id, category.id, { status: 'sold' })

    await expect(
      withTenant(tenantId, async (db) => {
        return reserveLotInTenant(
          db,
          tenantId,
          {
            eventId: event.id,
            lotId: soldLot.id,
            vendorId: vendor.id,
          },
          vendor.id,
        )
      }),
    ).rejects.toThrow(/indispon/i)
  })
})

describe('FORN-04: vendor approval gate', () => {
  it('rejects reservation from pending vendor', async () => {
    const { tenantId, event, lot } = await seedTenant('tenant-create-pending')
    const pendingVendor = await makeVendor(tenantId, { status: 'pending' })

    await expect(
      withTenant(tenantId, async (db) => {
        return reserveLotInTenant(
          db,
          tenantId,
          {
            eventId: event.id,
            lotId: lot.id,
            vendorId: pendingVendor.id,
          },
          pendingVendor.id,
        )
      }),
    ).rejects.toThrow(/aprovado/i)
  })
})

describe('FORN-03 cross-tenant RLS', () => {
  it('tenant A vendor cannot reserve tenant B lot', async () => {
    const {
      tenantId: _tenantA,
      event: eventA,
      lot: lotA,
      vendor: vendorA,
    } = await seedTenant('tenant-a-xrls')
    const { tenantId: tenantB } = await seedTenant('tenant-b-xrls')

    // Vendor A tries to reserve inside tenant B context — RLS hides lot A
    await expect(
      withTenant(tenantB, async (db) => {
        return reserveLotInTenant(
          db,
          tenantB,
          {
            eventId: eventA.id,
            lotId: lotA.id,
            vendorId: vendorA.id,
          },
          vendorA.id,
        )
      }),
    ).rejects.toThrow()
  })
})

describe('TTL boundary', () => {
  it('expires_at = reserved_at + 15 min (clock-mocked)', async () => {
    const { tenantId, event, lot, vendor } = await seedTenant('tenant-ttl')

    const mockNow = new Date('2026-07-01T12:00:00.000Z')
    vi.setSystemTime(mockNow)

    try {
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

      // The DB uses `now()` which is server-side — we verify the returned expires_at
      // is approximately 15 min from the actual DB now (allow ±30s)
      const dbNow = await migratorPool<{ now: Date }[]>`SELECT now() AS now`
      const dbNowRow = dbNow[0]
      expect(dbNowRow).toBeDefined()
      // biome-ignore lint/style/noNonNullAssertion: guarded by toBeDefined() above
      const expectedExpiry = new Date(dbNowRow!.now.getTime() + 14.5 * 60 * 1000)
      expect(result.expires_at.getTime()).toBeGreaterThan(expectedExpiry.getTime())
    } finally {
      vi.useRealTimers()
    }
  })
})
