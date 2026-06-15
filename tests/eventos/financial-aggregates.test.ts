// FB_EVENTOS — Dashboard financial aggregates tests (Phase 1, Plan 01-07 Task 1).
//
// Six load-bearing cases for getEventFinancialsInTenant:
//   1. 2 paid + 1 pending → recebidoBRL + aReceberBRL computed correctly
//   2. Commission at default rate (0.0500 = 5%) → comissaoBRL = recebido × 0.05
//   3. Tenant override (platform_commission_pct=0.08) → 8% applied
//   4. byVendor[] aggregates per-vendor totals, sorted by paid desc
//   5. Refunded / failed payments excluded from recebido
//   6. Cross-tenant isolation — tenant B sees zero

import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import { getEventFinancialsInTenant } from '@/lib/actions/dashboard'
import { appPool, createTenant, migratorPool } from '@/test/db'
import { makeContract } from '@/test/factories/contract-factory'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Test helper: insert a payments row directly (the createCharge path goes
// through Pagar.me and we don't want to mock that here — we just need a
// row in the desired status with a known amount).
// ────────────────────────────────────────────────────────────────────────────

async function insertPayment(
  tenantId: string,
  contractId: string,
  status: 'paid' | 'pending' | 'failed' | 'refunded',
  amountBrlCents: number,
  opts: { method?: 'pix' | 'credit_card' } = {},
): Promise<string> {
  const method = opts.method ?? 'pix'
  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<{ id: string }[]>`
      INSERT INTO payments (
        tenant_id, contract_id, gateway, amount_brl_cents, method, status, paid_at
      ) VALUES (
        ${tenantId}, ${contractId}, 'pagarme', ${amountBrlCents}, ${method},
        ${status}, ${status === 'paid' ? new Date() : null}
      )
      RETURNING id
    `
  })
  if (!rows[0]) throw new Error('insertPayment: no id returned')
  return rows[0].id
}

interface SetupResult {
  tenantId: string
  eventId: string
  vendorId: string
  contractId: string
}

async function setupTenantWithContract(prefix: string): Promise<SetupResult> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Tenant ${stamp}`)
  const ev = await makeEvent(tenantId)
  const cat = await makeLotCategory(tenantId, ev.id, { baseFixed: 100, perSqmRate: 50 })
  const lot = await makeLot(tenantId, ev.id, cat.id, { areaM2: 10 })
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id, {
    status: 'signed',
  })
  return { tenantId, eventId: ev.id, vendorId: vendor.id, contractId: contract.id }
}

describe('getEventFinancials — recebido / a receber', () => {
  test('2 paid + 1 pending payment → recebidoBRL + aReceberBRL correct', async () => {
    const fx = await setupTenantWithContract('rec')
    // R$ 500 paid + R$ 300 paid + R$ 200 pending
    await insertPayment(fx.tenantId, fx.contractId, 'paid', 50_000)
    await insertPayment(fx.tenantId, fx.contractId, 'paid', 30_000)
    await insertPayment(fx.tenantId, fx.contractId, 'pending', 20_000)

    const result = await withTenant(fx.tenantId, async (db) =>
      getEventFinancialsInTenant(db, fx.tenantId, { eventId: fx.eventId }),
    )
    expect(result.recebidoBRL).toBe(800)
    expect(result.aReceberBRL).toBe(200)
  })
})

describe('getEventFinancials — commission at default rate', () => {
  test('comissaoBRL = recebidoBRL × 0.05 (default 5%)', async () => {
    const fx = await setupTenantWithContract('comm-default')
    await insertPayment(fx.tenantId, fx.contractId, 'paid', 100_000) // R$ 1000

    const result = await withTenant(fx.tenantId, async (db) =>
      getEventFinancialsInTenant(db, fx.tenantId, { eventId: fx.eventId }),
    )
    expect(result.commissionRate).toBeCloseTo(0.05, 4)
    expect(result.comissaoBRL).toBe(50)
    expect(result.recebidoBRL).toBe(1000)
  })
})

describe('getEventFinancials — tenant commission override', () => {
  test('tenant with platform_commission_pct=0.08 → 8% applied', async () => {
    const fx = await setupTenantWithContract('comm-8pct')
    // Override commission rate to 8%.
    await migratorPool`
      UPDATE tenants SET platform_commission_pct = 0.0800 WHERE id = ${fx.tenantId}
    `
    await insertPayment(fx.tenantId, fx.contractId, 'paid', 100_000) // R$ 1000

    const result = await withTenant(fx.tenantId, async (db) =>
      getEventFinancialsInTenant(db, fx.tenantId, { eventId: fx.eventId }),
    )
    expect(result.commissionRate).toBeCloseTo(0.08, 4)
    expect(result.comissaoBRL).toBe(80)
    // byVendor row also uses the override.
    expect(result.byVendor[0]?.comissaoBRL).toBe(80)
  })
})

describe('getEventFinancials — byVendor aggregation', () => {
  test('byVendor totals are per-fornecedor and sorted by paid desc', async () => {
    const fx = await setupTenantWithContract('byv')
    // Vendor A already exists from setup (legal name "Empresa Teste ...").
    // Build a SECOND vendor + contract + payments to prove GROUP BY by vendor.
    const vendorB = await makeVendor(fx.tenantId, {
      status: 'approved',
      cnpj: '99999999000199',
      legalName: 'Aabbe LTDA',
      email: `b-${Date.now()}@example.com`,
    })
    // Same event → reuse another lot for vendor B.
    // We need a second lot to satisfy the partial UNIQUE on lot_assignments
    // (Phase 1 invariant: one active assignment per lot). Each vendor → own lot.
    const catB = await makeLotCategory(fx.tenantId, fx.eventId, { baseFixed: 0, perSqmRate: 50 })
    const lotB = await makeLot(fx.tenantId, fx.eventId, catB.id, { code: 'B-LOT', areaM2: 10 })
    const contractB = await makeContract(fx.tenantId, vendorB.id, lotB.id, fx.eventId, {
      status: 'signed',
    })

    // Vendor A: R$ 500 paid + R$ 300 pending
    await insertPayment(fx.tenantId, fx.contractId, 'paid', 50_000)
    await insertPayment(fx.tenantId, fx.contractId, 'pending', 30_000)
    // Vendor B: R$ 1000 paid (higher than A → should sort first)
    await insertPayment(fx.tenantId, contractB.id, 'paid', 100_000)

    const result = await withTenant(fx.tenantId, async (db) =>
      getEventFinancialsInTenant(db, fx.tenantId, { eventId: fx.eventId }),
    )
    expect(result.recebidoBRL).toBe(1500)
    expect(result.aReceberBRL).toBe(300)
    expect(result.byVendor).toHaveLength(2)
    // Sorted by paid desc: vendor B (R$1000) first, then vendor A (R$500).
    expect(result.byVendor[0]?.vendorId).toBe(vendorB.id)
    expect(result.byVendor[0]?.totalPaidBRL).toBe(1000)
    expect(result.byVendor[0]?.comissaoBRL).toBe(50) // 5% of R$1000
    expect(result.byVendor[1]?.vendorId).toBe(fx.vendorId)
    expect(result.byVendor[1]?.totalPaidBRL).toBe(500)
    expect(result.byVendor[1]?.totalPendingBRL).toBe(300)
  })
})

describe('getEventFinancials — refunded / failed excluded', () => {
  test('refunded + failed payments do NOT contribute to recebido', async () => {
    const fx = await setupTenantWithContract('refund')
    await insertPayment(fx.tenantId, fx.contractId, 'paid', 50_000) // R$500 counted
    await insertPayment(fx.tenantId, fx.contractId, 'refunded', 30_000) // ignored
    await insertPayment(fx.tenantId, fx.contractId, 'failed', 20_000) // ignored
    await insertPayment(fx.tenantId, fx.contractId, 'pending', 10_000) // R$100 a receber

    const result = await withTenant(fx.tenantId, async (db) =>
      getEventFinancialsInTenant(db, fx.tenantId, { eventId: fx.eventId }),
    )
    expect(result.recebidoBRL).toBe(500)
    expect(result.aReceberBRL).toBe(100)
    expect(result.comissaoBRL).toBe(25) // 5% × R$500
  })
})

describe('getEventFinancials — tenant isolation', () => {
  test('tenant B sees zero for tenant A event (RLS hides payments + contracts)', async () => {
    const fxA = await setupTenantWithContract('rls-a')
    await insertPayment(fxA.tenantId, fxA.contractId, 'paid', 100_000)

    // Tenant B
    const stamp = `rls-b-${Date.now()}`
    const tenantBId = await createTenant(stamp, `Tenant B ${stamp}`)

    const result = await withTenant(tenantBId, async (db) =>
      getEventFinancialsInTenant(db, tenantBId, { eventId: fxA.eventId }),
    )
    expect(result.recebidoBRL).toBe(0)
    expect(result.aReceberBRL).toBe(0)
    expect(result.comissaoBRL).toBe(0)
    expect(result.byVendor).toHaveLength(0)
  })
})
