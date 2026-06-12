// FB_EVENTOS — Drizzle DB singleton (Phase 0, Plan 03).
//
// Exports:
//   - `pool`: the raw postgres.js client (DATABASE_URL = fb_eventos_app role).
//     Use this when you need transaction control directly (e.g., the
//     withTenant() wrapper in src/db/with-tenant.ts).
//   - `db`: the Drizzle wrapper around `pool` for non-tenant-scoped reads
//     (tenants table lookup, /api/health probe). Default-deny: any
//     `db.select()` against a tenant-owned table outside a withTenant()
//     block returns 0 rows because the RLS policy's
//     `current_setting('app.current_tenant_id', true)::uuid` evaluates to
//     NULL and the predicate becomes `tenant_id = NULL` (= false for all
//     rows). This is the load-bearing guarantee that protects against
//     forgotten withTenant() calls — verified by tests/db/rls-forced.test.ts.

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import * as schema from './schema'

if (!env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required. See .env.example for the manifest. ' +
      'The runtime app role is fb_eventos_app (NO BYPASSRLS) — ' +
      'never substitute DATABASE_MIGRATOR_URL.',
  )
}

export const pool = postgres(env.DATABASE_URL, { max: 20 })

export const db = drizzle(pool, { schema })

export type DrizzleDB = typeof db
