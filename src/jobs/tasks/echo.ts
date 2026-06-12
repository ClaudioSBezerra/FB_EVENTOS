// FB_EVENTOS — `echo` smoke-test task (Phase 0, Plan 06).
//
// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Pitfall 8 — withTenant() inside the worker (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// The worker process uses its OWN pg connection (separate pool from the
// web's `db` singleton). The runner does NOT pre-set
// `app.current_tenant_id` on that connection. Therefore EVERY task that
// reads tenant-scoped data MUST extract `tenantId` from the job payload
// and wrap the body in `withTenant(tenantId, async (db) => { ... })` —
// otherwise RLS default-deny returns 0 rows and the job silently no-ops.
//
// This `echo` task is a non-tenant-scoped smoke test (logs the payload
// only — no DB read). It is the structural template for future tenant-
// scoped tasks; copy this header verbatim when adding new tasks.
//
// Test that proves the failure mode is observable rather than silent:
//   tests/jobs/worker-without-with-tenant.test.ts
//
// FUTURE TASK SHAPE (Phase 2 example):
//   export const sendWelcomeEmail: Task = async (payload, helpers) => {
//     const { tenantId, userId } = payload as { tenantId: string; userId: string }
//     await withTenant(tenantId, async (db) => {
//       const [user] = await db.select().from(user).where(eq(user.id, userId))
//       await sendEmail(user.email, 'Welcome', ...)
//     })
//   }

import type { Task } from 'graphile-worker'

import { childLogger, logger } from '@/lib/logger'

export const echo: Task = async (payload, helpers) => {
  // Pull requestId / tenantId out of the payload if present so the log
  // line correlates with the originating Server Action's request.
  const p = (payload ?? {}) as {
    requestId?: string
    tenantId?: string
    message?: string
  }
  const log = childLogger({
    requestId: p.requestId,
    tenantId: p.tenantId,
  })
  log.info(
    {
      component: 'job',
      task: 'echo',
      jobId: String(helpers.job.id),
      payload: p,
    },
    'echo',
  )
  // Defensive: also emit on the singleton logger so a test that doesn't
  // provide a requestId still sees one line per executed job.
  if (!p.requestId) {
    logger.debug(
      { component: 'job', task: 'echo', jobId: String(helpers.job.id) },
      'echo (no requestId)',
    )
  }
}
