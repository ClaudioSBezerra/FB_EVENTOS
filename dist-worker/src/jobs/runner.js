"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
const graphile_worker_1 = require("graphile-worker");
const env_1 = require("@/lib/env");
const logger_1 = require("@/lib/logger");
const tasks_1 = require("./tasks");
/**
 * Boot the Graphile-Worker Runner. Returns the Runner instance so callers
 * (currently `scripts/jobs/start-worker.ts`) can attach signal handlers
 * for graceful shutdown.
 */
async function startWorker() {
    logger_1.logger.info({
        component: 'graphile-worker',
        concurrency: 5,
        taskNames: Object.keys(tasks_1.taskList),
    }, 'starting worker');
    const runner = await (0, graphile_worker_1.run)({
        connectionString: env_1.env.DATABASE_URL,
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
        taskList: tasks_1.taskList,
    });
    // Hook the Runner's lifecycle into our structured log channel so the log
    // aggregator can correlate worker start/stop with web-side requests.
    runner.events.on('worker:create', ({ worker }) => {
        logger_1.logger.info({ component: 'graphile-worker', workerId: worker.workerId }, 'worker:create');
    });
    runner.events.on('pool:gracefulShutdown', ({ message }) => {
        logger_1.logger.warn({ component: 'graphile-worker', message }, 'pool:gracefulShutdown');
    });
    return runner;
}
