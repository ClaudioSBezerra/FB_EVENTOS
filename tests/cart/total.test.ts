// FB_EVENTOS — FORN-08: cart total math (Plan 02-05, Task 2).
//
// Tests:
//   1. Cart with no add-ons → total = lot price only (centavos).
//   2. Cart with one add-on (qty=2) → total = lot price + 2 × snapshot price.
//   3. Cart with multiple add-ons → total = lot price + Σ(qty × snapshot price).
//   4. Snapshot price (not current addon price) used after addon price change.
//   5. addAddonToCart honors max_qty — exceeding throws.
//   6. removeAddonFromCart removes line; total adjusts.
//
// Uses real Postgres via withTenant (RLS-enforced).

import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { cartAddonLines } from '@/db/schema/cart_addon_lines'
import { withTenant } from '@/db/with-tenant'
import {
  addAddonToCartInTenant,
  computeCartTotalInTenant,
  removeAddonFromCartInTenant,
} from '@/lib/actions/cart'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────────

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ────────────────────────────────────────────────────────────────────────────

async function makeAddon(
  tenantId: string,
  eventId: string,
  opts: { priceBrlCents: number; maxQty?: number; name?: string },
) {
  // event_addons uses FORCE RLS — must SET LOCAL via appPool, not migratorPool.
  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<Array<{ id: string; price_brl_cents: number; max_qty: number }>>`
      INSERT INTO event_addons (tenant_id, event_id, name, price_brl_cents, max_qty)
      VALUES (${tenantId}, ${eventId}, ${opts.name ?? 'Test Addon'}, ${opts.priceBrlCents}, ${opts.maxQty ?? 99})
      RETURNING id, price_brl_cents, max_qty
    `
  })
  return rows[0]!
}

async function makeReservation(
  tenantId: string,
  lotId: string,
  vendorId: string,
  eventId: string,
  opts: { expiresInMinutes?: number } = {},
) {
  const expiresInMinutes = opts.expiresInMinutes ?? 15
  // lot_reservations uses FORCE RLS — must SET LOCAL via appPool, not migratorPool.
  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<Array<{ id: string }>>`
      INSERT INTO lot_reservations (tenant_id, lot_id, vendor_id, event_id, expires_at)
      VALUES (
        ${tenantId}, ${lotId}, ${vendorId}, ${eventId},
        NOW() + (${String(expiresInMinutes)} || ' minutes')::interval
      )
      RETURNING id
    `
  })
  return rows[0]!.id
}

interface CartFixture {
  tenantId: string
  vendorId: string
  lotId: string
  eventId: string
  reservationId: string
  /** Lot base price in centavos (category: base_fixed=1000 BRL, per_sqm=0) */
  lotBrlCents: number
}

async function setupCartFixture(prefix: string): Promise<CartFixture> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Cart Test ${prefix}`)
  await insertUser(`cart-u-${stamp}@example.test`, `Cart User ${prefix}`)
  await insertOrganization(tenantId, `${stamp}-org`, `Cart Org ${prefix}`)
  const ev = await makeEvent(tenantId)
  // Category: base_fixed=1000 (R$1000), per_sqm_rate=0, area=1 → price = R$1000 = 100000 cents
  const cat = await makeLotCategory(tenantId, ev.id, { baseFixed: 1000, perSqmRate: 0 })
  const lot = await makeLot(tenantId, ev.id, cat.id, { areaM2: 1 })
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  const reservationId = await makeReservation(tenantId, lot.id, vendor.id, ev.id)
  return {
    tenantId,
    vendorId: vendor.id,
    lotId: lot.id,
    eventId: ev.id,
    reservationId,
    lotBrlCents: 100_000, // R$1000 × 100 = 100000 cents
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('FORN-08: computeCartTotal — lot price only', () => {
  test('cart with no add-ons → total = lot price (100000 cents = R$1000)', async () => {
    const fx = await setupCartFixture('no-addons')

    const totals = await withTenant(fx.tenantId, async (db) => {
      return computeCartTotalInTenant(db, fx.tenantId, fx.reservationId)
    })

    expect(totals.lot_brl_cents).toBe(100_000)
    expect(totals.addons_brl_cents).toBe(0)
    expect(totals.total_brl_cents).toBe(100_000)
  })
})

describe('FORN-08: computeCartTotal — with add-ons', () => {
  test('one add-on (price=R$200, qty=2) → total = R$1000 lot + R$400 addons = R$1400', async () => {
    const fx = await setupCartFixture('one-addon')
    const addon = await makeAddon(fx.tenantId, fx.eventId, { priceBrlCents: 20_000, maxQty: 10 })

    await withTenant(fx.tenantId, async (db) => {
      await addAddonToCartInTenant(db, fx.tenantId, {
        reservationId: fx.reservationId,
        addonId: addon.id,
        quantity: 2,
        vendorId: fx.vendorId,
      })
    })

    const totals = await withTenant(fx.tenantId, async (db) => {
      return computeCartTotalInTenant(db, fx.tenantId, fx.reservationId)
    })

    expect(totals.lot_brl_cents).toBe(100_000)
    expect(totals.addons_brl_cents).toBe(40_000) // 2 × 20000
    expect(totals.total_brl_cents).toBe(140_000)
  })

  test('R$1000 lot + R$200 addon + R$80 addon = R$1280 total (128000 cents)', async () => {
    const fx = await setupCartFixture('multi-addons')
    const addon1 = await makeAddon(fx.tenantId, fx.eventId, {
      priceBrlCents: 20_000,
      name: 'Addon A',
      maxQty: 5,
    })
    const addon2 = await makeAddon(fx.tenantId, fx.eventId, {
      priceBrlCents: 8_000,
      name: 'Addon B',
      maxQty: 5,
    })

    await withTenant(fx.tenantId, async (db) => {
      await addAddonToCartInTenant(db, fx.tenantId, {
        reservationId: fx.reservationId,
        addonId: addon1.id,
        quantity: 1,
        vendorId: fx.vendorId,
      })
      await addAddonToCartInTenant(db, fx.tenantId, {
        reservationId: fx.reservationId,
        addonId: addon2.id,
        quantity: 1,
        vendorId: fx.vendorId,
      })
    })

    const totals = await withTenant(fx.tenantId, async (db) => {
      return computeCartTotalInTenant(db, fx.tenantId, fx.reservationId)
    })

    expect(totals.lot_brl_cents).toBe(100_000)
    expect(totals.addons_brl_cents).toBe(28_000) // 20000 + 8000
    expect(totals.total_brl_cents).toBe(128_000)
  })
})

describe('FORN-08: cart add-on snapshot price', () => {
  test('snapshot price (not current addon price) used after addon price change', async () => {
    const fx = await setupCartFixture('snapshot')
    const addon = await makeAddon(fx.tenantId, fx.eventId, { priceBrlCents: 20_000, maxQty: 5 })

    // Add to cart at R$200 (original price).
    await withTenant(fx.tenantId, async (db) => {
      await addAddonToCartInTenant(db, fx.tenantId, {
        reservationId: fx.reservationId,
        addonId: addon.id,
        quantity: 1,
        vendorId: fx.vendorId,
      })
    })

    // Simulate price change AFTER the item was added to cart.
    await migratorPool`
      UPDATE event_addons SET price_brl_cents = 50000 WHERE id = ${addon.id}
    `

    // Total should STILL reflect the snapshot price (R$200), not the new price (R$500).
    const totals = await withTenant(fx.tenantId, async (db) => {
      return computeCartTotalInTenant(db, fx.tenantId, fx.reservationId)
    })

    expect(totals.addons_brl_cents).toBe(20_000) // snapshot R$200, not new R$500
    expect(totals.total_brl_cents).toBe(120_000) // R$1000 lot + R$200 snapshot addon
  })
})

describe('FORN-08: addAddonToCart max_qty guard', () => {
  test('exceeding max_qty throws with a readable message', async () => {
    const fx = await setupCartFixture('max-qty')
    const addon = await makeAddon(fx.tenantId, fx.eventId, { priceBrlCents: 10_000, maxQty: 2 })

    // Add exactly 2 (at max).
    await withTenant(fx.tenantId, async (db) => {
      await addAddonToCartInTenant(db, fx.tenantId, {
        reservationId: fx.reservationId,
        addonId: addon.id,
        quantity: 2,
        vendorId: fx.vendorId,
      })
    })

    // Try to add 1 more (3 total > max_qty=2).
    await expect(
      withTenant(fx.tenantId, async (db) => {
        await addAddonToCartInTenant(db, fx.tenantId, {
          reservationId: fx.reservationId,
          addonId: addon.id,
          quantity: 1,
          vendorId: fx.vendorId,
        })
      }),
    ).rejects.toThrow(/quantidade máxima/i)
  })
})

describe('FORN-08: removeAddonFromCart', () => {
  test('removes a specific cart line; total adjusts accordingly', async () => {
    const fx = await setupCartFixture('remove-addon')
    const addon = await makeAddon(fx.tenantId, fx.eventId, { priceBrlCents: 10_000, maxQty: 5 })

    let lineId!: string
    await withTenant(fx.tenantId, async (db) => {
      const line = await addAddonToCartInTenant(db, fx.tenantId, {
        reservationId: fx.reservationId,
        addonId: addon.id,
        quantity: 2,
        vendorId: fx.vendorId,
      })
      lineId = line.id
    })

    await withTenant(fx.tenantId, async (db) => {
      await removeAddonFromCartInTenant(db, fx.tenantId, {
        reservationId: fx.reservationId,
        cartAddonLineId: lineId,
        vendorId: fx.vendorId,
      })
    })

    // Line should be gone.
    const remaining = await withTenant(fx.tenantId, async (db) => {
      return db.select().from(cartAddonLines).where(eq(cartAddonLines.id, lineId))
    })
    expect(remaining).toHaveLength(0)

    // Total = lot only.
    const totals = await withTenant(fx.tenantId, async (db) => {
      return computeCartTotalInTenant(db, fx.tenantId, fx.reservationId)
    })
    expect(totals.addons_brl_cents).toBe(0)
    expect(totals.total_brl_cents).toBe(100_000)
  })
})
