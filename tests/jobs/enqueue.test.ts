// FB_EVENTOS — enqueueJob() transactional outbox semantics test
// (Phase 0, Plan 06 Task 3 — FOUND-14).
//
// Asserts the THREE load-bearing properties of the outbox pattern:
//
//   1. COMMIT enqueues  — a job inserted inside a tx that COMMITs is
//                         visible in graphile_worker.jobs afterwards.
//   2. ROLLBACK suppresses — a job inserted inside a tx that ROLLBACKs
//                         leaves NO row in graphile_worker.jobs. This is
//                         the core outbox guarantee: business write and
//                         job enqueue are atomic.
//   3. jobKey dedupes   — two enqueues with the same `jobKey` produce
//                         exactly one job row (graphile-worker's default
//                         job_key_mode='replace' semantics).
//
// Why this test exists at all: without the outbox guarantee, a crash
// between a Server Action's business COMMIT and a fire-and-forget
// `pool.add_job(...)` call silently drops side-effects (welcome email,
// order receipt, Pagar.me callback). Phase 2's email + webhook flows
// depend on this property holding.

import { run } from 'graphile-worker'
import type postgres from 'postgres'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

import { enqueueJob } from '@/jobs/enqueue'
import { migratorPool } from '@/test/db'

const TASK_NAME = '__test_enqueue'

// Boot graphile-worker once per test file to ensure the schema is installed.
// We use the migrator URL (DDL privileges) for the bootstrap, then run all
// assertions through migratorPool which has full visibility.
beforeAll(async () => {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) {
    throw new Error('DATABASE_MIGRATOR_URL is required for enqueue.test')
  }
  const r = await run({
    connectionString: migratorUrl,
    taskList: { [TASK_NAME]: async () => {} },
    concurrency: 1,
    logger: undefined,
  })
  await r.stop()
})

afterEach(async () => {
  // Clear any test jobs so the next test starts from a clean queue.
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks WHERE identifier = ${TASK_NAME}
    )
  `
})

async function countTestJobs(): Promise<number> {
  const rows = await migratorPool<{ n: number }[]>`
    SELECT count(*)::int AS n FROM graphile_worker.jobs WHERE task_identifier = ${TASK_NAME}
  `
  return rows[0]?.n ?? 0
}

describe('enqueueJob — transactional outbox semantics', () => {
  test('COMMIT — job survives in queue after transaction commits', async () => {
    expect(await countTestJobs()).toBe(0)

    // postgres.js .begin() resolves with the callback return value when the
    // transaction commits. No throw → COMMIT.
    await migratorPool.begin(async (tx) => {
      await enqueueJob(tx, TASK_NAME, { branch: 'commit', payload: 'kept' })
    })

    expect(await countTestJobs()).toBe(1)
  })

  test('ROLLBACK — job vanishes when transaction rolls back', async () => {
    expect(await countTestJobs()).toBe(0)

    // Throw inside .begin() forces a ROLLBACK. The thrown error is
    // re-raised; catch it locally so the test continues.
    const ROLLBACK_SENTINEL = new Error('intentional rollback for outbox test')
    await expect(
      migratorPool.begin(async (tx) => {
        await enqueueJob(tx, TASK_NAME, { branch: 'rollback', payload: 'lost' })
        throw ROLLBACK_SENTINEL
      }),
    ).rejects.toBe(ROLLBACK_SENTINEL)

    // The job must NOT exist — this is the load-bearing outbox guarantee.
    expect(await countTestJobs()).toBe(0)
  })

  test('jobKey — two enqueues with the same key produce exactly one row', async () => {
    expect(await countTestJobs()).toBe(0)

    await migratorPool.begin(async (tx) => {
      await enqueueJob(tx, TASK_NAME, { v: 1 }, { jobKey: 'shared-key' })
    })
    await migratorPool.begin(async (tx) => {
      await enqueueJob(tx, TASK_NAME, { v: 2 }, { jobKey: 'shared-key' })
    })

    // graphile-worker's default job_key_mode='replace' keeps a single row;
    // the SECOND enqueue replaces the payload of the FIRST. We join
    // `_private_jobs` for the payload (the `jobs` view does not expose it).
    // postgres.js auto-parses json columns into JS objects on read because
    // enqueueJob casts via `::text::json` (so the stored value is a real
    // JSON object, not a JSON-encoded string — see comment in enqueue.ts).
    const rows = await migratorPool<{ key: string; payload: Record<string, unknown> }[]>`
      SELECT j.key, pj.payload
      FROM graphile_worker.jobs j
      JOIN graphile_worker._private_jobs pj ON pj.id = j.id
      WHERE j.task_identifier = ${TASK_NAME} AND j.key = 'shared-key'
    `
    expect(rows).toHaveLength(1)
    // Payload must be the second enqueue's payload (replace semantics).
    expect(rows[0]?.payload).toEqual({ v: 2 })
  })

  test('payload — JSON-serialized values round-trip through Postgres', async () => {
    await migratorPool.begin(async (tx) => {
      await enqueueJob(tx, TASK_NAME, {
        tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        nested: { a: 1, b: [true, false], c: null },
      })
    })

    // postgres.js auto-parses the json column on read — see enqueueJob's
    // `::text::json` cast comment for why the stored value is a real JSON
    // object (not a JSON-encoded string).
    const rows = await migratorPool<{ payload: Record<string, unknown> }[]>`
      SELECT pj.payload
      FROM graphile_worker.jobs j
      JOIN graphile_worker._private_jobs pj ON pj.id = j.id
      WHERE j.task_identifier = ${TASK_NAME}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payload).toEqual({
      tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      nested: { a: 1, b: [true, false], c: null },
    })
  })

  test('non-transactional Sql tag — also valid (single-statement implicit tx)', async () => {
    expect(await countTestJobs()).toBe(0)
    // Pass the raw pool — the single SELECT runs in an implicit transaction
    // and commits immediately. This is the fallback path for callers that
    // do not have a meaningful business transaction to bind to (e.g. test
    // setup, manual ops via REPL).
    await enqueueJob(migratorPool as unknown as postgres.Sql, TASK_NAME, { mode: 'pool-direct' })
    expect(await countTestJobs()).toBe(1)
  })
})
