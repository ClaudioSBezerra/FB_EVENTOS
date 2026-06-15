// FB_EVENTOS — Pagar.me webhook handler (Phase 2, Plan 02-05 refactor).
//
// Phase 1 used Basic Auth + synchronous belt-and-suspenders re-fetch.
// Phase 2 replaces both with:
//
//   1. HMAC-SHA256 verification (FORN-11, T-02-05-01).
//      - Read body as raw bytes BEFORE json() — prevents any body
//        normalization that would break HMAC (Pitfall 1: "raw body first").
//      - Header: X-Hub-Signature (PAGARME_HMAC_HEADER_NAME — AM-02 default;
//        probe pending at tests/probes/pagarme-hmac-header-probe.test.ts).
//      - Signature is base64(HMAC-SHA256(secret, rawBody)).
//      - Wrong/missing HMAC → 401.
//
//   2. Inbox idempotency (FORN-10, T-02-05-02..03):
//      - INSERT INTO payment_webhooks_inbox ... ON CONFLICT DO NOTHING.
//      - Duplicate delivery → 200 with { ok: true, duplicate: true }.
//
//   3. Enqueue background job (payment FSM via graphile-worker).
//      - The handler does NOT call Pagar.me API — the worker does (FORN-12).
//      - Belt-and-suspenders re-fetch moved to the worker (D-13).
//
// PERFORMANCE TARGET (FORN-12): handler MUST complete in <100ms p95.
//   Achieved by: raw body read → HMAC verify → cross-tenant lookup →
//   inbox INSERT → enqueue → return 200. No external HTTP calls.
//
// TENANT RESOLUTION:
//   Resolve tenant_id from payments.gateway_order_id via migratorPool
//   (BYPASSRLS) BEFORE entering any tenant-scoped transaction.
//
// SECURITY (ADR-0005):
//   HMAC is belt-and-suspenders over the webhook channel. The worker
//   additionally re-fetches the order from Pagar.me before applying
//   any FSM transition (D-13).
//
// REFERENCES:
//   - 02-CONTEXT.md D-14 (inbox idempotency), D-13 (re-fetch in worker)
//   - docs/adr/0005-webhook-hmac-strategy.md
//   - src/lib/pagarme/hmac.ts (verifyWebhookSignature)
//   - src/db/schema/payment_webhooks_inbox.ts

import { type NextRequest, NextResponse } from 'next/server'

import { pool } from '@/db'
import { migratorPool } from '@/db/migrator-pool'
import { enqueueJob } from '@/jobs/enqueue'
import { PAYMENT_PROCESS_WEBHOOK_TASK } from '@/jobs/tasks/payment-process-webhook'
import { logger } from '@/lib/logger'
import { PAGARME_HMAC_HEADER_NAME, verifyWebhookSignature } from '@/lib/pagarme/hmac'
import { pagarmeWebhookEventSchema } from '@/lib/pagarme/types'

const log = logger.child({ component: 'webhook.pagarme' })

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
// POST handler
// ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Step 1: Read raw body bytes BEFORE json() ───────────────────────────
  // PITFALL 1 (load-bearing): body must be consumed as raw bytes for HMAC
  // verification. Calling req.json() first causes Node to normalize the body
  // (re-serialize, compact whitespace) which changes the byte sequence and
  // breaks the HMAC. We read the ArrayBuffer first, then decode to string.
  const rawBuffer = await req.arrayBuffer()
  const rawBody = Buffer.from(rawBuffer)

  // ── Step 2: HMAC-SHA256 verification (FORN-11) ──────────────────────────
  const sigHeader = req.headers.get(PAGARME_HMAC_HEADER_NAME)
  const hmacSecret = process.env.PAGARME_WEBHOOK_SIGNING_SECRET

  if (hmacSecret) {
    if (!verifyWebhookSignature(rawBody, sigHeader, hmacSecret)) {
      log.warn(
        { header: PAGARME_HMAC_HEADER_NAME, hasHeader: !!sigHeader },
        'HMAC signature verification failed',
      )
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  } else {
    // Fallback: Basic Auth compat (Phase 1 — only when HMAC secret not set).
    // In production, PAGARME_WEBHOOK_SIGNING_SECRET MUST be configured.
    const expectedUser = process.env.PAGARME_WEBHOOK_USER
    const expectedPass = process.env.PAGARME_WEBHOOK_PASS
    if (expectedUser && expectedPass) {
      const authHeader = req.headers.get('authorization')
      if (!authHeader?.startsWith('Basic ')) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
      try {
        const decoded = Buffer.from(authHeader.slice('Basic '.length), 'base64').toString('utf8')
        const idx = decoded.indexOf(':')
        const user = idx >= 0 ? decoded.slice(0, idx) : ''
        const pass = idx >= 0 ? decoded.slice(idx + 1) : ''
        if (user !== expectedUser || pass !== expectedPass) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
        }
      } catch {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    } else {
      // Neither secret configured — allow in dev with a warning.
      log.warn('PAGARME_WEBHOOK_SIGNING_SECRET not set — auth skipped (dev only)')
    }
  }

  // ── Step 3: Parse + validate payload ────────────────────────────────────
  let parsed: ReturnType<typeof pagarmeWebhookEventSchema.parse>
  try {
    const bodyText = rawBody.toString('utf8')
    const rawJson = JSON.parse(bodyText) as unknown
    parsed = pagarmeWebhookEventSchema.parse(rawJson)
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'invalid webhook payload')
    return NextResponse.json({ ok: true, ignored: 'invalid_payload' }, { status: 200 })
  }

  // ── Step 4: Extract order id ─────────────────────────────────────────────
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

  // ── Step 5: Resolve tenant ───────────────────────────────────────────────
  const resolved = await resolveTenantForOrderId(orderId)
  if (!resolved) {
    log.warn({ orderId }, 'no payments row for order_id — ignoring')
    return NextResponse.json({ ok: true, ignored: 'unknown_order' }, { status: 200 })
  }

  // ── Step 6: Inbox INSERT + enqueue (single appPool transaction) ──────────
  // INSERT INTO payment_webhooks_inbox ... ON CONFLICT DO NOTHING.
  // gateway_event_id is the TEXT PRIMARY KEY — duplicate events hit the
  // CONFLICT clause and return 0 rows (duplicate detected).
  //
  // payment_webhooks_inbox has FORCE RLS with tenant_isolation policy (TO
  // fb_eventos_app). The main `pool` uses the fb_eventos_app role — we must
  // SET LOCAL app.current_tenant_id so the RLS CHECK constraint passes.
  // graphile_worker.add_job is GRANTed EXECUTE to fb_eventos_app (verified
  // in Plan 06 probe), so the enqueue happens in the same transaction.
  try {
    const result = await pool.begin(async (tx) => {
      // Set the tenant context for FORCE RLS on payment_webhooks_inbox.
      await tx`SELECT set_config('app.current_tenant_id', ${resolved.tenantId}, true)`

      // a. INSERT into inbox with ON CONFLICT DO NOTHING.
      const inboxRows = await tx<Array<{ gateway_event_id: string }>>`
        INSERT INTO payment_webhooks_inbox
          (gateway_event_id, tenant_id, event_type, payload)
        VALUES (
          ${parsed.id},
          ${resolved.tenantId}::uuid,
          ${parsed.type},
          ${JSON.stringify(parsed)}::jsonb
        )
        ON CONFLICT (gateway_event_id) DO NOTHING
        RETURNING gateway_event_id
      `

      if (inboxRows.length === 0) {
        // Duplicate delivery — return null signal.
        return null
      }

      // b. Enqueue the background worker inside the SAME transaction.
      //    Atomic: if either fails, both roll back.
      await enqueueJob(tx, PAYMENT_PROCESS_WEBHOOK_TASK, {
        tenant_id: resolved.tenantId,
        payment_id: resolved.paymentId,
        gateway_event_id: parsed.id,
        order_id: orderId,
        event_type: parsed.type,
      })

      return inboxRows[0]?.gateway_event_id ?? null
    })

    if (result === null) {
      // Duplicate delivery — idempotency handled.
      log.info({ eventId: parsed.id, orderId }, 'duplicate webhook delivery — skipping')
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 })
    }
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), eventId: parsed.id },
      'inbox INSERT or enqueue failed — returning 400 for Pagar.me retry',
    )
    return NextResponse.json({ error: 'inbox_or_enqueue_failed' }, { status: 400 })
  }

  log.info(
    { orderId, eventId: parsed.id, type: parsed.type, tenantId: resolved.tenantId },
    'webhook accepted — worker enqueued',
  )

  return NextResponse.json({ ok: true }, { status: 200 })
}
