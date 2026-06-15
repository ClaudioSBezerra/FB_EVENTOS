// FB_EVENTOS — FORN-10: webhook idempotency via payment_webhooks_inbox (Plan 02-05, Task 3).
//
// Tests:
//   1. Same gateway_event_id delivered twice → single inbox row.
//   2. Second delivery returns 200 OK with { ok: true, duplicate: true }.
//   3. Missing order_id in payload → 200 ignored.
//   4. HMAC failure → 401.
//
// Drives POST /api/webhooks/pagarme directly (no network — tests the handler).
// Uses real Postgres for inbox assertions.
// Uses MSW for Pagar.me API mocks (used by the worker, NOT by the handler).

import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

// ────────────────────────────────────────────────────────────────────────────
// Handler import (Next.js Route Handler — tested without HTTP server)
// ────────────────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/webhooks/pagarme/route'

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const HMAC_SECRET = 'whsec_test_dummy_at_least_16_chars'
const HMAC_HEADER = 'X-Hub-Signature'

function signPayload(body: string): string {
  return createHmac('sha256', HMAC_SECRET).update(Buffer.from(body, 'utf8')).digest('base64')
}

function buildWebhookRequest(body: string, opts: { hmac?: boolean } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.hmac !== false) {
    headers[HMAC_HEADER] = signPayload(body)
  }
  return new Request('http://localhost/api/webhooks/pagarme', {
    method: 'POST',
    headers,
    body,
  })
}

function webhookPayload(gatewayEventId: string, orderId: string, type = 'order.paid') {
  return JSON.stringify({
    id: gatewayEventId,
    type,
    data: { id: orderId },
    created_at: new Date().toISOString(),
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture
// ────────────────────────────────────────────────────────────────────────────

interface IdempotencyFixture {
  tenantId: string
  orderId: string
}

async function setupIdempotencyFixture(prefix: string): Promise<IdempotencyFixture> {
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Idempotency Test ${prefix}`)
  await insertUser(`id-u-${stamp}@example.test`, `Idempotency User ${prefix}`)
  await insertOrganization(tenantId, `${stamp}-org`, `Idempotency Org ${prefix}`)

  // Build: event → category → lot → vendor → contract (signed) → payment
  // All inserted via appPool (FORCE RLS requires SET LOCAL).
  const ev = await makeEvent(tenantId)
  const cat = await makeLotCategory(tenantId, ev.id, { baseFixed: 100, perSqmRate: 0 })
  const lot = await makeLot(tenantId, ev.id, cat.id, { areaM2: 1 })
  const vendor = await makeVendor(tenantId, { status: 'approved' })

  const orderId = `or_test_${stamp.replace(/[^a-zA-Z0-9]/g, '_')}`

  // Get contract template version row (pre-seeded by migrations).
  const contract = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    const rows = await tx<Array<{ id: string }>>`
      INSERT INTO contracts (tenant_id, vendor_id, lot_id, event_id, template_version, status)
      VALUES (${tenantId}, ${vendor.id}, ${lot.id}, ${ev.id}, 'fornecedor-stand-v1', 'signed')
      RETURNING id
    `
    return rows[0]!
  })

  // Insert payment via appPool with SET LOCAL (FORCE RLS requires tenant context).
  await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    await tx`
      INSERT INTO payments (tenant_id, contract_id, gateway, gateway_order_id, amount_brl_cents, method, status)
      VALUES (${tenantId}::uuid, ${contract.id}::uuid, 'pagarme', ${orderId}, 50000, 'pix', 'pending')
    `
  })

  return { tenantId, orderId }
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  // Set HMAC secret env for the handler.
  process.env.PAGARME_WEBHOOK_SIGNING_SECRET = HMAC_SECRET
})

afterAll(async () => {
  delete process.env.PAGARME_WEBHOOK_SIGNING_SECRET
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('FORN-10: webhook idempotency via inbox', () => {
  test('same gateway_event_id delivered twice → single inbox row', async () => {
    const fx = await setupIdempotencyFixture('idp-1')
    const eventId = `hook_${Date.now()}_a`
    const body = webhookPayload(eventId, fx.orderId)

    // First delivery.
    const res1 = await POST(buildWebhookRequest(body) as unknown as import('next/server').NextRequest)
    expect(res1.status).toBe(200)
    const json1 = await res1.json() as Record<string, unknown>
    expect(json1.ok).toBe(true)
    expect(json1.duplicate).toBeFalsy()

    // Second delivery (same event id).
    const res2 = await POST(buildWebhookRequest(body) as unknown as import('next/server').NextRequest)
    expect(res2.status).toBe(200)
    const json2 = await res2.json() as Record<string, unknown>
    expect(json2.ok).toBe(true)
    expect(json2.duplicate).toBe(true)

    // Verify only one inbox row exists.
    const rows = await migratorPool<Array<{ count: string }>>`
      SELECT COUNT(*)::text AS count FROM payment_webhooks_inbox WHERE gateway_event_id = ${eventId}
    `
    expect(Number(rows[0]?.count)).toBe(1)
  })

  test('second delivery returns 200 OK with duplicate:true (Pagar.me must not retry)', async () => {
    const fx = await setupIdempotencyFixture('idp-2')
    const eventId = `hook_${Date.now()}_b`
    const body = webhookPayload(eventId, fx.orderId)

    await POST(buildWebhookRequest(body) as unknown as import('next/server').NextRequest)
    const res = await POST(buildWebhookRequest(body) as unknown as import('next/server').NextRequest)

    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json.duplicate).toBe(true)
  })

  test('missing order_id in payload → 200 with ignored:no_order_id', async () => {
    const eventId = `hook_${Date.now()}_c`
    const body = JSON.stringify({ id: eventId, type: 'order.paid', data: { id: 'ch_notanorder' } })
    const res = await POST(buildWebhookRequest(body) as unknown as import('next/server').NextRequest)
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(json.ignored).toBe('no_order_id')
  })
})

describe('FORN-11: webhook HMAC enforcement', () => {
  test('missing HMAC signature → 401', async () => {
    const fx = await setupIdempotencyFixture('hmac-1')
    const body = webhookPayload(`hook_${Date.now()}_d`, fx.orderId)
    const req = buildWebhookRequest(body, { hmac: false })
    const res = await POST(req as unknown as import('next/server').NextRequest)
    expect(res.status).toBe(401)
  })

  test('wrong HMAC signature → 401', async () => {
    const fx = await setupIdempotencyFixture('hmac-2')
    const body = webhookPayload(`hook_${Date.now()}_e`, fx.orderId)
    const headers = new Headers({ 'Content-Type': 'application/json', [HMAC_HEADER]: 'wrong' })
    const req = new Request('http://localhost/api/webhooks/pagarme', {
      method: 'POST',
      headers,
      body,
    })
    const res = await POST(req as unknown as import('next/server').NextRequest)
    expect(res.status).toBe(401)
  })
})
