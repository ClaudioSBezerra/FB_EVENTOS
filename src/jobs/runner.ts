// FB_EVENTOS — Graphile-Worker runner bootstrap (Phase 0, Plan 06 — FOUND-14).
//
// `startWorker()` boots a Graphile-Worker `Runner` that:
//   - Connects to Postgres via the APP role (DATABASE_URL = fb_eventos_app).
//     Note: schema bootstrap (graphile_worker.* tables/functions) is run
//     once at install time by the MIGRATOR role inside migration 0008's
//     companion path — see src/db/migrations/0008_graphile_worker_install.sql
//     header. After bootstrap, the app role only needs DML privileges
//     (granted via ALTER DEFAULT PRIVILEGES in 0008).
//   - Loads the task map from `src/jobs/tasks/index.ts`.
//   - Runs with concurrency 5 (single-instance Coolify pilot — Phase 4
//     revisit per ADR-0001 when multi-instance becomes a requirement).
//
// ─────────────────────────────────────────────────────────────────────────
// PROCESS BOUNDARY (RESEARCH Pitfall 8 — load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// This module DOES NOT start the worker as a side-effect. It exports a
// function which is called by `scripts/jobs/start-worker.ts` — a SEPARATE
// Node process from the Next.js web server. Reasons:
//
//   1. Worker uptime is decoupled from web uptime — a long PDF-generation
//      job does not freeze Next.js hot-reload during dev.
//   2. The worker's pg pool is independent from the web's pg pool — no
//      pool exhaustion contagion.
//   3. Coolify can scale them independently (Plan 07 deploy config).
//
// CRITICAL: every Task that reads tenant-owned tables MUST call
// `withTenant(tenantId, fn)` itself — the worker's pg connection has NO
// app.current_tenant_id set by the runner. Without withTenant() the
// task sees RLS default-deny (0 rows) — proven by
// tests/jobs/worker-without-with-tenant.test.ts.
//
// Tasks should extract the tenantId from the job payload (Server Actions
// MUST include tenantId in every payload they enqueue from a tenant-scoped
// context — Phase 2 outbox pattern enforces this).

import { type Runner, run } from 'graphile-worker'
import postgres from 'postgres'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

import { taskList } from './tasks'

/**
 * After graphile-worker creates its schema + tables (on first run), invoke
 * the helper from migration 0009 to attach the `fb_eventos_app_full_access`
 * RLS policy on every graphile_worker.* table. Without this, fb_app_user
 * loses visibility on its own queue once Postgres RLS kicks in via the
 * NOBYPASSRLS contract — proven by tests/jobs/worker-without-with-tenant.test.ts.
 *
 * Uses DATABASE_MIGRATOR_URL because the helper function is owned by
 * fb_eventos_migrator. Connection is one-shot (max 1, close immediately).
 */
async function ensureGraphileWorkerPolicies(): Promise<void> {
  const migratorUrl = env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) {
    logger.warn(
      { component: 'graphile-worker' },
      'DATABASE_MIGRATOR_URL not set — skipping RLS policy install. Worker may fail to read its queue.',
    )
    return
  }
  const sql = postgres(migratorUrl, { max: 1 })
  try {
    await sql`SELECT fb_install_graphile_worker_policies()`
    logger.info({ component: 'graphile-worker' }, 'graphile_worker RLS policies attached')
  } catch (err) {
    logger.warn(
      { component: 'graphile-worker', err: err instanceof Error ? err.message : String(err) },
      'install_graphile_worker_policies failed (function may not exist yet — run migrations)',
    )
  } finally {
    await sql.end({ timeout: 2 })
  }
}

/**
 * Boot the Graphile-Worker Runner. Returns the Runner instance so callers
 * (currently `scripts/jobs/start-worker.ts`) can attach signal handlers
 * for graceful shutdown.
 */
export async function startWorker(): Promise<Runner> {
  logger.info(
    {
      component: 'graphile-worker',
      concurrency: 5,
      taskNames: Object.keys(taskList),
    },
    'starting worker',
  )

  // Step 1: bootstrap graphile_worker schema using migrator role (BYPASSRLS,
  // CREATEDB). Without this the runner.run() call below fails with
  // "permission denied for database fb_eventos_dev" when graphile-worker
  // tries to CREATE SCHEMA graphile_worker as fb_app_user. We open a
  // one-shot worker that immediately stops — its only purpose is to trigger
  // graphile-worker's bundled bootstrap SQL with elevated privileges.
  const migratorUrl = env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_MIGRATOR_URL
  if (migratorUrl) {
    logger.info(
      { component: 'graphile-worker' },
      'bootstrapping graphile_worker schema via migrator role',
    )
    const bootstrapRunner = await run({
      connectionString: migratorUrl,
      taskList: { __bootstrap: async () => {} },
      concurrency: 1,
    })
    await bootstrapRunner.stop()
    // Step 2: attach RLS policies so fb_app_user can read its own queue.
    await ensureGraphileWorkerPolicies()
  }

  // Step 3: start the real runner as fb_app_user (NOBYPASSRLS — Phase 0 contract).
  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 5,
    // Auto-install the graphile_worker schema if missing. Migration 0008
    // is a no-op safety net plus default-privileges hook; the actual table
    // create lives in graphile-worker's bundled SQL. In production this
    // runs once on first deploy (idempotent on subsequent boots).
    noHandleSignals: false,
    // Phase 2 (Plan 02-03): populate crontab with recurring jobs.
    //   - reservation.expire: every minute (AM-03 — 1 min is graphile-worker minimum).
    //     Releases lot_reservations rows where expires_at < now() AND released_at IS NULL.
    //   - outbox.drain: registered in Plan 02-06 (outbox drain handler).
    // Graphile-worker crontab format: "* * * * * taskIdentifier [options]"
    crontab: '* * * * * reservation.expire\n',
    taskList,
  })

  // Hook the Runner's lifecycle into our structured log channel so the log
  // aggregator can correlate worker start/stop with web-side requests.
  runner.events.on('worker:create', ({ worker }) => {
    logger.info({ component: 'graphile-worker', workerId: worker.workerId }, 'worker:create')
  })
  runner.events.on('pool:gracefulShutdown', ({ message }) => {
    logger.warn({ component: 'graphile-worker', message }, 'pool:gracefulShutdown')
  })

  return runner
}
