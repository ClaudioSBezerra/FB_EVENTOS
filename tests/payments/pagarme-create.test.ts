// FB_EVENTOS — createCharge Server Action tests (Phase 1, Plan 01-06 Task 1).
//
// Six load-bearing cases:
//
//   1. createCharge with method='pix' on a signed contract → returns
//      PIX QR + copia-cola; payments row pending; pagarme_orders row
//      stores idempotency_key + request payload + response payload.
//   2. createCharge with method='credit_card' (sandbox token) → returns
//      payment with gateway_charge_id set; pagarme_orders row exists.
//   3. createCharge on a contract with status='draft' (not signed) →
//      throws "Contrato precisa estar assinado..." (Phase 1 gate).
//   4. Tenant B cannot create a charge for tenant A's contract — the
//      JOIN returns 0 rows under RLS → throws "Contrato não encontrado".
//   5. Pagar.me API returns 5xx → createCharge re-throws; audit row
//      'payment.create_failed' is written; payments row stays pending.
//   6. PAGARME_SECRET_KEY missing → PagarmeNotConfiguredError surfaces
//      cleanly; Pagar.me is never called.

import { eq } from 'drizzle-orm'
import { HttpResponse, http } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { pagarmeOrders, payments } from '@/db/schema/payments'
import { withTenant } from '@/db/with-tenant'
import { createChargeInTenant } from '@/lib/actions/payments'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { PAGARME_PIX_ORDER_RESPONSE, setupExternalMocks } from '@/test/external-mocks'
import { makeContract } from '@/test/factories/contract-factory'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

const mocks = setupExternalMocks()

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.PAGARME_SECRET_KEY = 'sk_test_pagarme_key_abc'
  process.env.PAGARME_ENV = 'sandbox'
  mocks.listen()
})

beforeEach(() => {
  mocks.resetHandlers()
  // Reset env to sandbox happy path between tests.
  process.env.PAGARME_SECRET_KEY = 'sk_test_pagarme_key_abc'
  process.env.PAGARME_ENV = 'sandbox'
})

afterAll(async () => {
  mocks.close()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Fixture: tenant with one signed contract ready for charging
// ────────────────────────────────────────────────────────────────────────────

interface FixtureCtx {
  tenantId: string
  contractId: string
  userId: string
}

async function setupSignedContract(
  prefix: string,
  opts?: { contractStatus?: string },
): Promise<FixtureCtx> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Test Tenant ${prefix}`)
  const userId = await insertUser(`u-${stamp}@example.test`, `User ${prefix}`)
  await insertOrganization(tenantId, `${stamp}-org`, `Org ${prefix}`)
  const ev = await makeEvent(tenantId)
  const cat = await makeLotCategory(tenantId, ev.id, { baseFixed: 100, perSqmRate: 50 })
  const lot = await makeLot(tenantId, ev.id, cat.id, { areaM2: 10 })
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id, {
    status: opts?.contractStatus ?? 'signed',
    pdfMinioKey: `contracts/_/contract-v1.pdf`,
    signedPdfMinioKey: `contracts/_/signed.pdf`,
  })
  return { tenantId, contractId: contract.id, userId }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('createCharge — happy path', () => {
  test('PIX charge on a signed contract returns QR + copia-cola; payments row pending; pagarme_orders persisted', async () => {
    const fx = await setupSignedContract('pix-happy')

    const result = await withTenant(fx.tenantId, async (db) => {
      return createChargeInTenant(
        db,
        fx.tenantId,
        {
          contractId: fx.contractId,
          method: 'pix',
          amount_brl_cents: 100_000, // R$1000,00
        },
        fx.userId,
      )
    })

    expect(result.payment.status).toBe('pending')
    expect(result.payment.method).toBe('pix')
    expect(result.payment.amountBrlCents).toBe(100_000)
    expect(result.payment.gatewayOrderId).toBe(PAGARME_PIX_ORDER_RESPONSE.id)
    expect(result.payment.gatewayChargeId).toBe(PAGARME_PIX_ORDER_RESPONSE.charges[0]?.id)
    expect(result.pix_copy_paste).toMatch(/^00020126/) // EMV-encoded PIX prefix
    expect(result.pix_qr_url).toContain('pagar.me')

    // pagarme_orders row stores idempotency_key + both payloads.
    const orderRows = await withTenant(fx.tenantId, async (db) => {
      return db.select().from(pagarmeOrders).where(eq(pagarmeOrders.paymentId, result.payment.id))
    })
    expect(orderRows).toHaveLength(1)
    expect(orderRows[0]?.idempotencyKey).toMatch(/^payment-/)
    expect(orderRows[0]?.requestPayload).toBeTruthy()
    expect(orderRows[0]?.responsePayload).toBeTruthy()

    // audit row 'payment.created' present.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE action = 'payment.created' AND entity_id = ${result.payment.id}
      `
    })
    expect(audits).toHaveLength(1)
  })

  test('credit_card charge with sandbox token returns gateway_charge_id', async () => {
    const fx = await setupSignedContract('cc-happy')

    // Override Pagar.me response with a credit_card charge shape.
    const cardResponse = {
      ...PAGARME_PIX_ORDER_RESPONSE,
      id: 'or_test_cc_xyz',
      charges: [
        {
          id: 'ch_test_cc_xyz',
          status: 'paid',
          payment_method: 'credit_card',
          amount: 50_000,
          last_transaction: {
            id: 'tran_test_cc_xyz',
            transaction_type: 'credit_card',
          },
        },
      ],
    }
    mocks.use(
      http.post('https://api.pagar.me/core/v5/orders', () =>
        HttpResponse.json(cardResponse, { status: 200 }),
      ),
    )

    const result = await withTenant(fx.tenantId, async (db) => {
      return createChargeInTenant(
        db,
        fx.tenantId,
        {
          contractId: fx.contractId,
          method: 'credit_card',
          amount_brl_cents: 50_000,
          card_token: 'card_token_sandbox_abc',
        },
        fx.userId,
      )
    })

    expect(result.payment.method).toBe('credit_card')
    expect(result.payment.gatewayOrderId).toBe('or_test_cc_xyz')
    expect(result.payment.gatewayChargeId).toBe('ch_test_cc_xyz')
    // Credit card path: no PIX details surface.
    expect(result.pix_copy_paste).toBeNull()
    expect(result.pix_qr_url).toBeNull()
  })
})

describe('createCharge — guards', () => {
  test('rejects when contract is not signed (status=draft)', async () => {
    const fx = await setupSignedContract('not-signed', { contractStatus: 'draft' })

    await expect(
      withTenant(fx.tenantId, async (db) => {
        return createChargeInTenant(
          db,
          fx.tenantId,
          {
            contractId: fx.contractId,
            method: 'pix',
            amount_brl_cents: 10_000,
          },
          fx.userId,
        )
      }),
    ).rejects.toThrow(/precisa estar assinado/i)

    // Confirm no payments row was created.
    const remaining = await withTenant(fx.tenantId, async (db) => {
      return db.select().from(payments).where(eq(payments.contractId, fx.contractId))
    })
    expect(remaining).toHaveLength(0)
  })

  test('tenant B cannot charge tenant A contract (RLS — JOIN returns 0 rows)', async () => {
    const tenantA = await setupSignedContract('rls-a')
    const tenantB = await setupSignedContract('rls-b')

    // Tenant B tries to create a charge against tenant A's contract id.
    await expect(
      withTenant(tenantB.tenantId, async (db) => {
        return createChargeInTenant(
          db,
          tenantB.tenantId,
          {
            contractId: tenantA.contractId, // ← cross-tenant id
            method: 'pix',
            amount_brl_cents: 10_000,
          },
          tenantB.userId,
        )
      }),
    ).rejects.toThrow(/não encontrado|inacessível/i)
  })
})

describe('createCharge — Pagar.me API failure', () => {
  test('Pagar.me returns 5xx → re-throws + audit "payment.create_failed" persists in out-of-band tx', async () => {
    const fx = await setupSignedContract('api-5xx')

    mocks.use(
      http.post(
        'https://api.pagar.me/core/v5/orders',
        () => new HttpResponse('upstream timeout', { status: 503 }),
      ),
    )

    await expect(
      withTenant(fx.tenantId, async (db) => {
        return createChargeInTenant(
          db,
          fx.tenantId,
          {
            contractId: fx.contractId,
            method: 'pix',
            amount_brl_cents: 10_000,
          },
          fx.userId,
        )
      }),
    ).rejects.toThrow(/Pagar\.me API 503/i)

    // The failed-charge transaction rolled back (no payments row, no
    // pagarme_orders row — Phase 2 outbox will refine this to keep a
    // durable pending row). Crucially, the out-of-band audit row
    // SURVIVED the rollback because it was written in an independent
    // withTenant transaction.
    const paymentRows = await withTenant(fx.tenantId, async (db) => {
      return db.select().from(payments).where(eq(payments.contractId, fx.contractId))
    })
    expect(paymentRows).toHaveLength(0)

    // 'payment.create_failed' audit row IS persisted (out-of-band tx).
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      return tx<Array<{ action: string; payload: Record<string, unknown> }>>`
        SELECT action, payload FROM audit_log
        WHERE action = 'payment.create_failed'
          AND payload->>'contract_id' = ${fx.contractId}
      `
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]?.payload.error).toMatch(/Pagar\.me 503/i)
  })
})

describe('createCharge — env wiring', () => {
  test('throws PagarmeNotConfiguredError when PAGARME_SECRET_KEY is missing', async () => {
    const fx = await setupSignedContract('no-key')
    delete process.env.PAGARME_SECRET_KEY

    await expect(
      withTenant(fx.tenantId, async (db) => {
        return createChargeInTenant(
          db,
          fx.tenantId,
          {
            contractId: fx.contractId,
            method: 'pix',
            amount_brl_cents: 10_000,
          },
          fx.userId,
        )
      }),
    ).rejects.toThrow(/PAGARME_SECRET_KEY is not configured/i)
  })
})
