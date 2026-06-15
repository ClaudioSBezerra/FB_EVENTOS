// FB_EVENTOS — Pagar.me webhook handler tests (Phase 1 + Phase 2 refactor).
//
// Phase 1 (plan 01-06): Synchronous FSM in the handler (Basic Auth, re-fetch,
//   payments.status update, email enqueue — all in the HTTP handler).
//
// Phase 2 (plan 02-05): Handler changed to async inbox+enqueue pattern:
//   - Handler DOES NOT call Pagar.me API anymore (perf: p95 < 100ms).
//   - Handler DOES NOT update payments.status (FSM moved to worker).
//   - Handler DOES insert into payment_webhooks_inbox (idempotency).
//   - Handler DOES enqueue payment.process-webhook job (graphile-worker).
//   - FSM transitions, re-fetch, email enqueue → payment-process-webhook.ts.
//
// Tests updated in Phase 2 (Rule 1 — behaviour changed):
//   - FSM tests now verify inbox row + job enqueued (not status update).
//   - "API re-fetch fails → 400" test updated: handler never re-fetches,
//     always returns 200 and enqueues (re-fetch error → worker retries).
//
// Six load-bearing cases:
//
//   1. Bad/missing Basic Auth → 401 (no transition).
//   2. Valid webhook → handler returns 200 + inbox row created + worker job
//      enqueued (payments.status still pending — FSM is in worker).
//   3. Spoofed webhook (paid claim) → handler still enqueues (worker will
//      re-fetch and apply correct status).
//   4. Duplicate delivery on terminal-paid payment → 200 for both (inbox
//      deduplication at gateway_event_id level; terminal guard in worker).
//   5. Webhook for unknown order_id → 200 (gracefully ignored; no retry).
//   6. Pagar.me API error → handler returns 200 + enqueues (no re-fetch
//      in handler; worker handles re-fetch with graphile-worker retries).

import { eq } from 'drizzle-orm'
import { run } from 'graphile-worker'
import { HttpResponse, http } from 'msw'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { POST as pagarmeWebhookPost } from '@/app/api/webhooks/pagarme/route'
import { pool } from '@/db'
import { payments } from '@/db/schema/payments'
import { withTenant } from '@/db/with-tenant'
import { PAYMENT_PROCESS_WEBHOOK_TASK } from '@/jobs/tasks/payment-process-webhook'
import { EMAIL_STATUS_UPDATE_TASK } from '@/jobs/tasks/zapsign-send-contract'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { setupExternalMocks } from '@/test/external-mocks'
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

  // Bootstrap graphile-worker schema (._private_jobs / ._private_tasks tables)
  // by running a no-op worker once. Without this, the beforeEach cleanup
  // below errors out on fresh CI DBs that haven't yet had any other test
  // initialize graphile-worker. Same pattern as tests/contracts/zapsign-webhook.test.ts.
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) throw new Error('DATABASE_MIGRATOR_URL is required')
  const r = await run({
    connectionString: migratorUrl,
    taskList: {
      [PAYMENT_PROCESS_WEBHOOK_TASK]: async () => {},
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
  // Clean up enqueued jobs from prior test runs (both webhook worker and email tasks).
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks
      WHERE identifier IN (${PAYMENT_PROCESS_WEBHOOK_TASK}, ${EMAIL_STATUS_UPDATE_TASK})
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
  test('order.paid → handler returns 200 + inbox row created + worker job enqueued (Phase 2: FSM in worker, not handler)', async () => {
    // Phase 2: the handler does NOT call Pagar.me API and does NOT update
    // payments.status. It only inserts into payment_webhooks_inbox and
    // enqueues payment.process-webhook for the background worker.
    // The MSW mock is set up but the handler will NOT call it (verified by
    // the perf test in tests/webhooks/perf.test.ts).
    const fx = await setupPendingPayment('paid')

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_paid_1', type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok?: boolean; duplicate?: boolean }
    expect(json.ok).toBe(true)
    expect(json.duplicate).toBeFalsy()

    // Payment status is still 'pending' — the FSM transition happens in the
    // worker (payment-process-webhook.ts), not in the handler.
    const unchanged = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(payments).where(eq(payments.id, fx.paymentId)).limit(1)
      return rows[0]
    })
    expect(unchanged?.status).toBe('pending')

    // Inbox row was inserted.
    const inbox = await migratorPool<Array<{ processing_status: string }>>`
      SELECT processing_status FROM payment_webhooks_inbox
      WHERE gateway_event_id = 'hook_paid_1'
    `
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.processing_status).toBe('pending')

    // payment.process-webhook job was enqueued.
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${PAYMENT_PROCESS_WEBHOOK_TASK}
        AND j.payload->>'payment_id' = ${fx.paymentId}
    `
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload?.gateway_event_id).toBe('hook_paid_1')
    expect(jobs[0]?.payload?.order_id).toBe(fx.orderId)
    expect(jobs[0]?.payload?.event_type).toBe('order.paid')
  })

  test('belt-and-suspenders: spoofed paid webhook → handler enqueues worker job; worker does re-fetch (Phase 2)', async () => {
    // Phase 2: the handler does NOT re-fetch from Pagar.me. It always enqueues
    // the worker regardless of the webhook payload status. The worker does the
    // re-fetch (belt-and-suspenders) and trusts the API over the webhook claim.
    // Here we verify the handler enqueues even for a spoofed "order.paid" event.
    const fx = await setupPendingPayment('spoof')

    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const res = await pagarmeWebhookPost(
      buildRequest({
        body: { id: 'hook_spoof_1', type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok?: boolean }
    expect(json.ok).toBe(true)

    // Payment status unchanged by handler — worker applies FSM after re-fetch.
    const unchanged = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(payments).where(eq(payments.id, fx.paymentId)).limit(1)
      return rows[0]
    })
    expect(unchanged?.status).toBe('pending')

    // Worker job was enqueued with the correct order_id for re-fetch.
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${PAYMENT_PROCESS_WEBHOOK_TASK}
        AND j.payload->>'payment_id' = ${fx.paymentId}
    `
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload?.order_id).toBe(fx.orderId)
  })

  test('two deliveries with same gateway_event_id → second returns duplicate:true (Phase 2: inbox deduplication)', async () => {
    // Phase 2: deduplication is at the inbox (gateway_event_id PK level),
    // not at the terminal-state level. Different event IDs → different inbox
    // rows + different worker jobs. Same event ID → inbox ON CONFLICT DO NOTHING
    // → 200 with { duplicate: true }.
    //
    // Terminal-state idempotency (no double audit, no double email) is handled
    // by the worker's TERMINAL_PAYMENT_STATUSES guard — not the handler.
    const fx = await setupPendingPayment('idem', { paymentStatus: 'paid' })

    const stamp = Date.now()
    // First delivery (unique event id).
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const r1 = await pagarmeWebhookPost(
      buildRequest({
        body: { id: `hook_idem_${stamp}`, type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(r1.status).toBe(200)
    const json1 = (await r1.json()) as { ok?: boolean; duplicate?: boolean }
    expect(json1.ok).toBe(true)
    expect(json1.duplicate).toBeFalsy()

    // Second delivery with the SAME event id → inbox conflict → duplicate:true.
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest stub
    const r2 = await pagarmeWebhookPost(
      buildRequest({
        body: { id: `hook_idem_${stamp}`, type: 'order.paid', data: { id: fx.orderId } },
      }) as any,
    )
    expect(r2.status).toBe(200)
    const json2 = (await r2.json()) as { ok?: boolean; duplicate?: boolean }
    expect(json2.ok).toBe(true)
    expect(json2.duplicate).toBe(true)

    // Only ONE inbox row for this event_id (ON CONFLICT DO NOTHING).
    const inbox = await migratorPool<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM payment_webhooks_inbox
      WHERE gateway_event_id = ${`hook_idem_${stamp}`}
    `
    expect(Number(inbox[0]?.count)).toBe(1)

    // Only ONE worker job for this event (duplicate delivery not enqueued).
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${PAYMENT_PROCESS_WEBHOOK_TASK}
        AND j.payload->>'gateway_event_id' = ${`hook_idem_${stamp}`}
    `
    expect(jobs).toHaveLength(1)
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

  test('Pagar.me API error → handler returns 200 + enqueues worker (Phase 2: no re-fetch in handler)', async () => {
    // Phase 2: the handler never calls the Pagar.me API. Re-fetch is the
    // worker's responsibility. If the API is down, graphile-worker retries
    // the worker job with exponential backoff (default max_attempts=25).
    // The handler always returns 200 to Pagar.me so it does NOT retry the
    // webhook delivery. The worker retry handles the transient API failure.
    //
    // This replaces the Phase 1 "→ 400" test (where the handler itself
    // re-fetched and returned 400 to trigger Pagar.me webhook retry).
    const fx = await setupPendingPayment('refetch-fail')
    // The 503 mock is registered but the handler will NOT call it.
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
    // Phase 2: handler returns 200 (not 400) — it doesn't re-fetch.
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok?: boolean }
    expect(json.ok).toBe(true)

    // Payment status unchanged (worker not run in this test).
    const updated = await withTenant(fx.tenantId, async (db) => {
      const rows = await db.select().from(payments).where(eq(payments.id, fx.paymentId)).limit(1)
      return rows[0]
    })
    expect(updated?.status).toBe('pending')
    expect(updated?.paidAt).toBeNull()

    // Worker job was enqueued (worker will re-fetch + retry on failure).
    const jobs = await migratorPool<Array<{ payload: Record<string, unknown> }>>`
      SELECT j.payload FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${PAYMENT_PROCESS_WEBHOOK_TASK}
        AND j.payload->>'payment_id' = ${fx.paymentId}
    `
    expect(jobs).toHaveLength(1)
  })
})
