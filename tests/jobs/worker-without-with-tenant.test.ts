// FB_EVENTOS — Worker tenant-context test (Phase 0, Plan 06 Task 3 —
// RESEARCH Pitfall 8 mitigation, FOUND-14).
//
// ─────────────────────────────────────────────────────────────────────────
// THE PROBLEM THIS TEST DOCUMENTS (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// The Graphile-Worker process uses its OWN pg pool (separate from the web
// process's `db` singleton). The runner DOES NOT pre-set
// `app.current_tenant_id` on the worker's connection. Therefore a task
// handler that reads tenant-scoped data WITHOUT explicitly calling
// `withTenant(tenantId, fn)` will see RLS default-deny — 0 rows — even
// though the same data is fully accessible to a tenant-bound web request.
//
// This test makes that failure mode OBSERVABLE: it asserts that the count
// is exactly 0 when the task omits withTenant(). Without this test, the
// failure mode is silent (the task runs, exits successfully, but does no
// work) — the dangerous shape that drove FB_APU04's tenant-isolation
// concerns.
//
// We also assert the positive case: when the task DOES call withTenant(),
// the row is visible. Together these two assertions form the structural
// proof that the worker process honors RLS the same as the web process.
//
// HOW THE TEST IS WIRED:
//
//   1. Boot graphile-worker briefly with the migrator URL to install the
//      schema (idempotent — already present if other tests ran first).
//   2. Seed a tenant + organization row via the standard test fixtures
//      (createTenant + insertOrganization). insertOrganization uses
//      appPool + SET LOCAL so the row genuinely lives under RLS.
//   3. Run a second short-lived runner — this time connected as
//      fb_eventos_app (the RLS-bound role) so the task body's pg client
//      gets RLS treatment. The task is the assertion point: it queries
//      `organization` once WITHOUT withTenant() and once WITH withTenant(),
//      stashing both counts into a shared object.
//   4. After the runner stops, assert the captured counts.

import { sql } from 'drizzle-orm'

import { run, type Task } from 'graphile-worker'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { appPool, createTenant, insertOrganization, migratorPool } from '@/test/db'

const TASK_WITHOUT = '__test_no_with_tenant'
const TASK_WITH = '__test_with_with_tenant'

beforeAll(async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) {
    throw new Error('DATABASE_MIGRATOR_URL required for worker-without-with-tenant.test')
  }
  // Schema bootstrap (idempotent — no-op if other tests already booted).
  const r = await run({
    connectionString: migratorUrl,
    taskList: { __bootstrap: async () => {} },
    concurrency: 1,
    logger: undefined,
  })
  await r.stop()
  // Install RLS policies on graphile_worker tables for fb_eventos_app.
  // Migration 0009 created the helper function; in the test environment
  // we re-invoke it AFTER bootstrap to cover tables created by the runner
  // boot above (the migration itself ran before bootstrap so it was a no-op
  // unless a previous test already triggered bootstrap).
  await migratorPool`SELECT fb_install_graphile_worker_policies()`
})

afterEach(async () => {
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks
      WHERE identifier IN (${TASK_WITHOUT}, ${TASK_WITH})
    )
  `
})

/**
 * Run a worker connected as fb_eventos_app (the RLS-bound role) for long
 * enough to consume one queued job, then stop. Returns when the runner
 * has fully drained.
 *
 * We wait up to `timeoutMs` for the task to actually execute (the
 * `taskDone` promise resolves when the handler in `taskList` runs once).
 */
async function runOneJob(taskList: Record<string, Task>, timeoutMs = 5000): Promise<void> {
  const appUrl = process.env.DATABASE_URL
  if (!appUrl) throw new Error('DATABASE_URL required')

  let resolveTask: () => void
  const taskExecuted = new Promise<void>((resolve) => {
    resolveTask = resolve
  })
  const wrappedTaskList: Record<string, Task> = {}
  for (const [name, task] of Object.entries(taskList)) {
    wrappedTaskList[name] = async (payload, helpers) => {
      try {
        await task(payload, helpers)
      } finally {
        resolveTask()
      }
    }
  }

  const r = await run({
    connectionString: appUrl,
    taskList: wrappedTaskList,
    concurrency: 1,
    logger: undefined,
  })

  // Wait for the task to run (or timeout). Then stop.
  await Promise.race([
    taskExecuted,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('task did not run in time')), timeoutMs),
    ),
  ])
  await r.stop()
}

describe('worker process honors RLS (Pitfall 8 mitigation)', () => {
  test('task without withTenant() sees 0 rows from a tenant-scoped table', async () => {
    // Arrange — seed a tenant + organization row.
    const tenantId = await createTenant('pitfall8-no-ctx', 'Pitfall 8 No Ctx Tenant')
    await insertOrganization(tenantId, 'pitfall8-no-ctx-org', 'Pitfall 8 No Ctx Org')

    // The task uses helpers.withPgClient — the worker's pg pool, connected
    // as fb_eventos_app. NO SET LOCAL = RLS default-deny.
    const observed: { count: number | null } = { count: null }
    const task: Task = async (_payload, helpers) => {
      await helpers.withPgClient(async (client) => {
        // Raw count via the worker's pg client — NO withTenant wrapper.
        const res = await client.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM organization',
        )
        observed.count = Number.parseInt(res.rows[0]?.n ?? '0', 10)
      })
    }

    // Enqueue then run.
    await enqueueJob(migratorPool, TASK_WITHOUT, { tenantId })
    await runOneJob({ [TASK_WITHOUT]: task })

    // ASSERT — load-bearing: count MUST be 0 (RLS default-deny). If this
    // ever becomes >0, the worker's pg connection somehow has a tenant
    // context set without going through withTenant() and the RLS contract
    // is broken.
    expect(observed.count).toBe(0)
  })

  test('task that calls withTenant() sees the seeded row', async () => {
    // Arrange — seed a tenant + organization row in the same fixture
    // shape as the negative test above.
    const tenantId = await createTenant('pitfall8-with-ctx', 'Pitfall 8 With Ctx Tenant')
    await insertOrganization(tenantId, 'pitfall8-with-ctx-org', 'Pitfall 8 With Ctx Org')

    // The task wraps its read in withTenant() — production-correct shape.
    // withTenant uses the web process's `db` singleton; that's intentional
    // because in production the worker would call withTenant() the same
    // way (the web app's pool is reachable from the worker process — they
    // share the same DATABASE_URL and import the same `db` module).
    const observed: { count: number | null } = { count: null }
    const task: Task = async (payload) => {
      // enqueueJob casts the JSON parameter through `::text::json` so
      // graphile-worker's pg driver delivers `payload` as a JS object,
      // not as a JSON string. See src/jobs/enqueue.ts comment + the
      // tests/jobs/enqueue.test.ts payload round-trip assertion.
      const p = payload as { tenantId: string }
      await withTenant(p.tenantId, async (db) => {
        const rows = await db.execute(sql`SELECT count(*)::int AS n FROM organization`)
        const first = rows[0] as { n: number } | undefined
        observed.count = first?.n ?? 0
      })
    }

    await enqueueJob(migratorPool, TASK_WITH, { tenantId })
    await runOneJob({ [TASK_WITH]: task })

    // ASSERT — with the tenant context, the row IS visible.
    expect(observed.count).toBe(1)
  })
})

// Silence the unused-import lint when this file is parsed without the
// runtime — `organization` is referenced from the schema import only for
// type-graph completeness; the body uses raw SQL because helpers.withPgClient
// gives us a pg.PoolClient, not a Drizzle handle.
void organization
void appPool
