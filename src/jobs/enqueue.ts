// FB_EVENTOS — Transactional job enqueue helper (Phase 0, Plan 06 — FOUND-14).
//
// ─────────────────────────────────────────────────────────────────────────
// THE OUTBOX PATTERN (load-bearing for Phase 2):
// ─────────────────────────────────────────────────────────────────────────
// `enqueueJob(tx, ...)` calls `graphile_worker.add_job(...)` inside the
// caller's transaction. The job row is written to `graphile_worker._private_jobs`
// in the SAME transaction as the business write. Two consequences:
//
//   1. If the business transaction COMMITS, the job row is durable and
//      the worker picks it up on its next poll cycle (~LISTEN/NOTIFY ping).
//   2. If the business transaction ROLLS BACK, the job row never existed —
//      no orphan side-effect. This is the textbook outbox pattern: the
//      job and the business write are atomic.
//
// Without this pattern, Phase 2's "email confirmation after order is paid"
// flow leaks: if we enqueued the email job BEFORE committing the order,
// a rollback would send the email anyway; if we enqueued AFTER committing,
// a crash between commit and enqueue would silently drop the email.
//
// ─────────────────────────────────────────────────────────────────────────
// VERIFIED add_job() SIGNATURE (Plan 06 Task 2 probe — graphile-worker 0.16.6):
// ─────────────────────────────────────────────────────────────────────────
//   add_job(
//     identifier text,
//     payload json DEFAULT NULL,
//     queue_name text DEFAULT NULL,
//     run_at timestamptz DEFAULT NULL,
//     max_attempts integer DEFAULT NULL,
//     job_key text DEFAULT NULL,
//     priority integer DEFAULT NULL,
//     flags text[] DEFAULT NULL,
//     job_key_mode text DEFAULT 'replace'
//   ) RETURNS graphile_worker._private_jobs
//
// We invoke via the NAMED-ARG form so a future minor version that adds
// optional args in the middle does not silently shift our positional
// arguments. See tests/jobs/add-job-signature-probe.test.ts — the probe
// asserts this exact call still resolves on every test run.

import type { Sql, TransactionSql } from 'postgres'

/**
 * Type guard for any postgres.js Sql tag (transaction or pool).
 * Both accept template-literal tagged invocation with identical semantics.
 */
// biome-ignore lint/suspicious/noExplicitAny: postgres.js Sql/TransactionSql generics intentionally loose
type AnyPgSql = Sql<any> | TransactionSql<any>

export interface EnqueueOptions {
  /** Schedule the job for a future moment. Omit / null → run as soon as possible. */
  runAt?: Date | null
  /**
   * Idempotency key. With `job_key_mode='replace'` (the graphile-worker
   * default), a subsequent enqueue with the SAME key replaces the unrun
   * job; if the job already started, the second enqueue is queued behind
   * it. Use for "send the welcome email at most once per (user_id, event)".
   */
  jobKey?: string | null
  /** Max attempts before the job is permafailed. Default 25 (graphile-worker default). */
  maxAttempts?: number | null
}

/**
 * Enqueue a background job inside the caller's Postgres transaction.
 *
 * @example
 *   await db.transaction(async (tx) => {
 *     // 1. business write
 *     await tx.execute(sql`INSERT INTO orders ...`)
 *     // 2. enqueue the side-effect — same transaction, atomic
 *     await enqueueJob(tx, 'sendOrderConfirmation', { orderId, tenantId })
 *   })
 *
 * For non-transactional callers (rare — usually only test setup), pass the
 * raw `pool` (Sql) instead of a `TransactionSql`. The SQL call is
 * single-statement, so the implicit per-call transaction is sufficient.
 *
 * @param tx       A postgres.js Sql or TransactionSql tag.
 * @param taskName The graphile-worker task identifier (must match a key
 *                 in `src/jobs/tasks/index.ts` for the worker to dispatch it).
 * @param payload  JSON-serializable object delivered to the task.
 * @param opts     Optional scheduling / idempotency / retry tuning.
 */
export async function enqueueJob<P extends Record<string, unknown>>(
  tx: AnyPgSql,
  taskName: string,
  payload: P,
  opts: EnqueueOptions = {},
): Promise<void> {
  const runAt = opts.runAt ?? null
  const jobKey = opts.jobKey ?? null
  const maxAttempts = opts.maxAttempts ?? null

  // NAMED-arg form — see signature comment above. The double cast
  // `::text::json` is load-bearing: postgres.js's default parameter
  // encoding sends JS strings as JSON-string parameters (so a plain
  // `::json` cast would store the WHOLE stringified object as a JSON
  // STRING value — `json_typeof()` returns 'string' instead of 'object',
  // and the task handler receives a `string` payload instead of the
  // intended JS object). Forcing the parameter through `::text` first
  // anchors PG's interpretation to the raw text bytes before the JSON
  // parser runs. Discovered in Plan 06 Task 3 — see
  // tests/jobs/enqueue.test.ts "payload — JSON-serialized values round-
  // trip through Postgres" for the assertion that catches a regression
  // if a future postgres.js version changes this behavior.
  await tx`
    SELECT graphile_worker.add_job(
      identifier => ${taskName},
      payload => ${JSON.stringify(payload)}::text::json,
      run_at => ${runAt},
      job_key => ${jobKey},
      max_attempts => ${maxAttempts}
    )
  `
}
