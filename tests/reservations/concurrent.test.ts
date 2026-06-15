// FB_EVENTOS — FORN-05: 50-concurrent reservation race (Plan 02-03 Task 1).
// LOAD-BEARING: this test is the FORN-05 invariant guard.
// Advisory lock + partial-unique index enforce exactly 1 winner.

import { afterEach, describe, expect, it } from 'vitest'
import { withTenant } from '@/db/with-tenant'
import { reserveLotInTenant } from '@/lib/actions/reservations'
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

describe('FORN-05: concurrent reservation race (load-bearing)', () => {
  it('50 concurrent reserveLotInTenant: exactly 1 winner, 49 × conflict error', async () => {
    const tenantId = await createTenant('tenant-concurrent', 'Concurrent Test Org')
    const event = await makeEvent(tenantId)
    const category = await makeLotCategory(tenantId, event.id)
    const lot = await makeLot(tenantId, event.id, category.id, { status: 'available' })

    // Create 50 vendors — each tries to grab the same lot
    const vendors = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        makeVendor(tenantId, {
          status: 'approved',
          email: `vendor-race-${i}-${Date.now()}@example.com`,
          // Use unique CNPJs to avoid CNPJ unique constraint
          cnpj: String(10000000000000 + i).padStart(14, '0'),
        }),
      ),
    )

    // Fire all 50 concurrently — each in its OWN withTenant transaction
    // so advisory locks are transaction-scoped (one connection per call)
    const results = await Promise.allSettled(
      vendors.map((vendor) =>
        withTenant(tenantId, async (db) => {
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
        }),
      ),
    )

    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    // Load-bearing: exactly 1 winner
    expect(successes).toHaveLength(1)
    // The other 49 must have received a typed error
    expect(failures).toHaveLength(49)

    // Exactly 1 active reservation row in the DB
    const activeRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM lot_reservations
      WHERE lot_id = ${lot.id} AND released_at IS NULL
    `
    expect(activeRows[0]?.n).toBe(1)

    // Exactly 1 lot.reserved outbox event
    const outboxRows = await migratorPool<{ n: number }[]>`
      SELECT count(*)::int AS n FROM outbox_events
      WHERE aggregate_id = ${lot.id} AND event_type = 'lot.reserved'
    `
    expect(outboxRows[0]?.n).toBe(1)

    // Each failure must contain the expected message
    for (const f of failures) {
      expect(f.status).toBe('rejected')
      if (f.status === 'rejected') {
        const msg = String((f.reason as Error).message)
        expect(msg).toMatch(/reservado|indispon/i)
      }
    }
  }, 30_000) // 30s timeout for 50-way concurrent race
})
