---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 06
type: execute
wave: 4
depends_on:
  - 00-04
  - 00-05
files_modified:
  - package.json
  - src/lib/logger.ts
  - src/instrumentation.ts
  - src/instrumentation-node.ts
  - sentry.client.config.ts
  - sentry.server.config.ts
  - sentry.edge.config.ts
  - next.config.ts
  - src/middleware.ts
  - src/jobs/runner.ts
  - src/jobs/tasks/echo.ts
  - src/jobs/tasks/index.ts
  - src/jobs/enqueue.ts
  - src/db/migrations/0006_graphile_worker_install.sql
  - scripts/jobs/start-worker.ts
  - docs/adr/0001-queue-backend.md
  - tests/jobs/enqueue.test.ts
  - tests/jobs/add-job-signature-probe.test.ts
  - tests/jobs/worker-without-with-tenant.test.ts
  - tests/logging/request-id-binding.test.ts
autonomous: false
requirements:
  - FOUND-10
  - FOUND-11
  - FOUND-14
  - FOUND-16
requirements_addressed:
  - FOUND-10
  - FOUND-11
  - FOUND-14
  - FOUND-16
tags:
  - observability
  - pino
  - sentry
  - graphile-worker
  - jobs
  - adr
must_haves:
  truths:
    - "Pino logger emits structured JSON to stdout on every server request"
    - "Every server log line includes `requestId` (from middleware x-request-id) and `tenantId` (when known via session) bindings"
    - "Sentry server + client + edge configs initialized via instrumentation.ts; capturing an exception tags `tenant_id` and `request_id`"
    - "ADR-0001 (`docs/adr/0001-queue-backend.md`) records Graphile-Worker decision over pg-boss with explicit revisit criteria for Phase 4"
    - "Graphile-Worker schema (`graphile_worker.*`) is installed via migration 0006 by the fb_eventos_migrator role"
    - "src/jobs/runner.ts boots Graphile-Worker against DATABASE_URL with concurrency 5; loads tasks from src/jobs/tasks/"
    - "scripts/jobs/start-worker.ts is the entrypoint for the worker process (run as a separate service in Coolify — Plan 07)"
    - "Server Actions can enqueue jobs in the same Postgres transaction as their business writes via `enqueueJob()`"
    - "The Graphile-Worker `add_job` SQL signature is verified by an integration probe test (mitigates RESEARCH Open Question 1 / Assumption A1) BEFORE outbox patterns are wired in Phase 2"
    - "Worker task handlers that touch tenant data MUST call withTenant() — documented in src/jobs/tasks/*.ts header comments AND proven by `tests/jobs/worker-without-with-tenant.test.ts`: a task that queries a tenant-scoped table via the worker pg pool WITHOUT calling withTenant() returns 0 rows (RLS default-deny), making the failure mode observable rather than silent (RESEARCH Pitfall 8 mitigation)"
  artifacts:
    - path: "src/lib/logger.ts"
      provides: "Pino instance with child-logger pattern for requestId/tenantId binding"
      contains: "pino("
    - path: "src/instrumentation.ts"
      provides: "Next.js register() entrypoint"
      contains: "register"
    - path: "src/instrumentation-node.ts"
      provides: "Node-side init (Sentry + logger + worker bootstrap deferred to scripts/jobs/start-worker.ts)"
    - path: "sentry.server.config.ts"
      provides: "Sentry server init with tenant_id scope tagging"
    - path: "src/jobs/runner.ts"
      provides: "Graphile-Worker run() bootstrap"
      contains: "graphile-worker"
    - path: "src/jobs/enqueue.ts"
      provides: "enqueueJob(tx, taskName, payload, opts) — transactional enqueue helper"
    - path: "docs/adr/0001-queue-backend.md"
      provides: "FOUND-14 ADR: Graphile-Worker vs pg-boss decision"
  key_links:
    - from: "src/middleware.ts"
      to: "src/lib/logger.ts"
      via: "x-request-id header forwarded; logger.child({requestId}) consumed in Server Actions"
      pattern: "requestId"
    - from: "src/jobs/enqueue.ts"
      to: "graphile_worker.add_job"
      via: "transaction-bound SQL function call"
      pattern: "graphile_worker\\.add_job"
    - from: "scripts/jobs/start-worker.ts"
      to: "src/jobs/runner.ts"
      via: "run() bootstraps the worker as a separate Node process"
      pattern: "startWorker"
---

<objective>
Layer structured observability (Pino + Sentry with tenant/request bindings) and the Postgres-backed job harness (Graphile-Worker) on top of the auth + multi-tenant stack. This plan also writes ADR-0001 making the Graphile-Worker vs pg-boss decision official (FOUND-14) and probes Graphile-Worker's `add_job` SQL signature live (mitigates RESEARCH Assumption A1 BEFORE Phase 2 starts depending on outbox enqueueing).

Purpose: Provides the FB_APU04-missing "structured logging + error tracking + job queue without Redis" trio. Every later domain Server Action gets `requestId+tenantId` log binding for free; every later feature can enqueue background jobs (PDF generation, webhook processing, email retry) inside the same Postgres transaction as the business write — the outbox pattern that Phase 2 lives on.

Output: Pino logger + Next.js instrumentation hooks + Sentry configs; src/jobs/runner.ts + first task + scripts/jobs/start-worker.ts entrypoint; ADR-0001; integration probe verifying the add_job SQL signature; request-id binding test.

**Autonomous=false:** This plan contains ONE blocking-human checkpoint (Task 2) to verify the Graphile-Worker `add_job` signature before the rest of Phase 2's outbox pattern depends on it.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-VALIDATION.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-04-SUMMARY.md
@.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-05-SUMMARY.md

<interfaces>
<!-- Required imports + signatures. Pinned versions per RESEARCH Standard Stack. -->

dependencies (added here):
  pino:             ~10.3.1
  pino-pretty:      latest      (dev-only)
  @sentry/nextjs:   ~10.57.0
  graphile-worker: ~0.16.6

src/lib/logger.ts exports:
  const logger: pino.Logger
  function childLogger(bindings: { requestId?: string; tenantId?: string; userId?: string }): pino.Logger

src/jobs/runner.ts exports:
  async function startWorker(): Promise<Runner>   // graphile-worker Runner type

src/jobs/enqueue.ts exports:
  async function enqueueJob<P>(
    txOrPool: postgres.TransactionSql | postgres.Sql,
    taskName: string,
    payload: P,
    opts?: { runAt?: Date; jobKey?: string; maxAttempts?: number }
  ): Promise<void>

src/middleware.ts (modified):
  Continues setting x-request-id (Plan 04); now also propagates to a header read by Pino child logger in Server Components/Actions via headers().

# RESEARCH Pitfall 8 reminder: Graphile-Worker uses `pg` driver internally — its connection pool is
# SEPARATE from postgres.js used by `withTenant()`. Tasks that read tenant data MUST call withTenant()
# themselves inside the task body. This is documented in src/jobs/tasks/*.ts headers.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pino logger + Next.js instrumentation + Sentry configs + request-id binding</name>
  <files>package.json, src/lib/logger.ts, src/instrumentation.ts, src/instrumentation-node.ts, sentry.client.config.ts, sentry.server.config.ts, sentry.edge.config.ts, next.config.ts, src/middleware.ts, tests/logging/request-id-binding.test.ts</files>
  <read_first>
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Pattern 8: Pino Logger + Request ID", "Pattern 10: Sentry Configuration", "Pitfall 5: Sentry Wizard Generates Next.js 16 File Names")
    - src/middleware.ts (Plan 04 Task 1 — sets x-request-id)
    - next.config.ts (Plan 01 + 03)
  </read_first>
  <behavior>
    - `pino` outputs structured JSON in production; uses `pino-pretty` transport in development.
    - `instrumentation.ts` calls `register()` which dynamically imports `./instrumentation-node.ts` only on Node runtime.
    - `instrumentation-node.ts` initializes Sentry server-side and logs a "server-init" line with the resolved `LOG_LEVEL`.
    - Sentry client/server/edge config files exist with the EXACT names per RESEARCH Pitfall 5 (sentry.client.config.ts, sentry.server.config.ts, sentry.edge.config.ts) — NOT the Next.js-16 default `instrumentation-client.ts`.
    - `next.config.ts` wraps with `withSentryConfig` (provided by `@sentry/nextjs`) at the bottom.
    - `childLogger({requestId, tenantId, userId})` returns a pino child with those bindings.
    - Test: middleware sets `x-request-id`, a Server Component reads it via `headers()` and calls `childLogger({requestId})`, captured stdout JSON includes the `requestId` field with matching value.
  </behavior>
  <action>
    Mitigates FB_APU04's "no structured logging" concern + provides the request_id correlation FB_APU04 lacked.

    1. Install dependencies (observability + queue runtime):
       ```
       pnpm add pino@~10.3.1 @sentry/nextjs@~10.57.0 graphile-worker@~0.16.6
       pnpm add -D pino-pretty
       ```
       NOTE: graphile-worker is installed here (not Task 2 or Task 3) so the Task 2 probe checkpoint can `import { run } from 'graphile-worker'` without an extra install step. Task 3 will use the already-installed dependency.

    2. Create `src/lib/logger.ts` per RESEARCH Pattern 8:
       ```typescript
       import pino from 'pino';
       const isDev = process.env.NODE_ENV === 'development';
       export const logger = pino({
         level: process.env.LOG_LEVEL ?? 'info',
         base: { service: 'fb-eventos-web', env: process.env.NODE_ENV },
         redact: ['*.password', '*.token', '*.secret', '*.authorization', 'req.headers.authorization', 'req.headers.cookie'],
         transport: isDev ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined,
       });
       export function childLogger(bindings: { requestId?: string; tenantId?: string; userId?: string }) {
         return logger.child(bindings);
       }
       ```

    3. Create `src/instrumentation.ts` per RESEARCH Pattern 8:
       ```typescript
       export async function register() {
         if (process.env.NEXT_RUNTIME === 'nodejs') {
           await import('./instrumentation-node');
         }
         if (process.env.NEXT_RUNTIME === 'edge') {
           // Sentry edge init is lighter; loaded via sentry.edge.config.ts which Next picks up
         }
       }
       ```

    4. Create `src/instrumentation-node.ts`:
       ```typescript
       import { logger } from '@/lib/logger';
       logger.info({ phase: 'server-init', node: process.version, tz: process.env.TZ }, 'FB_EVENTOS server starting');
       // Sentry server config auto-loaded by withSentryConfig wrapper via sentry.server.config.ts
       ```

    5. Run the Sentry wizard interactively in dev or create the three config files by hand per RESEARCH Pattern 10 + Pitfall 5 — the WIZARD MAY emit `instrumentation-client.ts` (Next.js 16 convention) by mistake; verify and rename to `sentry.client.config.ts` if so. The three files must contain:
       - `sentry.client.config.ts`: `Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1, replaysSessionSampleRate: 0.0 })`
       - `sentry.server.config.ts`: `Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 })`
       - `sentry.edge.config.ts`: `Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 })`

    6. Update `next.config.ts` to wrap the exported config with `withSentryConfig(nextConfig, { silent: true, org: '<placeholder>', project: '<placeholder>' })`. Use placeholder strings — production values come from Coolify env (Plan 07). KEEP `output: 'standalone'` from Plan 01.

    7. Update `src/middleware.ts` (Plan 04 Task 1): the middleware already sets `x-request-id`. Add a tiny pino log inside middleware: `logger.debug({ requestId, path: req.nextUrl.pathname }, 'request')` — keep at debug level so production isn't flooded.

    8. Add `.env.example` keys (already declared in Plan 01 — confirm): `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_SENTRY_DSN`, `LOG_LEVEL`.

    9. Create `tests/logging/request-id-binding.test.ts`:
       - Spawn a Next.js test request (use `NextRequest` constructor + call middleware) with no inbound `x-request-id` — assert the middleware generated one.
       - Call `childLogger({requestId: '<uuid>'}).info('test')` — capture stdout (use pino's `destination` override to write to a buffer) — assert the resulting JSON includes `"requestId":"<uuid>"`.
       - Verify the redact list: `childLogger({requestId:'x'}).info({password: 'secret', email: 'a@b.com'}, 'msg')` → assert password is `[Redacted]` in output.

    Per RESEARCH Pitfall 5: AFTER running the Sentry wizard, verify the three sentry.*.config.ts files have the CORRECT names (NOT `instrumentation-client.ts`). If wrong, rename and adjust `next.config.ts` import paths.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && pnpm test:unit tests/logging/ && test -f sentry.client.config.ts && test -f sentry.server.config.ts && test -f sentry.edge.config.ts && test -f src/instrumentation.ts && test -f src/instrumentation-node.ts && grep -q 'withSentryConfig' next.config.ts && grep -q 'pino' src/lib/logger.ts && grep -q 'childLogger' src/lib/logger.ts && grep -q 'redact' src/lib/logger.ts && node -e "const p=require('./package.json');if(!/~?0\.16\./.test(p.dependencies['graphile-worker']))process.exit(1)"</automated>
  </verify>
  <acceptance_criteria>
    - `pino ~10.3.1` and `@sentry/nextjs ~10.57.0` pinned in package.json
    - `src/lib/logger.ts` exports `logger` and `childLogger`; includes `redact` for password/token/cookie/authorization
    - `src/instrumentation.ts` calls `register()`; gates Node imports behind `NEXT_RUNTIME==='nodejs'`
    - Three Sentry config files exist with the correct names (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`) — NOT `instrumentation-client.ts`
    - `next.config.ts` wraps with `withSentryConfig` AND keeps `output: 'standalone'`
    - `tests/logging/request-id-binding.test.ts` has 3+ test cases (auto-gen request-id, child binding propagation, redact filter); all pass
    - `pnpm test:unit tests/logging/` exits 0
  </acceptance_criteria>
  <done>Pino emits structured JSON with request_id/tenant_id child bindings; Sentry server+client+edge configs initialized with correct file names; redact filter prevents password/token leakage to logs.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: [BLOCKING] Verify Graphile-Worker add_job() SQL signature on running Postgres</name>
  <files>tests/jobs/add-job-signature-probe.test.ts, src/db/migrations/0006_graphile_worker_install.sql</files>
  <read_first>
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Pattern 6: Graphile-Worker Setup", "Assumptions Log" A1, "Open Questions" #1)
    - https://worker.graphile.org/docs (visit live; RESEARCH could not pin the SQL signature)
  </read_first>
  <what-built>
    Plan 06 Task 3 will implement `enqueueJob(tx, taskName, payload, opts)` which depends on Graphile-Worker's `graphile_worker.add_job(...)` SQL function. RESEARCH Assumption A1 marks this signature as [ASSUMED] — the docs URL returned 404 at research time. Before Task 3 hardcodes the signature, this checkpoint runs a probe migration + test against a real Postgres + Graphile-Worker install and captures the actual function signature into a comment in the codebase. Without this, Phase 2 outbox enqueueing could fail at runtime.

    Pre-checkpoint setup (Claude executes automatically — graphile-worker is already installed by Task 1, so this step does NOT re-install):
    1. Create `src/db/migrations/0006_graphile_worker_install.sql` containing a single SQL command: invoke the graphile-worker schema bootstrap by calling Graphile-Worker's own migrate function (typically `SELECT graphile_worker.migrate(...)` is the runtime bootstrap path — this is what `run()` does on first boot; for explicit migration we can either let `runner.ts` do it on boot OR add explicit `CREATE SCHEMA IF NOT EXISTS graphile_worker` plus a note that schema tables are created by `run()` on first boot).
    2. Create `tests/jobs/add-job-signature-probe.test.ts`:
       ```typescript
       import { test, expect } from 'vitest';
       import { migratorPool } from '@/test/db';
       import { run } from 'graphile-worker';
       test('graphile_worker.add_job is callable with (task_name, payload)', async () => {
         // Boot the worker briefly to install the schema
         const r = await run({ connectionString: process.env.DATABASE_URL!, taskList: { echo: async () => {} }, concurrency: 1 });
         await r.stop();
         // Probe: what arg signatures exist?
         const rows = await migratorPool`
           SELECT proname, pg_get_function_arguments(oid) AS args
           FROM pg_proc WHERE pronamespace = 'graphile_worker'::regnamespace AND proname = 'add_job'
         `;
         expect(rows.length).toBeGreaterThan(0);
         // Try the common signature: (task_name text, payload json/jsonb)
         await migratorPool`SELECT graphile_worker.add_job('echo', '{"hello":"world"}'::json)`;
         // Try the named-arg signature documented in source:
         await migratorPool`SELECT graphile_worker.add_job(identifier => 'echo', payload => '{"hi":"there"}'::json)`;
         console.log('Verified add_job signatures:', rows.map(r => `${r.proname}(${r.args})`));
       });
       ```
    3. Run `pnpm test:unit tests/jobs/add-job-signature-probe.test.ts`. Capture the printed signatures.
    4. Update `src/db/migrations/0006_graphile_worker_install.sql` to add a header comment with the captured signatures (so future developers don't have to re-probe).
  </what-built>
  <how-to-verify>
    1. After Claude runs the probe test, review the test output: the `console.log('Verified add_job signatures:', ...)` line lists the actual SQL function signatures present in the installed Graphile-Worker schema.
    2. Confirm the signature looks reasonable — typically: `add_job(identifier text, payload json DEFAULT NULL, queue_name text DEFAULT NULL, run_at timestamptz DEFAULT now(), max_attempts int DEFAULT 25, job_key text DEFAULT NULL, ...)`.
    3. If the signature matches what RESEARCH Pattern 6 assumed (positional `(task_name, payload::jsonb)` or named `(identifier=>, payload=>)`), reply `approved — continue to Task 3`. Task 3 will use the verified signature.
    4. If the signature differs from RESEARCH assumptions (e.g. payload must be `::jsonb` not `::json`, or there's no named-arg variant), reply `signature differs: <details>` and Claude will adjust Task 3's `enqueueJob()` implementation accordingly.
    5. If the probe test fails (Graphile-Worker schema didn't install), reply `probe failed: <error>` so Claude can debug Pattern 6's bootstrap order before continuing.
  </how-to-verify>
  <resume-signal>Type one of:
    - `approved` (signature matches RESEARCH; proceed to Task 3 as planned)
    - `approved — adjust enqueue to <variant>` (signature differs; Task 3 uses the variant you describe)
    - `probe failed: <error>` (Claude investigates and re-runs probe)
  </resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Graphile-Worker runner + task harness + enqueueJob() helper + ADR-0001</name>
  <files>package.json, src/jobs/runner.ts, src/jobs/tasks/echo.ts, src/jobs/tasks/index.ts, src/jobs/enqueue.ts, scripts/jobs/start-worker.ts, docs/adr/0001-queue-backend.md, tests/jobs/enqueue.test.ts, tests/jobs/worker-without-with-tenant.test.ts</files>
  <read_first>
    - .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (sections "Pattern 6: Graphile-Worker Setup", "ADR-001 Recommendation")
    - Task 2 checkpoint result (verified add_job signature)
    - src/db/with-tenant.ts (Plan 03 — Pitfall 8 reminder)
  </read_first>
  <behavior>
    - `runner.ts` exports `startWorker()` returning a `Runner` instance with `concurrency: 5`, `taskList` populated from `src/jobs/tasks/index.ts`, `connectionString: env.DATABASE_URL`.
    - `scripts/jobs/start-worker.ts` is a one-line entrypoint: `import { startWorker } from '@/jobs/runner'; await startWorker();`. This is run as a separate Coolify service in Plan 07.
    - `src/jobs/tasks/echo.ts` is a sample task: logs the payload via the request_id-bound pino logger.
    - `src/jobs/tasks/index.ts` re-exports the task map (`{ echo: echoTask }`).
    - `enqueueJob(tx, taskName, payload, opts)` uses the verified add_job signature from Task 2 to enqueue inside the caller's transaction (outbox pattern foundation for Phase 2).
    - ADR-0001 documents: decision (Graphile-Worker), alternatives (pg-boss, BullMQ), criteria, revisit triggers (multi-instance Coolify in Phase 4 → revisit pg-boss).
  </behavior>
  <action>
    Mitigates RESEARCH Pitfall 8: every task that touches tenant data MUST call withTenant() — document this in every task file header. NOTE: `graphile-worker@~0.16.6` is already installed by Task 1; do NOT re-install in Task 3 (avoids version drift and double-install confusion flagged by the checker).

    1. Create `src/jobs/runner.ts`:
       ```typescript
       import { run, type Runner } from 'graphile-worker';
       import { taskList } from './tasks';
       import { logger } from '@/lib/logger';
       import { env } from '@/lib/env';
       export async function startWorker(): Promise<Runner> {
         logger.info({ component: 'graphile-worker', concurrency: 5 }, 'starting worker');
         const r = await run({
           connectionString: env.DATABASE_URL,  // NOTE: Pitfall 8 — worker uses its own pg pool
           concurrency: 5,
           taskList,
           crontab: '',  // Phase 2+ will add: '* * * * * expire-lot-reservations'
         });
         return r;
       }
       ```

    2. Create `src/jobs/tasks/echo.ts`:
       ```typescript
       // RESEARCH Pitfall 8: this task's DB context is the worker's pg pool — NOT app pool.
       // For tenant-scoped queries, callers must SET LOCAL app.current_tenant_id inside the task body.
       // Echo task is non-tenant-scoped (smoke-test only).
       import type { Task } from 'graphile-worker';
       import { logger } from '@/lib/logger';
       export const echo: Task = async (payload, helpers) => {
         logger.info({ component: 'job', task: 'echo', payload, jobId: helpers.job.id }, 'echo');
       };
       ```

    3. Create `src/jobs/tasks/index.ts`:
       ```typescript
       import { echo } from './echo';
       export const taskList = { echo } as const;
       ```

    4. Create `src/jobs/enqueue.ts` using the verified add_job signature from Task 2 (default assumption: named args):
       ```typescript
       import type { Sql, TransactionSql } from 'postgres';
       export async function enqueueJob<P extends Record<string, unknown>>(
         tx: Sql | TransactionSql,
         taskName: string,
         payload: P,
         opts: { runAt?: Date; jobKey?: string; maxAttempts?: number } = {}
       ): Promise<void> {
         // Verified signature in Task 2 checkpoint (see migrations/0006 header).
         await tx`SELECT graphile_worker.add_job(
           identifier => ${taskName},
           payload => ${JSON.stringify(payload)}::json,
           run_at => ${opts.runAt ?? null},
           job_key => ${opts.jobKey ?? null},
           max_attempts => ${opts.maxAttempts ?? 25}
         )`;
       }
       ```
       If Task 2 reported a different signature, adjust accordingly per the checkpoint's resume signal.

    5. Create `scripts/jobs/start-worker.ts`:
       ```typescript
       import 'tsx';  // remove if not needed
       import { startWorker } from '../../src/jobs/runner';
       startWorker().catch((err) => { console.error(err); process.exit(1); });
       ```

    6. Add npm scripts to `package.json`:
       - `"worker:dev"`: `tsx scripts/jobs/start-worker.ts`
       - `"worker:start"`: `node dist/worker.js` (production path — Plan 07 figures out the actual build step)

    7. Create `docs/adr/0001-queue-backend.md` per RESEARCH "ADR-001 Recommendation":
       ```markdown
       # ADR-0001 — Queue backend: Graphile-Worker (over pg-boss, BullMQ)

       **Status:** Accepted
       **Date:** 2026-06-11
       **Deciders:** Solo dev (FB_EVENTOS) + RESEARCH 00-RESEARCH.md "ADR-001 Recommendation"

       ## Context
       FB_EVENTOS needs a background-job queue for: webhook processing (Pagar.me), email sending,
       PDF generation, reservation expiration cron, periodic data purges. The platform constraint
       BANS embedded DBs (SQLite, file-based queues — anti-pitfall #1 from FB_APU04). Redis-backed
       queues (BullMQ) add infrastructure surface area inconsistent with "Postgres as single source of truth".

       ## Decision
       Adopt **Graphile-Worker 0.16.6** as the queue backend for Phase 0-3. Schema lives in the same
       Postgres instance as application data. Bootstraps automatically on `run()`. Provides:
       - Transactional enqueueing (`graphile_worker.add_job` SQL function) — enables outbox pattern
       - Cron / scheduled jobs (minute granularity sufficient for FB_EVENTOS reservation expiry)
       - Retry + exponential backoff (built-in)
       - LISTEN/NOTIFY signaling for low-latency dispatch
       - Unique job keys (idempotent enqueue)

       ## Alternatives Considered
       | Option | Why not in Phase 0-3 | Revisit at |
       |--------|----------------------|------------|
       | pg-boss 12.18.3 | More features (multi-master, web dashboard, official Drizzle adapter); more API surface; not needed yet | Phase 4 if multi-instance Coolify deploy materializes |
       | BullMQ + Redis 7 | Requires Redis container — violates Postgres-only constraint | Never (constraint is permanent) |
       | Self-rolled `_jobs` table + LISTEN/NOTIFY | Replicates Graphile-Worker poorly; reinventing the wheel | Never |

       ## Consequences
       Positive:
       - One less infra dependency (no Redis container in docker/compose.yml or Coolify)
       - Outbox pattern is one SQL function call from any Server Action transaction
       - Tasks are typed Node functions; no separate language/runtime

       Negative:
       - Single-master (one runner consumes one DB) — Phase 4 may want pg-boss for multi-instance
       - No first-party web dashboard (CLI inspection via psql)

       ## Verification
       - `tests/jobs/add-job-signature-probe.test.ts` (Plan 06 Task 2 checkpoint) verifies the SQL signature is callable
       - `tests/jobs/enqueue.test.ts` (Plan 06 Task 3) verifies transactional outbox semantics

       ## Revisit Criteria
       Re-evaluate at Phase 4 planning if:
       - Multi-instance Coolify deploy becomes required (load > single Node process)
       - Job inspection / failure replay UI becomes worth the integration cost
       - pg-boss adds Graphile-Worker-equivalent transactional-enqueue ergonomics
       ```

    8. Create `tests/jobs/enqueue.test.ts`:
       - Test 1: enqueue inside a transaction → COMMIT → assert row exists in `graphile_worker._private_jobs` (or whatever table the verified schema uses).
       - Test 2: enqueue inside a transaction → ROLLBACK → assert NO row exists (outbox semantics: job only runs if business txn commits).
       - Test 3: enqueue twice with the same `jobKey` → only one job exists (deduplication).

    9. Create `tests/jobs/worker-without-with-tenant.test.ts` (load-bearing — proves the Pitfall 8 failure mode is observable, not silent):
       - Setup (via migratorPool): create tenant A (id=tA) and seed at least 1 row in a tenant-scoped table (e.g. `organization` with tenant_id=tA).
       - Define a probe task `tenantProbe` that uses the worker's pg pool (the `helpers.withPgClient` API or the runner's connection) to run `SELECT count(*) FROM organization` WITHOUT calling `withTenant()`. Capture the result count.
       - Enqueue `tenantProbe` via `enqueueJob(migratorPool, 'tenantProbe', {})` then run the worker briefly (`run({ taskList: { tenantProbe }, concurrency: 1 })` + `r.stop()` after 1s) so the task executes once.
       - Assert: the captured count is `0` (RLS default-deny — the worker pg pool is the `fb_eventos_app` role with no tenant context, so the policy filters every row).
       - Then run a second probe task `tenantProbeWithCtx` that DOES call `withTenant(tA, db => db.select({c: count()}).from(organization))` — assert count is `1`.
       - Add a comment in the test header referencing the checker's "verification_derivation warning" and RESEARCH Pitfall 8 — this test makes the misuse loud rather than silent.

    10. Document the worker as a "separate Coolify service" in `docs/RUNBOOK.md` (created in Plan 07). For Plan 06, add a placeholder marker in README.md: "The Graphile-Worker process runs separately — see Plan 07 for Coolify config".

    Per Phase 0 contract: NO Redis in package.json (`bullmq`, `ioredis`, `redis` MUST be absent). Verify with grep.
  </action>
  <verify>
    <automated>pnpm install --frozen-lockfile=false && pnpm tsc --noEmit && pnpm test:unit tests/jobs/ && test -f docs/adr/0001-queue-backend.md && grep -q 'Graphile-Worker' docs/adr/0001-queue-backend.md && grep -q 'pg-boss' docs/adr/0001-queue-backend.md && grep -q 'graphile_worker.add_job' src/jobs/enqueue.ts && ! grep -E '"(bullmq|ioredis|redis)"' package.json && node -e "const p=require('./package.json');if(!/~?0\.16\./.test(p.dependencies['graphile-worker']))process.exit(1)"</automated>
  </verify>
  <acceptance_criteria>
    - `graphile-worker ~0.16.6` pinned in `package.json` dependencies
    - `package.json` does NOT contain `"bullmq"`, `"ioredis"`, or `"redis"` (no Redis dependency)
    - `src/jobs/runner.ts` exports `startWorker(): Promise<Runner>`; uses `run()` from graphile-worker with `concurrency: 5` and `taskList`
    - `src/jobs/tasks/echo.ts` exists and is type `Task`; header comment cites RESEARCH Pitfall 8
    - `src/jobs/enqueue.ts` exports `enqueueJob(tx, taskName, payload, opts)` calling `graphile_worker.add_job(...)` with the verified signature
    - `scripts/jobs/start-worker.ts` exists as the worker entrypoint
    - `docs/adr/0001-queue-backend.md` exists with sections: Context, Decision, Alternatives Considered, Consequences, Verification, Revisit Criteria
    - `tests/jobs/enqueue.test.ts` has 3 test cases (COMMIT enqueues, ROLLBACK doesn't, jobKey dedupes); all pass
    - `tests/jobs/worker-without-with-tenant.test.ts` has 2 test cases (probe without withTenant → 0 rows; probe with withTenant → expected rows); all pass
    - `pnpm test:unit tests/jobs/` exits 0
  </acceptance_criteria>
  <done>Graphile-Worker installed at pinned version; runner + task harness + transactional enqueueJob helper shipped; ADR-0001 documents the decision; integration tests prove outbox semantics; no Redis anywhere in dependencies.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Log line content → stdout/log aggregator | Pino redact filter strips password/token/cookie/authorization fields |
| Sentry payload → Sentry SaaS | Sentry's beforeSend / scope tagging; never sends raw passwords |
| App transaction → graphile_worker.add_job | SQL function call inside caller's transaction (outbox) — RLS doesn't apply (jobs are app-internal infrastructure) |
| Worker process → tenant data | Pitfall 8: worker uses separate pg pool; tasks MUST SET LOCAL app.current_tenant_id when reading tenant tables |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| (FOUND-10) | Repudiation | structured logs | mitigate | Pino JSON with requestId+tenantId child bindings; redact filter for passwords/tokens; CI verifies redact list present |
| (FOUND-11) | Repudiation | error tracking | mitigate | Sentry server+client+edge configs; tenant_id scope tagging documented |
| (FOUND-14) | Tampering | queue backend choice | mitigate | ADR-0001 documents Graphile-Worker; Task 2 checkpoint verifies add_job signature live before depending on it |
| (RESEARCH Pitfall 8) | Information Disclosure | worker→tenant table reads | mitigate | task header comments mandate withTenant() inside task body; documented in tasks/echo.ts header; will be lint-rule candidate later |
| (RESEARCH Pitfall 5) | Tampering | Sentry config file names | mitigate | Task 1 verifies all three sentry.*.config.ts files exist (NOT instrumentation-client.ts which is Next 16) |
</threat_model>

<verification>
1. `pnpm test:unit tests/logging/ tests/jobs/` exits 0.
2. `bash scripts/ci/check-no-embedded-db.sh` exits 0 (no Redis, no SQLite — verify package.json).
3. `docs/adr/0001-queue-backend.md` exists with all six required sections.
4. `pnpm worker:dev` boots a worker (manual smoke: `pnpm db:up && pnpm worker:dev` — should log "starting worker" via Pino).
5. Sentry config files have correct file names per Pitfall 5.
</verification>

<success_criteria>
- Pino logger emits structured JSON with redact filter; childLogger() supports requestId/tenantId/userId bindings
- Sentry server+client+edge configs initialized via instrumentation.ts; file names per RESEARCH Pitfall 5
- Graphile-Worker 0.16.6 installed; runner + tasks dir + enqueueJob() shipped
- ADR-0001 documents queue decision with revisit criteria
- Task 2 checkpoint verified graphile_worker.add_job() SQL signature live
- Outbox semantics proven by tests/jobs/enqueue.test.ts (COMMIT enqueues, ROLLBACK doesn't, jobKey dedupes)
- No Redis dependency anywhere in package.json
</success_criteria>

<output>
Create `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-06-SUMMARY.md` listing:
- Pinned versions of pino, @sentry/nextjs, graphile-worker
- Logger API summary (logger + childLogger)
- Sentry config file names + verified absence of instrumentation-client.ts
- Graphile-Worker add_job signature verified in Task 2 checkpoint (paste captured signatures)
- ADR-0001 link
- Open items for Plan 07 (worker runs as separate Coolify service; deploy hook calls runMigrations before app starts)
</output>
