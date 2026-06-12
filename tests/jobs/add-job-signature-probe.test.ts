// FB_EVENTOS — Graphile-Worker add_job() SQL signature probe (Phase 0,
// Plan 06 Task 2 — mitigates RESEARCH Assumption A1).
//
// PURPOSE
// -------
// Phase 2's outbox pattern depends on Server Actions calling
// `graphile_worker.add_job(identifier, payload, ...)` inside their business
// transaction. If the function's SQL signature drifts in a future minor
// version, every outbox-enqueueing call site silently breaks.
//
// This test does THREE things:
//
//   1. Boots Graphile-Worker briefly so its bootstrap migrations install the
//      `graphile_worker` schema into our test Postgres. (Runner.stop() is
//      called immediately so this probe doesn't keep a long-running process.)
//   2. Reads pg_proc for every overload of `graphile_worker.add_job` and
//      logs the actual argument list (console.log; the migration 0008 header
//      stores the captured signatures so future devs need not re-probe).
//   3. Invokes the function with the EXACT shape used by src/jobs/enqueue.ts
//      (named-arg variant `identifier => ..., payload => ...::json, ...`).
//      If a future graphile-worker version changes the arg names or types,
//      this invocation fails, the test fails loudly, and the codebase
//      can adjust enqueueJob() accordingly BEFORE Phase 2's outbox depends
//      on it.
//
// CONTRACT GUARANTEES
// -------------------
// PASS = the named-arg signature with `identifier`, `payload`, `run_at`,
//        `job_key`, `max_attempts` parameters still resolves on the live
//        Postgres + the installed graphile-worker schema.
// FAIL = signature drift; src/jobs/enqueue.ts and possibly migration 0008
//        header need to be updated to match the new shape.

import { afterAll, describe, expect, test } from 'vitest'

import { run } from 'graphile-worker'
import { migratorPool } from '@/test/db'

interface PgProcRow {
  proname: string
  args: string
  return_type: string
}

describe('graphile_worker.add_job SQL signature probe (RESEARCH A1)', () => {
  afterAll(async () => {
    // migratorPool is shared with other test files — do NOT call .end() here.
  })

  test('boots worker once to install schema, then catalogs add_job overloads', async () => {
    // STEP 1: Boot a runner briefly. Its bootstrap creates the
    // `graphile_worker` schema + tables + functions via the bundled SQL
    // migrations (node_modules/graphile-worker/sql/000001..000018.sql).
    // Use the migrator URL so the bootstrap has DDL permission.
    const migratorUrl = process.env.DATABASE_MIGRATOR_URL
    if (!migratorUrl) {
      throw new Error('DATABASE_MIGRATOR_URL is required for the probe test')
    }

    const r = await run({
      connectionString: migratorUrl,
      // No-op task list — we don't care about job execution, only schema install.
      taskList: { __probe: async () => {} },
      concurrency: 1,
      // Suppress runner banner / noise during tests.
      logger: undefined,
    })
    await r.stop()

    // STEP 2: Reflect — what overloads of add_job actually exist?
    const rows = await migratorPool<PgProcRow[]>`
      SELECT
        proname,
        pg_get_function_arguments(oid) AS args,
        pg_get_function_result(oid) AS return_type
      FROM pg_proc
      WHERE pronamespace = 'graphile_worker'::regnamespace
        AND proname = 'add_job'
    `

    // At least one overload must exist after schema install.
    expect(rows.length).toBeGreaterThan(0)

    // Print every signature so future developers can grep test output if
    // the signature drifts. (vitest run shows console.log on failure or
    // with --reporter=verbose.)
    // biome-ignore lint/suspicious/noConsole: probe output is the load-bearing artifact of this test
    console.log('\n[A1 probe] Verified graphile_worker.add_job signatures:')
    for (const r of rows) {
      // biome-ignore lint/suspicious/noConsole: probe output
      console.log(`  ${r.proname}(${r.args}) RETURNS ${r.return_type}`)
    }

    // STEP 3: Assert the named-arg call shape used by src/jobs/enqueue.ts
    // is callable. This is the LOAD-BEARING assertion — if it ever fails,
    // src/jobs/enqueue.ts MUST be updated to match the new signature.
    await migratorPool`
      SELECT graphile_worker.add_job(
        identifier => ${'__probe'},
        payload => ${JSON.stringify({ hello: 'world' })}::json,
        run_at => ${null},
        job_key => ${null},
        max_attempts => ${1}
      )
    `

    // STEP 4: Positional-arg invocation (defensive — some callers may use
    // positional form). Asserts both arg-call modes still work.
    await migratorPool`
      SELECT graphile_worker.add_job(${'__probe'}, ${JSON.stringify({ via: 'positional' })}::json)
    `

    // STEP 5: Confirm the rows landed in either jobs or _private_jobs.
    // Graphile-Worker 0.16.x stores jobs in `_private_jobs` and exposes
    // `jobs` as a view. Use the view to be version-tolerant.
    const jobRows = await migratorPool`
      SELECT count(*)::int as n FROM graphile_worker.jobs WHERE task_identifier = '__probe'
    `
    expect((jobRows[0] as { n: number }).n).toBeGreaterThanOrEqual(2)

    // Cleanup so other tests / re-runs start from a clean queue.
    await migratorPool`DELETE FROM graphile_worker._private_jobs WHERE task_identifier = '__probe'`
  })
})
