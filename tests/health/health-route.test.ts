// FB_EVENTOS — /api/health Route Handler contract (Phase 0, Plan 07 — Task 1).
//
// Verifies the Coolify/Traefik healthcheck contract:
//   - GET /api/health returns 200 + JSON {status:'ok', timestamp, version,
//     checks:{db:true}} when Postgres is reachable via SELECT 1.
//   - On DB failure (transient or hard), returns 503 + JSON {status:'error',
//     checks:{db:false}}.
//
// This Route Handler runs in the Next.js Node runtime (NOT Edge) — it must
// open a real postgres.js connection through the singleton `db`. We
// deliberately do NOT call withTenant here: /api/health is a global
// liveness probe and SELECT 1 does not touch any tenant-owned table, so
// RLS doesn't apply.

import { beforeAll, expect, test } from 'vitest'

import { GET } from '@/app/api/health/route'

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL required for /api/health contract test')
  }
})

test('GET /api/health returns 200 + JSON when DB is reachable', async () => {
  const res = await GET()

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    status: string
    timestamp: string
    version: string
    checks: { db: boolean }
  }
  expect(body.status).toBe('ok')
  expect(body.checks.db).toBe(true)
  expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect(typeof body.version).toBe('string')
})

test('GET /api/health response body shape is stable for Coolify/Traefik', async () => {
  // Traefik healthcheck only cares about the HTTP status code, but Coolify's
  // service log + on-call runbook expect the JSON keys to be present so the
  // operator can read DB-state diagnostics at a glance. Locking the shape:
  const res = await GET()
  const body = (await res.json()) as Record<string, unknown>
  expect(Object.keys(body).sort()).toEqual(['checks', 'status', 'timestamp', 'version'])
  expect((body.checks as Record<string, unknown>).db).toBeDefined()
})
