// FB_EVENTOS — SSE dedicated LISTEN connection pool (Plan 02-04).
//
// Each SSE client that connects to GET /api/sse/events/[eventId]/lots
// requires a DEDICATED long-lived postgres.js connection that stays in
// LISTEN state for the duration of the HTTP response.
//
// WHY NOT the shared app pool:
//   LISTEN is connection-scoped in Postgres. If the connection returns to
//   the pool and is reused by another request, the LISTEN subscription is
//   silently lost. The dedicated max:1 client is the correct primitive
//   (RESEARCH §Pitfall 4; PATTERNS.md §listen-pool).
//
// CAPACITY:
//   Default cap = 200 concurrent SSE clients (overridable via MAX_SSE_CONN
//   env). Typical Pg server can handle 100-300 additional connections beyond
//   the app pool (depends on PG_MAX_CONNECTIONS). At Trindade piloto scale
//   (<50 concurrent fornecedores), 200 is generous.
//
// OBSERVABILITY:
//   Every new connection emits a Pino info log with the current count.
//   If the count grows unexpectedly, it indicates an abort-signal leak
//   (Pitfall 4 warning sign). The count decrements when conn.end() fires.
//
// SECURITY:
//   The connection uses DATABASE_URL (fb_eventos_app, NOBYPASSRLS). We only
//   LISTEN — no row reads on this connection — so the NOBYPASSRLS constraint
//   is irrelevant here. This is intentional: keeping the LISTEN connection
//   under the app role avoids opening a higher-privilege role to long-lived
//   HTTP connections (T-02-04-06).

import postgres, { type Sql } from 'postgres'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'sse:listen-pool' })

// ---------------------------------------------------------------------------
// Cap
// ---------------------------------------------------------------------------

/**
 * Maximum concurrent SSE LISTEN connections. Requests above the cap receive
 * a 503 Service Unavailable so the Postgres server doesn't get overwhelmed.
 *
 * Overridable in tests via process.env.MAX_SSE_CONN.
 */
export const MAX_SSE_CONN = Number(process.env.MAX_SSE_CONN ?? '200')

let activeCount = 0

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Reserve a dedicated postgres.js connection for LISTEN/NOTIFY.
 *
 * Returns a single-connection Sql client configured with:
 *   - max: 1        — exactly one connection, never returned to a pool
 *   - idle_timeout: 0 — never close for idleness (caller owns lifecycle)
 *   - application_name: 'fb-eventos-sse' — visible in pg_stat_activity
 *
 * Caller MUST call `await conn.end()` when the SSE response closes
 * (Pitfall 4: never let the connection leak). Pattern 3 wires this to
 * req.signal.addEventListener('abort', ...) — see the route handler.
 *
 * @throws {Error} with status 503 if activeCount >= MAX_SSE_CONN.
 */
export async function reservePgListenConnection(): Promise<Sql> {
  if (activeCount >= MAX_SSE_CONN) {
    throw new Error(
      `SSE connection cap reached (MAX_SSE_CONN=${MAX_SSE_CONN}). ` +
        'Try again later or contact the operator to raise the cap.',
    )
  }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const conn = postgres(url, {
    max: 1,
    idle_timeout: 0,
    connection: {
      application_name: 'fb-eventos-sse',
    },
  })

  activeCount++
  log.info({ activeCount }, 'SSE listen connection opened')

  // Wrap .end() to decrement counter when caller cleans up.
  const origEnd = conn.end.bind(conn)
  // biome-ignore lint/suspicious/noExplicitAny: postgres.js end accepts optional options
  ;(conn as any).end = async (...args: any[]) => {
    activeCount = Math.max(0, activeCount - 1)
    log.info({ activeCount }, 'SSE listen connection closed')
    return origEnd(...args)
  }

  return conn
}
