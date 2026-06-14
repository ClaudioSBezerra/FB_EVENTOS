// FB_EVENTOS — Pagar.me webhook handler (Phase 1, Plan 01-06 Task 2).
//
// Receives POST callbacks from Pagar.me v5 and transitions the payments
// FSM through:
//
//   pending → paid     (order.paid OR charge.paid — re-fetch confirms)
//           → failed   (order.payment_failed OR charge.payment_failed)
//           → canceled (order.canceled)
//           → refunded (charge.refunded)
//
// SECURITY MODEL (mirrors src/app/api/webhooks/zapsign/route.ts):
//   1. HTTP Basic Auth header verified against PAGARME_WEBHOOK_USER +
//      PAGARME_WEBHOOK_PASS env (configured in Pagar.me dashboard).
//      Missing/wrong auth → 401.
//   2. **Belt-and-suspenders re-fetch**: after Basic Auth passes, the
//      handler GETs the order from Pagar.me API via getOrder(orderId)
//      and trusts the API status over the webhook payload. Webhook is a
//      notification; API is the source of truth (defends against spoofing —
//      RESEARCH §A8 Pitfall).
//   3. Always returns 200 to Pagar.me on processable events. Returns 400
//      ONLY when the re-fetch fails (so Pagar.me retries with backoff).
//   4. Idempotent terminal-state guard: once payments.status is in
//      {paid, failed, canceled, refunded}, every subsequent webhook
//      delivery is a no-op (no double audit, no double email enqueue) —
//      the FSM itself is the dedup key.
//
// TENANT RESOLUTION:
//   No session yet; we resolve tenant_id from payments.gateway_order_id
//   via the migrator pool (Migration 0015 grants SELECT-only on payments
//   to fb_eventos_migrator) BEFORE entering withTenant() to apply the
//   FSM transition.

import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { migratorPool } from '@/db/migrator-pool'
import { payments } from '@/db/schema/payments'
import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { EMAIL_STATUS_UPDATE_TASK } from '@/jobs/tasks/zapsign-send-contract'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { getOrder } from '@/lib/pagarme/client'
import { type PagarmeWebhookEvent, pagarmeWebhookEventSchema } from '@/lib/pagarme/types'

const log = logger.child({ component: 'webhook.pagarme' })

// ────────────────────────────────────────────────────────────────────────────
// Basic Auth check (Pagar.me v5 dashboard configures user:pass)
// ────────────────────────────────────────────────────────────────────────────

function verifyBasicAuth(req: NextRequest): boolean {
  const expectedUser = process.env.PAGARME_WEBHOOK_USER
  const expectedPass = process.env.PAGARME_WEBHOOK_PASS
  if (!expectedUser || !expectedPass) {
    // Fail closed when Basic Auth env is unconfigured — never accept a
    // webhook that we cannot verify.
    return false
  }
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Basic ')) return false
  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx < 0) return false
    const user = decoded.slice(0, idx)
    const pass = decoded.slice(idx + 1)
    return user === expectedUser && pass === expectedPass
  } catch {
    return false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tenant resolution by gateway_order_id (BYPASSRLS lookup via migratorPool)
// ────────────────────────────────────────────────────────────────────────────

async function resolveTenantForOrderId(orderId: string): Promise<{
  tenantId: string
  paymentId: string
} | null> {
  const rows = await migratorPool<Array<{ tenant_id: string; id: string }>>`
    SELECT tenant_id, id
      FROM payments
     WHERE gateway_order_id = ${orderId}
     LIMIT 1
  `
  const r = rows[0]
  return r ? { tenantId: r.tenant_id, paymentId: r.id } : null
}

// ────────────────────────────────────────────────────────────────────────────
// FSM transition decision — map Pagar.me API status to our payments status
// ────────────────────────────────────────────────────────────────────────────

function decideNewStatus(apiStatus: string, apiChargeStatus?: string): string | null {
  // Order-level statuses (Pagar.me docs):
  //   pending | paid | canceled | failed
  const s = apiStatus.toLowerCase()
  const cs = (apiChargeStatus ?? '').toLowerCase()
  if (s === 'paid' || cs === 'paid') return 'paid'
  if (s === 'failed' || cs === 'failed') return 'failed'
  if (s === 'canceled' || cs === 'canceled') return 'canceled'
  if (cs === 'refunded') return 'refunded'
  return null
}

const TERMINAL_PAYMENT_STATUSES = new Set(['paid', 'failed', 'canceled', 'refunded'])

// ────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Basic Auth.
  if (!verifyBasicAuth(req)) {
    log.warn('unauthorized webhook delivery (Basic Auth failed)')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 2. Parse + validate payload.
  let parsed: PagarmeWebhookEvent
  try {
    const raw = (await req.json()) as unknown
    parsed = pagarmeWebhookEventSchema.parse(raw)
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'invalid webhook payload')
    // Return 200 so Pagar.me doesn't retry forever on a malformed payload.
    return NextResponse.json({ ok: true, ignored: 'invalid_payload' }, { status: 200 })
  }

  // 3. Extract the order id from the event data. Pagar.me v5 sends:
  //    - order.* events: data.id starts with "or_"
  //    - charge.* events: data.id starts with "ch_" (and data.order may
  //      carry the order_id; failing that we cannot route the event)
  // biome-ignore lint/suspicious/noExplicitAny: passthrough payload at this layer
  const data = parsed.data as any
  let orderId: string | undefined
  if (typeof data?.id === 'string' && data.id.startsWith('or_')) {
    orderId = data.id
  } else if (typeof data?.order?.id === 'string' && data.order.id.startsWith('or_')) {
    orderId = data.order.id
  } else if (typeof data?.code === 'string' && data.code.startsWith('or_')) {
    orderId = data.code
  }

  if (!orderId) {
    log.warn({ eventId: parsed.id, type: parsed.type }, 'webhook missing order id — ignoring')
    return NextResponse.json({ ok: true, ignored: 'no_order_id' }, { status: 200 })
  }

  // 4. Resolve tenant via payments lookup.
  const resolved = await resolveTenantForOrderId(orderId)
  if (!resolved) {
    log.warn({ orderId }, 'no payments row for order_id — ignoring')
    // 200 so Pagar.me does not retry — the payment may belong to a
    // different account or our DB has not yet caught up.
    return NextResponse.json({ ok: true, ignored: 'unknown_order' }, { status: 200 })
  }

  // 5. Belt-and-suspenders RE-FETCH from Pagar.me API. If this fails,
  //    return 400 so Pagar.me retries the webhook.
  let apiOrder: Awaited<ReturnType<typeof getOrder>>
  try {
    apiOrder = await getOrder(orderId)
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), orderId },
      'Pagar.me API re-fetch failed — returning 400 so Pagar.me retries',
    )
    return NextResponse.json({ error: 'refetch_failed' }, { status: 400 })
  }

  // 6. Decide the FSM transition based on API status (NOT webhook payload).
  const apiCharge = apiOrder.charges[0]
  const newStatus = decideNewStatus(apiOrder.status, apiCharge?.status)

  // 7. Apply transition inside withTenant.
  try {
    await withTenant(resolved.tenantId, async (db) => {
      // Append the webhook event to pagarme_orders.response_payload?
      // We instead append to a `last_webhook_event` jsonb merge — but our
      // schema only has `response_payload`. For Phase 1 we DO NOT mutate
      // response_payload (created by createCharge); the audit_log row is
      // the durable webhook trail.

      // Idempotency: if the payment is already in a terminal state, skip
      // the FSM update, audit, and side-effects. Mirrors Plan 01-05 ZapSign
      // webhook idempotency-at-FSM-boundary pattern.
      const currentRows = await db
        .select({ status: payments.status, id: payments.id })
        .from(payments)
        .where(eq(payments.id, resolved.paymentId))
        .limit(1)
      const current = currentRows[0]
      if (!current) {
        log.warn(
          { paymentId: resolved.paymentId },
          'payment row vanished between resolveTenant and withTenant — ignoring',
        )
        return
      }

      if (newStatus === null) {
        // No transition triggered (e.g. an order.viewed-like event). Audit
        // only — keep the trail of what arrived.
        await recordAudit(db, {
          action: 'payment.webhook',
          entity: 'payment',
          entityId: resolved.paymentId,
          userId: '00000000-0000-0000-0000-000000000000',
          payload: {
            event_id: parsed.id,
            event_type: parsed.type,
            order_id: orderId,
            api_status: apiOrder.status,
            api_charge_status: apiCharge?.status ?? null,
            no_transition: true,
          },
        })
        return
      }

      if (TERMINAL_PAYMENT_STATUSES.has(current.status)) {
        // Already terminal — duplicate webhook delivery. No-op. We drop
        // ALL transitions into terminal states (mirrors Plan 01-05 Rule 1
        // idempotency fix) so the side-effects only fire on the FIRST
        // arrival, regardless of what newStatus is.
        return
      }

      // Update payments FSM.
      const updates: Partial<typeof payments.$inferInsert> = {
        status: newStatus,
        updatedAt: new Date(),
      }
      if (newStatus === 'paid') {
        updates.paidAt = new Date()
      }
      await db.update(payments).set(updates).where(eq(payments.id, resolved.paymentId))

      // Append the webhook event into pagarme_orders.response_payload?
      // Phase 1 keeps response_payload immutable (from createCharge) and
      // stores the webhook callback in audit_log only. Phase 2 outbox will
      // introduce a pagarme_inbox table with append-only event history.

      // Audit the transition.
      await recordAudit(db, {
        action: 'payment.webhook',
        entity: 'payment',
        entityId: resolved.paymentId,
        userId: '00000000-0000-0000-0000-000000000000',
        payload: {
          event_id: parsed.id,
          event_type: parsed.type,
          order_id: orderId,
          api_status: apiOrder.status,
          api_charge_status: apiCharge?.status ?? null,
          status_new: newStatus,
        },
      })

      // Side-effect: on the 'paid' transition, enqueue the email job
      // (Plan 01-08 will register the email task handler). Payload shape
      // pinned by tests/lgpd/notifications.test.ts.
      if (newStatus === 'paid') {
        await enqueueJob(rawSqlFromTenantDb(db), EMAIL_STATUS_UPDATE_TASK, {
          tenant_id: resolved.tenantId,
          payment_id: resolved.paymentId,
          event: 'pagamento_recebido',
        })
      }
    })
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'withTenant block failed — returning 400 so Pagar.me retries',
    )
    return NextResponse.json({ error: 'transition_failed' }, { status: 400 })
  }

  log.info(
    {
      orderId,
      paymentId: resolved.paymentId,
      eventType: parsed.type,
      apiStatus: apiOrder.status,
      newStatus,
    },
    'webhook processed',
  )

  return NextResponse.json({ ok: true }, { status: 200 })
}
