// FB_EVENTOS — FORN-07: SSE Route Handler + pg_notify fan-out (Plan 02-04).
//
// Integration tests for GET /api/sse/events/[eventId]/lots:
//   Test 1: SSE headers (text/event-stream, X-Accel-Buffering: no) + data on pg_notify
//   Test 2: Auth guard — 401 without session
//   Test 3: Cross-tenant guard — 403 before stream opens
//   Test 4: Heartbeat — ": keepalive" emitted every 30s
//   Test 5: AbortSignal cleanup — conn.end() called on disconnect
//   Test 6: emitOutboxEventAndNotify same-tx path (FORN-13 + FORN-07)
//   Test 7: lot.notify-channel outbox-drain handler fan-out

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Auth mock (must be before any import of @/auth/server)
//
// vi.mock hoists to the top of the file, so this block runs before any
// module that imports auth. The mock checks a custom "x-session-tenant"
// header to decide what session to return.
// ---------------------------------------------------------------------------

vi.mock('@/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers }) => {
        const cookie = headers.get('cookie') ?? ''
        if (!cookie.includes('better-auth.session_token=')) return null
        const tenantId = headers.get('x-session-tenant')
        if (!tenantId) return null
        return {
          user: { id: 'user-test-id', email: 'test@example.com' },
          session: {
            id: 'session-test-id',
            token: 'test-token',
            activeOrganizationId: tenantId,
          },
        }
      }),
    },
  },
}))

import { GET } from '@/app/api/sse/events/[eventId]/lots/route'
import { withTenant } from '@/db/with-tenant'
import { LOT_NOTIFY_CHANNEL_TASK } from '@/jobs/tasks/lot-notify-channel'
import { emitOutboxEventAndNotify } from '@/lib/outbox/emit'
import { createTenant, migratorPool as testMigratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { runTaskInline } from '../test-mocks/graphile-worker'

// ---------------------------------------------------------------------------
// Teardown
//
// IMPORTANT: Every SSE test must abort its AbortController to close the LISTEN
// connection. If a connection leaks, subsequent beforeEach calls may block
// waiting for DB connection slots. The tracker below ensures cleanup.
// ---------------------------------------------------------------------------

const openControllers: AbortController[] = []

function trackedController(): AbortController {
  const c = new AbortController()
  openControllers.push(c)
  return c
}

afterEach(async () => {
  // Abort any controllers that weren't cleaned up in the test
  for (const c of openControllers) {
    if (!c.signal.aborted) c.abort()
  }
  openControllers.length = 0

  // Give LISTEN connection teardown time to complete
  await new Promise((r) => setTimeout(r, 100))

  vi.restoreAllMocks()
  await testMigratorPool`TRUNCATE TABLE
    outbox_events, lot_reservations, lot_assignments, lots, lot_categories,
    vendors, events
    RESTART IDENTITY CASCADE`
}, 15_000)

// afterAll: test pools are closed by src/test/setup.ts global afterAll

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSessionHeaders(tenantId: string): Headers {
  return new Headers({
    cookie: 'better-auth.session_token=test-token',
    'x-session-tenant': tenantId,
  })
}

function makeRequest(eventId: string, headers: Headers, signal?: AbortSignal): NextRequest {
  return new NextRequest(`http://localhost:3000/api/sse/events/${eventId}/lots`, {
    headers,
    signal,
  })
}

function makeParams(eventId: string) {
  return { params: Promise.resolve({ eventId }) }
}

/** Read chunks from a SSE response until a chunk containing `contains` is found, or timeout. */
async function waitForSseChunk(
  response: Response,
  contains: string,
  timeoutMs = 1000,
): Promise<string> {
  const readerMaybe = response.body?.getReader()
  if (!readerMaybe) throw new Error('No body reader on SSE response')
  // Capture in a non-optional variable so TypeScript closure analysis is happy.
  // biome-ignore lint/style/noNonNullAssertion: guarded by throw above
  const reader: ReadableStreamDefaultReader<Uint8Array> = readerMaybe!
  const decoder = new TextDecoder()
  const seen: string[] = []

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reader.cancel().catch(() => {})
      reject(
        new Error(
          `waitForSseChunk: timed out after ${timeoutMs}ms looking for "${contains}".\n` +
            `Received:\n${seen.join('\n---\n')}`,
        ),
      )
    }, timeoutMs)

    async function pump() {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          seen.push(chunk)
          if (chunk.includes(contains)) {
            clearTimeout(timer)
            reader.cancel().catch(() => {})
            resolve(chunk)
            return
          }
        }
        clearTimeout(timer)
        reject(new Error(`Stream ended without finding: ${contains}`))
      } catch (e) {
        clearTimeout(timer)
        reject(e)
      }
    }
    void pump()
  })
}

// ---------------------------------------------------------------------------
// Shared state
//
// NOTE: createTenant + events must be in beforeEach (not beforeAll) because
// the global afterEach in src/test/setup.ts truncates the tenants table.
// Any tenant created in beforeAll is wiped after the first test.
// ---------------------------------------------------------------------------

let tenantA: string
let tenantB: string
let eventId: string

beforeEach(async () => {
  const ts = Date.now()
  tenantA = await createTenant(`sse-ta-${ts}`, 'SSE Tenant A')
  tenantB = await createTenant(`sse-tb-${ts}-b`, 'SSE Tenant B')
  const event = await makeEvent(tenantA)
  eventId = event.id
})

// ---------------------------------------------------------------------------
// Test 1: FORN-07 happy path
// ---------------------------------------------------------------------------

describe('Test 1: happy path — text/event-stream + data on pg_notify', () => {
  it('returns Content-Type: text/event-stream and X-Accel-Buffering: no', async () => {
    const controller = trackedController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    const response = await GET(req, makeParams(eventId))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(response.headers.get('cache-control')).toMatch(/no-cache/)

    controller.abort()
  })

  it('SSE client receives data: event within 500ms after pg_notify', async () => {
    const controller = trackedController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    const response = await GET(req, makeParams(eventId))
    expect(response.status).toBe(200)

    // Give LISTEN time to register
    await new Promise((r) => setTimeout(r, 150))

    const channel = `event:${eventId}:lots`
    const notifyPayload = JSON.stringify({
      lot_id: 'lot-abc',
      new_status: 'reserved',
      event_id: eventId,
    })
    await testMigratorPool`SELECT pg_notify(${channel}, ${notifyPayload})`

    const chunk = await waitForSseChunk(response, '"lot_id":"lot-abc"', 1000)
    expect(chunk).toContain('data:')
    expect(chunk).toContain('"new_status":"reserved"')

    controller.abort()
  })
})

// ---------------------------------------------------------------------------
// Test 2: auth — 401 without session
// ---------------------------------------------------------------------------

describe('Test 2: auth guard — 401 without session', () => {
  it('returns 401 when no session cookie is present', async () => {
    const req = makeRequest(eventId, new Headers())
    const response = await GET(req, makeParams(eventId))
    expect(response.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Test 3: cross-tenant guard
//
// DEVIATION NOTE: The plan specifies 403 for cross-tenant access. However,
// the events table has FORCE RLS with only an fb_eventos_app-targeted policy;
// the migratorPool cannot see events without tenant context. The handler
// therefore uses session-first flow: derive tenant from session, then verify
// event exists in THAT tenant scope. Cross-tenant attempts look identical
// to "event not found in this tenant" — returning 404 in both cases is MORE
// secure (doesn't reveal tenant data ownership to unauthorized callers).
// This is Rule 2 auto-fix: tighter security over the plan's 403 aspiration.
// ---------------------------------------------------------------------------

describe('Test 3: cross-tenant / not-found guard — before stream opens', () => {
  it('returns 4xx when session org belongs to a different tenant (event invisible)', async () => {
    const req = makeRequest(eventId, makeSessionHeaders(tenantB))
    const response = await GET(req, makeParams(eventId))
    // 404 because event is invisible in tenantB's scope (RLS scopes to tenant)
    // A 403 is also acceptable here if the implementation can determine the
    // event belongs to a different tenant.
    expect([403, 404]).toContain(response.status)
  })

  it('returns 404 when eventId does not exist', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000'
    const req = makeRequest(nonExistentId, makeSessionHeaders(tenantA))
    const response = await GET(req, makeParams(nonExistentId))
    expect(response.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Test 4: heartbeat
//
// Strategy: Set SSE_HEARTBEAT_MS=100 so the interval fires quickly in tests.
// Use real timers (no fake timers) to avoid interference with postgres.js.
// ---------------------------------------------------------------------------

describe('Test 4: heartbeat ": keepalive" every 30s', () => {
  it('emits keepalive chunk within 500ms when interval is 100ms', async () => {
    // Override heartbeat interval for this test
    process.env.SSE_HEARTBEAT_MS = '100'

    const controller = trackedController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    const response = await GET(req, makeParams(eventId))
    expect(response.status).toBe(200)

    // The heartbeat fires every 100ms — wait for it
    const chunk = await waitForSseChunk(response, 'keepalive', 1000)
    expect(chunk).toContain(': keepalive')

    controller.abort()
    // Give cleanup time to run
    await new Promise((r) => setTimeout(r, 100))

    delete process.env.SSE_HEARTBEAT_MS
  }, 10_000)
})

// ---------------------------------------------------------------------------
// Test 5: cleanup on AbortSignal
//
// Strategy: Open a real SSE stream, capture the underlying postgres.js Sql
// connection returned by reservePgListenConnection(), spy on its .end()
// method, then abort the request and verify .end() was called.
// ---------------------------------------------------------------------------

import * as listenPoolModule from '@/lib/sse/listen-pool'

describe('Test 5: cleanup on AbortSignal', () => {
  it('calls conn.end() when the request signal aborts', async () => {
    // Track the connection returned by the real reservePgListenConnection
    let capturedEndSpy: ReturnType<typeof vi.fn> | null = null
    const originalReserve = listenPoolModule.reservePgListenConnection

    vi.spyOn(listenPoolModule, 'reservePgListenConnection').mockImplementation(async () => {
      const conn = await originalReserve()
      // Spy on the .end() method of the real connection
      capturedEndSpy = vi.spyOn(conn, 'end' as never)
      return conn
    })

    const controller = trackedController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    const response = await GET(req, makeParams(eventId))
    expect(response.status).toBe(200)

    // Wait for LISTEN to be established
    await new Promise((r) => setTimeout(r, 150))

    // Abort the request
    controller.abort()

    // Give the abort event handler time to execute
    await new Promise((r) => setTimeout(r, 200))

    expect(capturedEndSpy).not.toBeNull()
    expect(capturedEndSpy).toHaveBeenCalled()

    vi.restoreAllMocks()
  }, 10_000)
})

// ---------------------------------------------------------------------------
// Test 6: emitOutboxEventAndNotify same-tx → SSE
// ---------------------------------------------------------------------------

describe('Test 6: emitOutboxEventAndNotify same-tx → SSE client receives event', () => {
  it('pg_notify from inside withTenant arrives at SSE client within 500ms', async () => {
    const lotId = '00000000-0000-4000-8000-000000000001'
    const controller = trackedController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    const response = await GET(req, makeParams(eventId))
    expect(response.status).toBe(200)

    await new Promise((r) => setTimeout(r, 150))

    await withTenant(tenantA, async (db) => {
      await emitOutboxEventAndNotify(db, 'lot.status_changed', {
        event_id: eventId,
        lot_id: lotId,
        new_status: 'reserved',
      })
    })

    const chunk = await waitForSseChunk(response, lotId, 1000)
    expect(chunk).toContain('"new_status":"reserved"')
    expect(chunk).toContain(`"event_id":"${eventId}"`)

    controller.abort()
  })
})

// ---------------------------------------------------------------------------
// Test 7: lot.notify-channel outbox handler → SSE fan-out
// ---------------------------------------------------------------------------

describe('Test 7: lot.notify-channel outbox handler fan-out', () => {
  it('runTaskInline LOT_NOTIFY_CHANNEL_TASK → SSE client receives event', async () => {
    const lotId = '00000000-0000-4000-8000-000000000002'
    const controller = trackedController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    const response = await GET(req, makeParams(eventId))
    expect(response.status).toBe(200)

    await new Promise((r) => setTimeout(r, 150))

    await runTaskInline(LOT_NOTIFY_CHANNEL_TASK, {
      tenant_id: tenantA,
      event_id: eventId,
      lot_id: lotId,
      new_status: 'sold',
    })

    const chunk = await waitForSseChunk(response, lotId, 1000)
    expect(chunk).toContain('"new_status":"sold"')
    expect(chunk).toContain(`"event_id":"${eventId}"`)

    controller.abort()
  })
})
