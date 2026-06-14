// FB_EVENTOS — Pagar.me webhook handler tests (Phase 1, Plan 01-06 Task 2).
//
// Six load-bearing cases (mirror Plan 01-05 ZapSign webhook test structure):
//
//   1. Bad/missing Basic Auth → 401 (no transition).
//   2. Valid Basic Auth + API re-fetch confirms paid → payments.status='paid'
//      + paid_at populated + email job enqueued (pagamento_recebido).
//   3. Spoofed payload (event_type='order.paid') but API re-fetch returns
//      status='failed' → payments.status='failed' (re-fetch wins).
//   4. Duplicate delivery on terminal-paid state → no double audit, no
//      double email job enqueue.
//   5. Webhook for unknown order_id → 200 (gracefully ignored; no retry).
//   6. Pagar.me API re-fetch fails (5xx) → 400 (Pagar.me retries) +
//      payments status unchanged.

import { eq } from 'drizzle-orm'
import { run } from 'graphile-worker'
import { HttpResponse, http } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { POST as pagarmeWebhookPost } from '@/app/api/webhooks/pagarme/route'
import { pool } from '@/db'
import { payments } from '@/db/schema/payments'
import { withTenant } from '@/db/with-tenant'
import { EMAIL_STATUS_UPDATE_TASK } from '@/jobs/tasks/zapsign-send-contract'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { PAGARME_PIX_ORDER_RESPONSE, setupExternalMocks } from '@/test/external-mocks'
import { makeContract } from '@/test/factories/contract-factory'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

const mocks = setupExternalMocks()

const WEBHOOK_USER = 'pm_webhook_user'
const WEBHOOK_PASS = 'pm_webhook_pass_test'
const BASIC = `Basic ${Buffer.from(`${WEBHOOK_USER}:${WEBHOOK_PASS}`).toString('base64')}`

beforeAll(async () => {
  process.env.PAGARME_SECRET_KEY = 'sk_test_pagarme_key_abc'
  process.env.PAGARME_ENV = 'sandbox'
  process.env.PAGARME_WEBHOOK_USER = WEBHOOK_USER
  process.env.PAGARME_WEBHOOK_PASS = WEBHOOK_PASS
  mocks.listen()

  // Pre-register the email task so the queue's foreign-key catalog
  // accepts enqueueJob calls for EMAIL_STATUS_UPDATE_TASK.
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) throw new Error('DATABASE_MIGRATOR_URL is required')
  const r = await run({
    connectionString: migratorUrl,
    taskList: {
      [EMAIL_STATUS_UPDATE_TASK]: async () => {},
    },
    concurrency: 1,
    logger: undefined,
  })
  await r.stop()
})

beforeEach(async () => {
  mocks.resetHandlers()
  process.env.PAGARME_SECRET_KEY = 'sk_test_pagarme_key_abc'
  process.env.PAGARME_ENV = 'sandbox'
  process.env.PAGARME_WEBHOOK_USER = WEBHOOK_USER
  process.env.PAGARME_WEBHOOK_PASS = WEBHOOK_PASS
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks
      WHERE identifier IN (${EMAIL_STATUS_UPDATE_TASK})
    )
  `
})

afterAll(async () => {
  mocks.close()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Fixture: tenant + signed contract + payment in pending state with a
// known gateway_order_id (mimics post-Task-1 state).
// ────────────────────────────────────────────────────────────────────────────

interface FixtureCtx {
  tenantId: string
  contractId: string
  paymentId: string
  orderId: string
}

async function setupPendingPayment(
  prefix: string,
  opts?: { paymentStatus?: string; orderId?: string },
): Promise<FixtureCtx> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Test Tenant ${prefix}`)
  const userId = await insertUser(`u-${stamp}@example.test`, `User ${prefix}`)
  await insertOrganization(tenantId, `${stamp}-org`, `Org ${prefix}`)
  const ev = await makeEvent(tenantId)
  const cat = await makeLotCategory(tenantId, ev.id)
  const lot = await makeLot(tenantId, ev.id, cat.id)
  const vendor = await makeVendor(tenantId, { status: 'approved' })
  const contract = await makeContract(tenantId, vendor.id, lot.id, ev.id, { status: 'signed' })
  const orderId = opts?.orderId ?? `or_test_${stamp}`
  const paymentStatus = opts?.paymentStatus ?? 'pending'

  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<Array<{ id: string }>>`
      INSERT INTO payments (
        tenant_id, contract_id, gateway, gateway_order_id, gateway_charge_id,
        amount_brl_cents, method, status
      ) VALUES (
        ${tenantId}, ${contract.id}, 'pagarme', ${orderId}, ${'ch_test_' + stamp},
        100000, 'pix', ${paymentStatus}
      )
      RETURNING id
    `
  })
  const payment = rows[0]
  if (!payment) throw new Error('setupPendingPayment: payments insert failed')
  // Pin userId so the linter doesn't complain about an unused destructure.
  void userId
  return { tenantId, contractId: contract.id, paymentId: payment.id, orderId }
}

function buildRequest(opts: { body: unknown; auth?: string | null }): Request {
  const headers = new Headers()
  if (opts.auth !== null) {
    headers.set('authorization', opts.auth ?? BASIC)
  }
  headers.set('content-type', 'application/json')
  return new Request('https://eventos.fbtax.cloud/api/webhooks/pagarme', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Pagar.me webhook — auth', () => {
  test('missing Basic Auth → 401', async () => {
    const fx = await setupPendingPayment('noauth')
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a thin wrapper over Request
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_x', type: 'order.paid', data: { id: fx.orderId } },
        auth: null,
      }) as any,
    )
    expect(res.status).toBe(401)
  })

  test('wrong Basic Auth credentials → 401', async () => {
    const fx = await setupPendingPayment('wrongauth')
    const wrong = `Basic ${Buffer.from('intruder:nope').toString('base64')}`
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_x', type: 'order.paid', data: { id: fx.orderId } },
        auth: wrong,
      }) as any,
    )
    expect(res.status).toBe(401)
  })
})

describe('Pagar.me webhook — FSM transitions', () => {
  test('order.paid + API re-fetch confirms paid → payments.status=paid + email job enqueued', async () => {
    const fx = await setupPendingPayment('paid')
    mocks.use(
      http.get(`https://api.pagar.me/core/v5/orders/${fx.orderId}`, () =>
        HttpResponse.json(
          {
            ...PAGARME_PIX_ORDER_RESPONSE,
            id: fx.orderId,
            status: 'paid',
            charges: [
              {
                ...PAGARME_PIX_ORDER_RESPONSE.charges[0],
                status: 'paid',
                paid_at: '2026-06-14T10:05:00Z',
              },
            ],
          },
          { status: 200 },
        ),
      ),
    )

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_paid_1', type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(res.status).toBe(200)

    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(payments).where(eq(payments.id, fx.paymentId)).limit(1)
      return rows[0]
    })
    expect(updated?.status).toBe('paid')
    expect(updated?.paidAt).toBeTruthy()

    // Email job enqueued (pagamento_recebido).
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'payment_id' = ${fx.paymentId}
        AND j.payload->>'event' = 'pagamento_recebido'
    `
    expect(jobs).toHaveLength(1)

    // Audit row exists.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE action = 'payment.webhook' AND entity_id = ${fx.paymentId}
      `
    })
    expect(audits).toHaveLength(1)
  })

  test('belt-and-suspenders: webhook says paid but API re-fetch returns failed → payments.status=failed', async () => {
    const fx = await setupPendingPayment('spoof')
    mocks.use(
      http.get(`https://api.pagar.me/core/v5/orders/${fx.orderId}`, () =>
        HttpResponse.json(
          {
            ...PAGARME_PIX_ORDER_RESPONSE,
            id: fx.orderId,
            status: 'failed',
            charges: [
              {
                ...PAGARME_PIX_ORDER_RESPONSE.charges[0],
                status: 'failed',
              },
            ],
          },
          { status: 200 },
        ),
      ),
    )

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_spoof_1', type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(res.status).toBe(200)

    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(payments).where(eq(payments.id, fx.paymentId)).limit(1)
      return rows[0]
    })
    // Re-fetch wins — payments.status follows the API result, not the webhook claim.
    expect(updated?.status).toBe('failed')
    expect(updated?.paidAt).toBeNull()
  })

  test('duplicate webhook on terminal-paid payment → no double audit, no double email', async () => {
    const fx = await setupPendingPayment('idem', { paymentStatus: 'paid' })
    mocks.use(
      http.get(`https://api.pagar.me/core/v5/orders/${fx.orderId}`, () =>
        HttpResponse.json(
          {
            ...PAGARME_PIX_ORDER_RESPONSE,
            id: fx.orderId,
            status: 'paid',
            charges: [
              {
                ...PAGARME_PIX_ORDER_RESPONSE.charges[0],
                status: 'paid',
                paid_at: '2026-06-14T10:05:00Z',
              },
            ],
          },
          { status: 200 },
        ),
      ),
    )

    // First delivery — payment already terminal.
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const r1 = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_dup_1', type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(r1.status).toBe(200)

    // Second delivery (different event id, same order).
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const r2 = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_dup_2', type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(r2.status).toBe(200)

    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${fx.tenantId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE action = 'payment.webhook' AND entity_id = ${fx.paymentId}
      `
    })
    // Zero audits — both deliveries dropped at the terminal-state guard.
    expect(audits).toHaveLength(0)

    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
        AND j.payload->>'payment_id' = ${fx.paymentId}
    `
    expect(jobs).toHaveLength(0)
  })
})

describe('Pagar.me webhook — graceful failure modes', () => {
  test('webhook for unknown order_id → 200 (gracefully ignored)', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_ghost', type: 'order.paid', data: { id: 'or_does_not_exist' } },
      }) as any,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok?: boolean; ignored?: string }
    expect(json.ok).toBe(true)
    expect(json.ignored).toBe('unknown_order')
  })

  test('Pagar.me API re-fetch fails (5xx) → 400 (Pagar.me retries) + payment status unchanged', async () => {
    const fx = await setupPendingPayment('refetch-fail')
    mocks.use(
      http.get(
        `https://api.pagar.me/core/v5/orders/${fx.orderId}`,
        () => new HttpResponse('upstream timeout', { status: 503 }),
      ),
    )

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_refetch_fail', type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(res.status).toBe(400)

    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(payments).where(eq(payments.id, fx.paymentId)).limit(1)
      return rows[0]
    })
    expect(updated?.status).toBe('pending')
    expect(updated?.paidAt).toBeNull()
  })
})
