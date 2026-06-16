"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueJob = enqueueJob;
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
async function enqueueJob(tx, taskName, payload, opts = {}) {
    const runAt = opts.runAt ?? null;
    const jobKey = opts.jobKey ?? null;
    const maxAttempts = opts.maxAttempts ?? null;
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
    await tx `
    SELECT graphile_worker.add_job(
      identifier => ${taskName},
      payload => ${JSON.stringify(payload)}::text::json,
      run_at => ${runAt},
      job_key => ${jobKey},
      max_attempts => ${maxAttempts}
    )
  `;
}
