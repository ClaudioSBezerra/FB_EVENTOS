// FB_EVENTOS — FORN-12: webhook handler p95 < 100ms (Plan 02-05, Task 3).
//
// Tests:
//   1. p95 < 100ms across N=30 deliveries (handler does inbox INSERT +
//      enqueue only — no external HTTP calls in the hot path).
//   2. Handler does NOT call Pagar.me API (only the worker does).
//
// Uses real Postgres. Each delivery has a unique gateway_event_id so
// there are no duplicate-detected early-exits (worst-case path).
//
// NOTE: This test runs against a local Postgres. Latency numbers reflect
// localhost round-trip, not production. The 100ms budget is generous for
// production (which adds ~10ms network overhead) but conservative for
// localhost (which should be <30ms). If this test is flaky in CI due to
// resource contention, increase N or the budget, not relax the assertion.

import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

import { POST } from '@/app/api/webhooks/pagarme/route'

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const HMAC_SECRET = 'whsec_perf_test_dummy_at_least_16'
const HMAC_HEADER = 'X-Hub-Signature'
const N = 30
const P95_BUDGET_MS = 100

function sign(body: string): string {
  return createHmac('sha256', HMAC_SECRET).update(Buffer.from(body, 'utf8')).digest('base64')
}

// ────────────────────────────────────────────────────────────────────────────
// Setup: single fixture shared across all N calls
// ────────────────────────────────────────────────────────────────────────────

let fixtureOrderId: string

beforeAll(async () => {
  process.env.PAGARME_WEBHOOK_SIGNING_SECRET = HMAC_SECRET

  const stamp = `perf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const tenantId = await createTenant(stamp, `Perf Test`)
  await insertUser(`perf-u-${stamp}@example.test`, `Perf User`)
  await insertOrganization(tenantId, `${stamp}-org`, `Perf Org`)

  const ev = await makeEvent(tenantId)
  const cat = await makeLotCategory(tenantId, ev.id, { baseFixed: 100, perSqmRate: 0 })
  const lot = await makeLot(tenantId, ev.id, cat.id, { areaM2: 1 })
  const vendor = await makeVendor(tenantId, { status: 'approved' })

  // Create a signed contract (payments FK requires it).
  const contract = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    const rows = await tx<Array<{ id: string }>>`
      INSERT INTO contracts (tenant_id, vendor_id, lot_id, event_id, template_version, status)
      VALUES (${tenantId}, ${vendor.id}, ${lot.id}, ${ev.id}, 'fornecedor-stand-v1', 'signed')
      RETURNING id
    `
    return rows[0]!
  })

  fixtureOrderId = `or_perf_${stamp.replace(/[^a-zA-Z0-9]/g, '_')}`
  // Insert payment via appPool with SET LOCAL (FORCE RLS requires tenant context).
  await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    await tx`
      INSERT INTO payments (tenant_id, contract_id, gateway, gateway_order_id, amount_brl_cents, method, status)
      VALUES (${tenantId}::uuid, ${contract.id}::uuid, 'pagarme', ${fixtureOrderId}, 10000, 'pix', 'pending')
    `
  })
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

describe(`FORN-12: webhook handler perf — p95 < ${P95_BUDGET_MS}ms across N=${N}`, () => {
  test(
    `p95 latency < ${P95_BUDGET_MS}ms (N=${N} deliveries, unique event IDs)`,
    async () => {
      const latencies: number[] = []

      for (let i = 0; i < N; i++) {
        const eventId = `hook_perf_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`
        const body = JSON.stringify({
          id: eventId,
          type: 'order.paid',
          data: { id: fixtureOrderId },
          created_at: new Date().toISOString(),
        })
        const headers = new Headers({
          'Content-Type': 'application/json',
          [HMAC_HEADER]: sign(body),
        })
        const req = new Request('http://localhost/api/webhooks/pagarme', {
          method: 'POST',
          headers,
          body,
        })

        const t0 = performance.now()
        await POST(req as unknown as import('next/server').NextRequest)
        const t1 = performance.now()
        latencies.push(t1 - t0)
      }

      // Calculate p95.
      latencies.sort((a, b) => a - b)
      const p95Index = Math.floor(N * 0.95)
      const p95 = latencies[p95Index] ?? latencies[latencies.length - 1] ?? 0
      const avg = latencies.reduce((s, v) => s + v, 0) / latencies.length
      const p50 = latencies[Math.floor(N * 0.5)] ?? 0

      console.log(
        `[FORN-12] N=${N} | p50=${p50.toFixed(1)}ms | p95=${p95.toFixed(1)}ms | avg=${avg.toFixed(1)}ms | budget=${P95_BUDGET_MS}ms`,
      )

      expect(p95).toBeLessThan(P95_BUDGET_MS)
    },
    // Test timeout: N × budget × 3 safety margin
    N * P95_BUDGET_MS * 3,
  )

  test('handler returns 200 without calling Pagar.me API (no external HTTP in hot path)', async () => {
    // If the handler called Pagar.me, the request would fail (no MSW server
    // or real API key in test env). A successful 200 response proves the
    // handler didn't call Pagar.me.
    const eventId = `hook_noapicall_${Date.now()}`
    const body = JSON.stringify({
      id: eventId,
      type: 'order.paid',
      data: { id: fixtureOrderId },
      created_at: new Date().toISOString(),
    })
    const headers = new Headers({
      'Content-Type': 'application/json',
      [HMAC_HEADER]: sign(body),
    })
    const req = new Request('http://localhost/api/webhooks/pagarme', {
      method: 'POST',
      headers,
      body,
    })

    const res = await POST(req as unknown as import('next/server').NextRequest)
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    // 200 with ok:true proves handler completed without Pagar.me re-fetch.
    expect(json.ok).toBe(true)
  })
})
