// FB_EVENTOS — FORN-09: Pagar.me PIX + credit_card checkout paths (Plan 02-05, Task 3).
//
// Tests:
//   1. PIX path: startCheckout(method="pix") → qr_code + qr_code_url in result.
//   2. PIX path: payments row status='pending' + gateway_charge_id set.
//   3. credit_card (installments=1): installment_amount_brl_cents = total.
//   4. credit_card (installments=6): installment_amount computed (tabela Price).
//   5. credit_card (installments=12): installment_amount computed.
//   6. With add-ons: total includes snapshot price sum.
//   7. Boleto method rejected (AM-01: not in the enum).
//
// Uses MSW to mock Pagar.me API (no real HTTP calls).
// Uses real Postgres via withTenant for DB assertions.

import { eq } from 'drizzle-orm'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { pool } from '@/db'
import { payments } from '@/db/schema/payments'
import { withTenant } from '@/db/with-tenant'
import { checkoutCartInTenant } from '@/lib/actions/checkout'
import { computeInstallmentAmount } from '@/lib/pagarme/installments-shape.generated'
import { checkoutCartSchema } from '@/lib/validators/checkout'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { makeContract } from '@/test/factories/contract-factory'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'
import { createPagarmeMswHandlers } from '../test-mocks/pagarme'

// ────────────────────────────────────────────────────────────────────────────
// MSW server — intercepts Pagar.me API calls
// ────────────────────────────────────────────────────────────────────────────

const server = setupServer(...createPagarmeMswHandlers())
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(async () => {
  server.close()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ────────────────────────────────────────────────────────────────────────────

interface CheckoutFixture {
  tenantId: string
  vendorId: string
  reservationId: string
  lotCents: number
}

async function makeReservation(
  tenantId: string,
  lotId: string,
  vendorId: string,
  eventId: string,
): Promise<string> {
  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<Array<{ id: string }>>`
      INSERT INTO lot_reservations (tenant_id, lot_id, vendor_id, event_id, expires_at)
      VALUES (${tenantId}, ${lotId}, ${vendorId}, ${eventId}, NOW() + INTERVAL '15 minutes')
      RETURNING id
    `
  })
  return rows[0]!.id
}

async function setupCheckoutFixture(prefix: string): Promise<CheckoutFixture> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Checkout Test ${prefix}`)
  await insertUser(`co-u-${stamp}@example.test`, `Checkout User ${prefix}`)
  await insertOrganization(tenantId, `${stamp}-org`, `Checkout Org ${prefix}`)
  const ev = await makeEvent(tenantId)
  // Category: base_fixed=500 (R$500), per_sqm_rate=0 → price = R$500 = 50000 cents
  const cat = await makeLotCategory(tenantId, ev.id, { baseFixed: 500, perSqmRate: 0 })
  const lot = await makeLot(tenantId, ev.id, cat.id, { areaM2: 1 })
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  // Phase 2 checkout requires a signed contract for the lot+vendor.
  await makeContract(tenantId, vendor.id, lot.id, ev.id, { status: 'signed' })
  const reservationId = await makeReservation(tenantId, lot.id, vendor.id, ev.id)
  return {
    tenantId,
    vendorId: vendor.id,
    reservationId,
    lotCents: 50_000, // R$500 × 100
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FORN-09: PIX path
// ────────────────────────────────────────────────────────────────────────────

describe('FORN-09: checkout — PIX', () => {
  test('PIX path returns qr_code + qr_code_url', async () => {
    const fx = await setupCheckoutFixture('pix-qr')

    const result = await withTenant(fx.tenantId, async (db) => {
      return checkoutCartInTenant(
        db,
        fx.tenantId,
        { reservationId: fx.reservationId, method: 'pix' },
        fx.vendorId,
        fx.vendorId,
      )
    })

    expect(result.pix_copy_paste).toBeTruthy()
    expect(result.pix_qr_url).toBeTruthy()
    expect(result.pix_expires_at).toBeTruthy()
    expect(result.installment_amount_brl_cents).toBeNull()
    expect(result.installments).toBeNull()
  })

  test('PIX path stores payment row with status="pending" + gateway_charge_id', async () => {
    const fx = await setupCheckoutFixture('pix-db')

    const result = await withTenant(fx.tenantId, async (db) => {
      return checkoutCartInTenant(
        db,
        fx.tenantId,
        { reservationId: fx.reservationId, method: 'pix' },
        fx.vendorId,
        fx.vendorId,
      )
    })

    expect(result.payment.status).toBe('pending')
    expect(result.payment.method).toBe('pix')
    expect(result.payment.gatewayChargeId).toBeTruthy()
    expect(result.payment.gatewayOrderId).toBeTruthy()
    expect(result.payment.amountBrlCents).toBe(fx.lotCents)

    // Verify DB row.
    const dbRow = await withTenant(fx.tenantId, async (db) => {
      const rows = await db
        .select()
        .from(payments)
        .where(eq(payments.id, result.payment.id))
        .limit(1)
      return rows[0]
    })
    expect(dbRow?.status).toBe('pending')
    expect(dbRow?.gatewayChargeId).toBeTruthy()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// FORN-09: credit_card installments
// ────────────────────────────────────────────────────────────────────────────

describe('FORN-09: checkout — credit_card installments', () => {
  test('installments=1 → installment_amount_brl_cents = total', async () => {
    const fx = await setupCheckoutFixture('cc-1')

    const result = await withTenant(fx.tenantId, async (db) => {
      return checkoutCartInTenant(
        db,
        fx.tenantId,
        {
          reservationId: fx.reservationId,
          method: 'credit_card',
          cardToken: 'tok_test_1',
          installments: 1,
        },
        fx.vendorId,
        fx.vendorId,
      )
    })

    expect(result.installments).toBe(1)
    // installment_amount for 1 installment = total (no interest)
    expect(result.installment_amount_brl_cents).toBe(computeInstallmentAmount(fx.lotCents, 1))
    expect(result.payment.method).toBe('credit_card')
  })

  test('installments=6 → installment_amount_brl_cents computed via tabela Price', async () => {
    const fx = await setupCheckoutFixture('cc-6')

    const result = await withTenant(fx.tenantId, async (db) => {
      return checkoutCartInTenant(
        db,
        fx.tenantId,
        {
          reservationId: fx.reservationId,
          method: 'credit_card',
          cardToken: 'tok_test_6',
          installments: 6,
        },
        fx.vendorId,
        fx.vendorId,
      )
    })

    expect(result.installments).toBe(6)
    const expected = computeInstallmentAmount(fx.lotCents, 6)
    expect(result.installment_amount_brl_cents).toBe(expected)
    // 6 × expected ≥ total (compound interest means total > principal)
    expect(6 * expected).toBeGreaterThanOrEqual(fx.lotCents)
  })

  test('installments=12 → installment_amount_brl_cents computed', async () => {
    const fx = await setupCheckoutFixture('cc-12')

    const result = await withTenant(fx.tenantId, async (db) => {
      return checkoutCartInTenant(
        db,
        fx.tenantId,
        {
          reservationId: fx.reservationId,
          method: 'credit_card',
          cardToken: 'tok_test_12',
          installments: 12,
        },
        fx.vendorId,
        fx.vendorId,
      )
    })

    expect(result.installments).toBe(12)
    const expected = computeInstallmentAmount(fx.lotCents, 12)
    expect(result.installment_amount_brl_cents).toBe(expected)
    expect(12 * expected).toBeGreaterThanOrEqual(fx.lotCents)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// FORN-09: with add-ons
// ────────────────────────────────────────────────────────────────────────────

describe('FORN-09: checkout — with add-ons in cart', () => {
  test('total includes cart add-on snapshot prices', async () => {
    const fx = await setupCheckoutFixture('cc-addons')

    // Add one add-on via raw SQL (FORCE RLS)
    await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      const ev = await tx<Array<{ event_id: string }>>`
        SELECT event_id FROM lot_reservations WHERE id = ${fx.reservationId} LIMIT 1
      `
      const eventId = ev[0]!.event_id
      const addon = await tx<Array<{ id: string }>>`
        INSERT INTO event_addons (tenant_id, event_id, name, price_brl_cents, max_qty)
        VALUES (${fx.tenantId}, ${eventId}, 'Addon Test', 10000, 5)
        RETURNING id
      `
      await tx`
        INSERT INTO cart_addon_lines (tenant_id, reservation_id, addon_id, quantity, price_brl_cents_snapshot)
        VALUES (${fx.tenantId}, ${fx.reservationId}, ${addon[0]!.id}, 2, 10000)
      `
    })

    const result = await withTenant(fx.tenantId, async (db) => {
      return checkoutCartInTenant(
        db,
        fx.tenantId,
        { reservationId: fx.reservationId, method: 'pix' },
        fx.vendorId,
        fx.vendorId,
      )
    })

    // total = lot (50000) + 2 × addon (10000) = 70000
    expect(result.payment.amountBrlCents).toBe(70_000)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AM-01: boleto rejected at schema level
// ────────────────────────────────────────────────────────────────────────────

describe('AM-01: boleto not supported (deferred Phase 3+)', () => {
  test('checkoutCartSchema rejects method="boleto"', () => {
    const result = checkoutCartSchema.safeParse({
      reservationId: '00000000-0000-0000-0000-000000000001',
      method: 'boleto',
    })
    expect(result.success).toBe(false)
  })
})
