// FB_EVENTOS — SSE Route Handler: GET /api/sse/events/[eventId]/lots
// (Plan 02-04, FORN-07).
//
// Opens a long-lived Server-Sent Events stream for a fornecedor browsing
// the floor-plan buyer mode. When another fornecedor reserves (or releases)
// a lot in the same tenant + event, this handler forwards the pg_notify
// message as an SSE `data:` frame within ≤500 ms — no page refresh needed.
//
// ARCHITECTURE (RESEARCH §Pattern 3 + CONTEXT AM-03):
//   1. Auth check: Better Auth session required. No session → 401.
//   2. Tenant from session: fetchTenantIdForOrg(activeOrganizationId).
//      No tenant found → 403. Queries the `tenants` table (no RLS) — safe.
//   3. Event existence check: inside withTenant(tenantId) verify the event
//      exists. Not found within tenant scope → 404.
//   4. Open ReadableStream with:
//      - 30-second heartbeat (`: keepalive\n\n`) to keep Traefik alive.
//      - reservePgListenConnection() → dedicated max:1 postgres.js client.
//      - conn.listen(`event:${eventId}:lots`, cb) → SSE `data:` frames.
//      - req.signal.addEventListener('abort', cleanup) → Pitfall 4.
//   5. Returns streaming Response with text/event-stream headers.
//
// WHY withTenant for event lookup (not direct migratorPool query):
//   The `events` table has FORCE RLS with only an fb_eventos_app-targeted
//   policy. The fb_eventos_migrator role has no bypass policy on `events`
//   (unlike lot_reservations which has explicit migrator policies). Using
//   withTenant(tenantId, ...) + db.execute(SELECT id FROM events) correctly
//   scopes the lookup through RLS while avoiding a new migration.
//
// PITFALL 12 (RESEARCH): multiple web instances each LISTEN on the same
// channel. Postgres NOTIFY fans out to ALL listeners automatically — no
// Redis pub/sub coordination needed. ✅
//
// PITFALL 3 (RESEARCH): NOTIFY payload capped at 8000 bytes. We only send
// IDs ({ lot_id, new_status, event_id }) — the client fetches details via
// a Server Action. ✅
//
// PITFALL 4 (RESEARCH): SSE connection leak. req.signal.abort cleanup is
// mandatory — wired below. MAX_SSE_CONN cap enforced by listen-pool. ✅
//
// SECURITY (STRIDE T-02-04-01..T-02-04-06): session check + tenant guard
// happen BEFORE the ReadableStream opens. ✅

import { sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { auth } from '@/auth/server'
import { withTenant } from '@/db/with-tenant'
import { reservePgListenConnection } from '@/lib/sse/listen-pool'
import { fetchTenantIdForOrg } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

// Heartbeat interval in ms. Default 30s; override in tests via
// SSE_HEARTBEAT_MS environment variable (read lazily on each request
// so tests can override it without reloading the module).
function getHeartbeatMs(): number {
  return Number(process.env.SSE_HEARTBEAT_MS ?? '30000')
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const { eventId } = await context.params

  // ── Step 1: Auth ──────────────────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  // ── Step 2: Tenant from session (T-02-04-01) ──────────────────────────────
  // fetchTenantIdForOrg queries the `tenants` table (no RLS) — always safe.
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) {
    return new Response('Forbidden', { status: 403 })
  }
  const tenantId = await fetchTenantIdForOrg(activeOrgId)
  if (!tenantId) {
    return new Response('Forbidden', { status: 403 })
  }

  // ── Step 3: Event exists in this tenant? ──────────────────────────────────
  // Use withTenant so the SELECT goes through RLS (events has FORCE RLS
  // with only an fb_eventos_app-targeted policy — migratorPool cannot see
  // the row without setting tenant context). withTenant sets
  // SET LOCAL app.current_tenant_id = tenantId inside a transaction.
  let eventExists = false
  try {
    await withTenant(tenantId, async (db) => {
      const result = await db.execute<{ found: number }>(sql`
        SELECT 1 AS found FROM events WHERE id = ${eventId}::uuid LIMIT 1
      `)
      // postgres.js through Drizzle returns an iterable result object,
      // not { rows: [...] }. Convert to array to check length.
      const rows = Array.from(result as Iterable<{ found: number }>)
      eventExists = rows.length > 0
    })
  } catch {
    eventExists = false
  }

  if (!eventExists) {
    return new Response('Event not found', { status: 404 })
  }

  // ── Step 4: Open SSE stream ───────────────────────────────────────────────
  const channel = `event:${eventId}:lots`

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      // Heartbeat (default 30s; SSE_HEARTBEAT_MS env override for tests).
      // Pattern 3: `: keepalive\n\n` is a SSE comment (no event type, no data).
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, getHeartbeatMs())

      // Reserve a dedicated long-lived connection for LISTEN.
      // CRITICAL: this connection is NOT returned to the pool (max:1, idle_timeout:0).
      // It lives for the duration of this SSE response and is closed in the abort handler.
      let conn: Awaited<ReturnType<typeof reservePgListenConnection>> | null = null
      try {
        conn = await reservePgListenConnection()
      } catch {
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          /* ignore */
        }
        return
      }

      // Register the LISTEN handler. Postgres will call this cb on every
      // pg_notify on the channel — from any connection, any instance.
      // postgres.js listen() returns a { state, unlisten } object; capture
      // it so we can unsubscribe cleanly on disconnect (Pitfall 4).
      let unlistenFn: (() => Promise<void>) | null = null
      const listenResult = await conn.listen(channel, (payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        } catch {
          /* SSE write failed — stream may already be closed */
        }
      })
      unlistenFn = listenResult.unlisten

      // Last-Event-ID replay (optional Phase 2 polish — defer until needed).
      // const lastEventId = req.headers.get('last-event-id')
      // if (lastEventId) { /* fetch missed events from outbox_events */ }

      // Cleanup on disconnect (Pitfall 4 — mandatory).
      req.signal.addEventListener('abort', async () => {
        clearInterval(heartbeat)
        try {
          if (unlistenFn) await unlistenFn()
        } catch {
          /* ignore */
        }
        try {
          if (conn) await conn.end()
        } catch {
          /* ignore */
        }
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      // text/event-stream is the MIME type the browser EventSource expects.
      'Content-Type': 'text/event-stream',
      // No caching — this is a live stream.
      'Cache-Control': 'no-cache, no-transform',
      // Keep the TCP connection alive for the duration of the stream.
      Connection: 'keep-alive',
      // Disable Nginx/Traefik buffering — SSE frames must be forwarded
      // immediately, not batched (Coolify uses Traefik; harmless if absent).
      'X-Accel-Buffering': 'no',
    },
  })
}
