// FB_EVENTOS — /api/health Route Handler (Phase 0, Plan 07 — Task 1).
//
// Coolify + Traefik liveness probe.
//
// Contract:
//   GET /api/health
//   200 OK  + { status: 'ok', timestamp, version, checks: { db: true } }
//     when SELECT 1 succeeds on the singleton pool.
//   503 SERVICE UNAVAILABLE + { status: 'error', checks: { db: false } }
//     when SELECT 1 throws.
//
// Why NO withTenant() here:
//   This route is a global liveness probe — it has no tenant context. The
//   query `SELECT 1` does not read any tenant-owned table, so RLS does not
//   apply. The singleton `db` (fb_eventos_app role, NOBYPASSRLS) can run it
//   safely; the worst case under RLS misconfig is that we report `db:false`,
//   which is exactly what the operator needs to see.
//
// `export const dynamic = 'force-dynamic'` ensures the response is never
// cached by Next.js Data Cache — every healthcheck poll must hit the real DB.

import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db } from '@/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface HealthBody {
  status: 'ok' | 'error'
  timestamp: string
  version: string
  checks: { db: boolean }
}

export async function GET(): Promise<NextResponse<HealthBody>> {
  const timestamp = new Date().toISOString()
  const version = process.env.npm_package_version ?? process.env.APP_VERSION ?? 'unknown'

  try {
    await db.execute(sql`SELECT 1`)
    return NextResponse.json<HealthBody>({
      status: 'ok',
      timestamp,
      version,
      checks: { db: true },
    })
  } catch {
    return NextResponse.json<HealthBody>(
      {
        status: 'error',
        timestamp,
        version,
        checks: { db: false },
      },
      { status: 503 },
    )
  }
}
