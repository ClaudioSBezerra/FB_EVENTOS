// FB_EVENTOS — Migrator postgres.js pool (Phase 1, Plan 01-05 Task 3).
//
// The runtime app role (fb_eventos_app) is NOBYPASSRLS. A small set of
// code paths legitimately need to read tenant-owned tables BEFORE a
// session/withTenant boundary exists — most notably the ZapSign webhook
// handler at /api/webhooks/zapsign which receives an opaque token and
// must resolve tenant_id from zapsign_documents to enter withTenant().
//
// The cleanest mechanism for that lookup is a BYPASSRLS pool keyed to
// the fb_eventos_migrator role (which Phase 0 already grants the
// privileges to read every domain table). This module exports that
// pool as `migratorPool` — DO NOT use it for any write that should be
// tenant-scoped (use withTenant + appPool for those).
//
// USAGE SCOPE:
//   - Webhook tenant resolution (zapsign_documents → tenant_id).
//   - Future: schedule/cron jobs that need cross-tenant aggregates.
//   - CI/test fixtures (separate `test/db.ts` already imports its own
//     migratorPool — this module is purely for production code).
//
// SAFETY: this module exists in src/db/ — a Server Component or Route
// Handler that imports it accepts the responsibility for bypass. Lint
// rules / CODEOWNERS reviewer responsibility.

import postgres from 'postgres'
import { env } from '@/lib/env'

if (env.NODE_ENV !== 'test' && !env.DATABASE_MIGRATOR_URL) {
  // In production we MUST have a migrator URL to power the webhook tenant
  // lookup. In test the URL is read from process.env via setup.ts.
  throw new Error(
    'DATABASE_MIGRATOR_URL is required for the webhook tenant-resolution pool. ' +
      'Configure it via Coolify env (Plan 07) or .env.local.',
  )
}

// Small pool — webhook traffic is low volume, and we want to limit
// concurrent BYPASSRLS connections by construction.
export const migratorPool = postgres(
  env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_MIGRATOR_URL ?? '',
  { max: 4 },
)
