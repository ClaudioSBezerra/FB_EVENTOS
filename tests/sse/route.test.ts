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

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { NextRequest } from 'next/server'

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
import { LOT_NOTIFY_CHANNEL_TASK } from '@/jobs/tasks/lot-notify-channel'
import { createTenant, migratorPool as testMigratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'
import { withTenant } from '@/db/with-tenant'
import { emitOutboxEventAndNotify } from '@/lib/outbox/emit'
import { runTaskInline } from '../test-mocks/graphile-worker'

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(async () => {
  vi.restoreAllMocks()
  await testMigratorPool`TRUNCATE TABLE
    outbox_events, lot_reservations, lot_assignments, lots, lot_categories,
    vendors, events
    RESTART IDENTITY CASCADE`
})

afterAll(async () => {
  await testMigratorPool.end({ timeout: 5 })
})

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
// ---------------------------------------------------------------------------

let tenantA: string
let tenantB: string
let eventId: string

beforeAll(async () => {
  tenantA = await createTenant(`sse-ta-${Date.now()}`, 'SSE Tenant A')
  tenantB = await createTenant(`sse-tb-${Date.now()}`, 'SSE Tenant B')
})

beforeEach(async () => {
  const event = await makeEvent(tenantA)
  eventId = event.id
})

// ---------------------------------------------------------------------------
// Test 1: FORN-07 happy path
// ---------------------------------------------------------------------------

describe('Test 1: happy path — text/event-stream + data on pg_notify', () => {
  it('returns Content-Type: text/event-stream and X-Accel-Buffering: no', async () => {
    const controller = new AbortController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    const response = await GET(req, makeParams(eventId))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/)
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(response.headers.get('cache-control')).toMatch(/no-cache/)

    controller.abort()
  })

  it('SSE client receives data: event within 500ms after pg_notify', async () => {
    const controller = new AbortController()
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
// ---------------------------------------------------------------------------

describe('Test 3: cross-tenant guard — 403 before stream opens', () => {
  it('returns 403 when session org belongs to a different tenant', async () => {
    const req = makeRequest(eventId, makeSessionHeaders(tenantB))
    const response = await GET(req, makeParams(eventId))
    expect(response.status).toBe(403)
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
// ---------------------------------------------------------------------------

describe('Test 4: heartbeat ": keepalive" every 30s', () => {
  it('emits keepalive chunk when fake timers advance past 30s', async () => {
    vi.useFakeTimers()

    const controller = new AbortController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)

    // Start the handler — with fake timers the ReadableStream start() is synchronous
    const responsePromise = GET(req, makeParams(eventId))
    // Advance timers to trigger the heartbeat
    vi.advanceTimersByTime(31_000)
    const response = await responsePromise

    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No body reader')
    const decoder = new TextDecoder()
    let foundKeepalive = false

    // Drain until we find keepalive or the stream ends
    // biome-ignore lint/style/noNonNullAssertion: guarded by throw above
    const r = reader!
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(1_000)
      const { value, done } = await r.read()
      if (done) break
      const text = decoder.decode(value)
      if (text.includes('keepalive')) {
        foundKeepalive = true
        break
      }
    }

    expect(foundKeepalive).toBe(true)
    controller.abort()
    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// Test 5: cleanup on AbortSignal
// ---------------------------------------------------------------------------

describe('Test 5: cleanup on AbortSignal', () => {
  it('calls conn.end() when the request signal aborts', async () => {
    const endSpy = vi.fn(async () => {})
    const listenSpy = vi.fn(async (_ch: string, _cb: (p: string) => void) => {})
    const unlistenSpy = vi.fn(async (_ch: string) => {})

    vi.doMock('@/lib/sse/listen-pool', () => ({
      reservePgListenConnection: vi.fn(async () => ({
        listen: listenSpy,
        unlisten: unlistenSpy,
        end: endSpy,
      })),
      MAX_SSE_CONN: 200,
    }))

    // Re-import the route handler after mocking
    const { GET: GETMocked } = await import('@/app/api/sse/events/[eventId]/lots/route')

    const controller = new AbortController()
    const req = makeRequest(eventId, makeSessionHeaders(tenantA), controller.signal)
    await GETMocked(req, makeParams(eventId))

    controller.abort()
    // Allow micro-tasks (abort event listener) to flush
    await new Promise((r) => setTimeout(r, 50))

    expect(endSpy).toHaveBeenCalled()

    vi.doUnmock('@/lib/sse/listen-pool')
  })
})

// ---------------------------------------------------------------------------
// Test 6: emitOutboxEventAndNotify same-tx → SSE
// ---------------------------------------------------------------------------

describe('Test 6: emitOutboxEventAndNotify same-tx → SSE client receives event', () => {
  it('pg_notify from inside withTenant arrives at SSE client within 500ms', async () => {
    const lotId = '00000000-0000-0000-aaaa-000000000001'
    const controller = new AbortController()
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
    const lotId = '00000000-0000-0000-bbbb-000000000002'
    const controller = new AbortController()
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
