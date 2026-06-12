// FB_EVENTOS — Node-side instrumentation (Phase 0, Plan 06).
//
// Side-effect module imported from src/instrumentation.ts when
// NEXT_RUNTIME==='nodejs'. Responsibilities:
//
//   1. Emit a "server-init" log line via Pino so the very first request can
//      be traced back to a known boot timestamp + Node version + TZ.
//   2. (Implicit) Trigger Sentry server SDK load via the next.config.ts
//      withSentryConfig() wrapper which auto-loads sentry.server.config.ts.
//
// NOTE: The Graphile-Worker runtime bootstrap LIVES IN A SEPARATE PROCESS
// (scripts/jobs/start-worker.ts, run as a separate Coolify service — Plan 07).
// We do NOT call startWorker() from here — running the queue inside the
// Next.js Node process couples worker uptime to web uptime and causes
// long-running jobs to block hot-reload during development.

import { logger } from '@/lib/logger'

logger.info(
  {
    phase: 'server-init',
    node: process.version,
    tz: process.env.TZ ?? 'unknown',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  },
  'FB_EVENTOS server starting',
)
