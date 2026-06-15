// FB_EVENTOS — Vitest global setup (Phase 0, Plan 03).
//
// Loads .env.local so DATABASE_URL + DATABASE_MIGRATOR_URL are present for
// every test. CI provides these via job env (see .github/workflows/ci.yml
// test job) — when .env.local is absent, dotenv silently skips.
//
// Truncate-between-tests: every `afterEach` we DELETE FROM the tenant-owned
// tables and the tenants lookup. The migrator pool is used so RLS doesn't
// block the cleanup (the migrator role is the table owner and inserts via
// SET LOCAL where needed). This is the Phase 0 isolation strategy; Plan 04+
// may layer per-suite test schemas if test count justifies it.

import { existsSync, readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll } from 'vitest'

// Force NODE_ENV=test so the email lib captures messages in memory
// (instead of trying to reach mailpit at localhost:1025) and the Resend
// path stays disabled. Must happen BEFORE env.ts is imported.
// (Cast through `unknown` because NODE_ENV is declared readonly in
// @types/node — runtime assignment is harmless.)
;(process.env as unknown as Record<string, string>).NODE_ENV = 'test'

// Best-effort dotenv: load .env.local if present. CI passes env directly.
if (existsSync('.env.local') && !process.env.DATABASE_URL) {
  const lines = readFileSync('.env.local', 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const [, key, raw] = m
    if (!key || raw === undefined) continue
    const val = raw.replace(/^['"]|['"]$/g, '')
    if (process.env[key] === undefined) process.env[key] = val
  }
}

// Lazy-import to defer connection until env is in place.
let migratorPool: typeof import('./db').migratorPool | null = null

beforeAll(async () => {
  if (!process.env.DATABASE_MIGRATOR_URL) {
    throw new Error(
      'Vitest setup: DATABASE_MIGRATOR_URL is required. ' +
        'Provide it via .env.local for local runs or via job env in CI.',
    )
  }
  // Import after env is hydrated so postgres() reads the right URL.
  const mod = await import('./db')
  migratorPool = mod.migratorPool
  // Sanity: confirm we can talk to Postgres before any test runs.
  await migratorPool`SELECT 1`
  // Ensure graphile_worker RLS policies are applied. Migration 0009 calls
  // fb_install_graphile_worker_policies() once at migration time, but graphile-
  // worker may install new tables after migrations run (e.g., on first worker
  // boot in CI). Re-running the function is idempotent (IF NOT EXISTS guard)
  // and ensures the fb_eventos_app role can call add_job() in tests.
  // Omitting this causes "new row violates row-level security policy for table
  // _private_tasks" in any test that calls enqueueJob (approval, signup, etc).
  await migratorPool`SELECT fb_install_graphile_worker_policies()`
})

afterEach(async () => {
  if (!migratorPool) return
  // CASCADE deletes children (member, session, invitation) when an
  // organization or user is removed. Order is from most-dependent → root.
  await migratorPool`TRUNCATE TABLE
    audit_log, invitation, member, session, organization, consent_records,
    two_factor, verification, account, "user", tenants
    RESTART IDENTITY CASCADE`
})

afterAll(async () => {
  if (!migratorPool) return
  await migratorPool.end({ timeout: 5 })
})
