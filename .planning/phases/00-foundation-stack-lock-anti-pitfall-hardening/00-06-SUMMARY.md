---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 06
subsystem: observability+jobs
tags: [observability, pino, sentry, graphile-worker, jobs, adr, outbox, rls]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "Postgres + Drizzle + RLS + withTenant() (Plan 03) — worker tasks must use withTenant() to honor RLS in the worker process"
      - "Better Auth middleware with x-request-id (Plan 04) — Pino child-logger consumes this for correlation"
      - "audit_log table (Plan 05) — Pino bindings + audit row both carry tenantId/requestId for cross-log/DB correlation"
provides:
  - "Pino structured logger (`src/lib/logger.ts`) with `childLogger({requestId, tenantId, userId})` bindings + redact filter for password/token/cookie/authorization"
  - "Next.js instrumentation hooks (`src/instrumentation.ts` + `src/instrumentation-node.ts`) that emit a server-init log line and gate Node-only imports behind NEXT_RUNTIME==='nodejs'"
  - "Sentry server+client+edge configs with the EXACT file names per RESEARCH Pitfall 5 (NOT instrumentation-client.ts which is Next.js 16)"
  - "next.config.ts wrapped with withSentryConfig + keeps output: 'standalone' from Plan 01"
  - "Graphile-Worker 0.16.6 schema bootstrap (migration 0008) + RLS policy hook (migration 0009) so the app role can claim jobs under our NOBYPASSRLS contract"
  - "src/jobs/runner.ts: startWorker() boots Graphile-Worker with concurrency 5; loads tasks from src/jobs/tasks/"
  - "src/jobs/enqueue.ts: enqueueJob(tx, taskName, payload, opts) — transactional outbox helper using the verified add_job named-arg signature with the load-bearing ::text::json double cast"
  - "src/jobs/tasks/{echo,index}.ts: smoke-test task + registry, with the load-bearing Pitfall 8 withTenant() header reminder"
  - "scripts/jobs/start-worker.ts: separate-process entrypoint (Plan 07 wires it as its own Coolify service)"
  - "docs/adr/0001-queue-backend.md: ADR-0001 — Graphile-Worker over pg-boss, with Phase 4 revisit criteria"
  - "package.json: worker:dev + worker:start scripts (no new dependencies — graphile-worker was added by Task 1)"
  - "3 jobs test files (8 cases) + 1 logging test file proving the structural contracts"
affects:
  - 00-07-coolify-deploy                  # Worker runs as a SEPARATE Coolify service; deploy hook must run migrations BEFORE both web AND worker start
  - phase-1+                              # Every Server Action that needs a side-effect (email, webhook, PDF) now has a 1-line outbox path via enqueueJob(tx, ...)
  - phase-2-pagar.me                      # Webhook handler will enqueueJob() inside the order COMMIT — outbox guarantee proven by tests/jobs/enqueue.test.ts

# Tech tracking
tech-stack:
  added:
    - "pino ~10.3.1 (structured JSON logger) — committed in b2b515d"
    - "pino-pretty (dev-only transport) — committed in b2b515d"
    - "@sentry/nextjs ~10.57.0 (error tracking + tracing) — committed in b2b515d"
    - "graphile-worker ~0.16.6 (Postgres-backed queue) — committed in b2b515d"
    - "(no Redis, no BullMQ — Phase 0 contractual constraint enforced)"
  patterns:
    - "Pattern: childLogger({requestId, tenantId, userId}) — every Server Action should call this once and reuse the bound logger so every emitted log line carries correlation IDs without per-call boilerplate"
    - "Pattern: Pino redact list as a security primitive — adding a new credential field anywhere in the codebase grows this list; the patterns use Pino path syntax (`*.token` matches `token` at one level of nesting); top-level fields require an explicit entry"
    - "Pattern: instrumentation.ts gates Node imports behind NEXT_RUNTIME==='nodejs' — keeps Pino + Sentry server SDK + future worker bootstrap out of the Edge runtime bundle"
    - "Pattern: Sentry config file names are the EXACT triplet sentry.client.config.ts / sentry.server.config.ts / sentry.edge.config.ts — the Next.js 16 default instrumentation-client.ts is a wizard mistake (RESEARCH Pitfall 5); withSentryConfig auto-loads the three files at the right runtime moments"
    - "Pattern: Worker process is a SEPARATE Node process (scripts/jobs/start-worker.ts) — decouples worker uptime from web uptime, isolates pg pools, lets Coolify scale them independently"
    - "Pattern: enqueueJob(tx, ...) inside a Server Action's transaction = textbook outbox — business write + job enqueue are atomic; ROLLBACK drops the side-effect (proven by tests/jobs/enqueue.test.ts ROLLBACK case)"
    - "Pattern: graphile_worker.add_job named-arg form (identifier => ..., payload => ::text::json, ...) — defends against future minor-version shifts that add optional args in the middle, and the ::text::json double cast defeats postgres.js's JSON-string parameter encoding"
    - "Pattern: every Task that reads tenant data MUST extract tenantId from payload and wrap its body in withTenant(tenantId, fn) — header comment in src/jobs/tasks/echo.ts is the structural template; verified loud by tests/jobs/worker-without-with-tenant.test.ts"

key-files:
  created:
    - "src/lib/logger.ts"
    - "src/instrumentation.ts"
    - "src/instrumentation-node.ts"
    - "sentry.client.config.ts"
    - "sentry.server.config.ts"
    - "sentry.edge.config.ts"
    - "src/jobs/runner.ts"
    - "src/jobs/enqueue.ts"
    - "src/jobs/tasks/echo.ts"
    - "src/jobs/tasks/index.ts"
    - "scripts/jobs/start-worker.ts"
    - "docs/adr/0001-queue-backend.md"
    - "src/db/migrations/0008_graphile_worker_install.sql"
    - "src/db/migrations/0009_graphile_worker_rls_policies.sql"
    - "src/db/migrations/meta/0008_snapshot.json"
    - "src/db/migrations/meta/0009_snapshot.json"
    - "tests/logging/request-id-binding.test.ts"
    - "tests/jobs/add-job-signature-probe.test.ts"
    - "tests/jobs/enqueue.test.ts"
    - "tests/jobs/worker-without-with-tenant.test.ts"
  modified:
    - "next.config.ts (wraps export with withSentryConfig, keeps output: 'standalone')"
    - "src/middleware.ts (Task 1 — log channel hook noted)"
    - "src/db/migrations/meta/_journal.json (entries 8 + 9)"
    - "package.json (pino + @sentry/nextjs + graphile-worker + pino-pretty + worker:dev/worker:start scripts)"

key-decisions:
  - "Worker runs as a SEPARATE process from Next.js (scripts/jobs/start-worker.ts). Coupling worker to web would freeze web hot-reload during long jobs and entangle pg pool exhaustion. Plan 07 wires it as its own Coolify service."
  - "graphile_worker schema bootstrap is delegated to graphile-worker's run() (bundled SQL migrations in node_modules/graphile-worker/sql/) — migration 0008 only reserves the schema + pre-grants USAGE + ALTER DEFAULT PRIVILEGES. Hand-writing the schema would freeze a version that drifts every minor release; the Task 2 probe test catches drift on every CI run."
  - "Migration 0009 installs a permissive RLS policy on every graphile_worker.* table for fb_eventos_app. Discovered during Task 3 test development: Graphile-Worker enables RLS but ships NO policies, and under our two-role NOBYPASSRLS model the worker silently never picks up jobs without a policy. The policy is permissive (USING true) because tenant isolation on jobs lives in the PAYLOAD, not in the row visibility — every task that reads tenant data MUST call withTenant(payload.tenantId, fn)."
  - "src/jobs/enqueue.ts uses ::text::json (NOT plain ::json) — postgres.js's default parameter encoding sends JS strings as JSON-string parameters, so a plain `JSON.stringify(payload)::json` cast stores the WHOLE stringified object as a JSON STRING value (json_typeof = 'string'). The double cast `::text::json` anchors PG's interpretation to the raw text bytes before the JSON parser runs. Discovered by inspecting the failed worker-without-with-tenant test; documented inline + asserted by the enqueue.test.ts payload round-trip case."
  - "ADR-0001 is Accepted (not Proposed) — PROJECT.md and CLAUDE.md already pin Graphile-Worker via the embedded-DB ban + Postgres-as-single-source-of-truth. ADR-001 ratifies the criteria from RESEARCH and documents the Phase 4 revisit triggers (multi-instance Coolify, job-inspection UI need, pg-boss API parity)."
  - "Sentry DSN is empty/no-op default. The three sentry.*.config.ts files guard with `if (dsn)` before calling Sentry.init() so CI runs without a real DSN still pass. Production values land in Coolify env (Plan 07)."

patterns-established:
  - "Pattern: 'Worker honors RLS the same as the web process' (RESEARCH Pitfall 8) — proven structurally by tests/jobs/worker-without-with-tenant.test.ts: a task without withTenant() reads 0 rows from a tenant-scoped business table even though it sees its own job row just fine. Every future task gets this safety net as long as it follows the src/jobs/tasks/echo.ts header template."
  - "Pattern: 'Probe test for SQL function signatures' — RESEARCH could not pin the graphile_worker.add_job signature (Assumption A1, Open Question 1). The probe test boots the worker briefly to install the schema, then reads pg_proc and invokes the named-arg form. If a future version drifts the signature, the test fails loudly BEFORE Phase 2's outbox depends on it. This pattern generalizes to any external schema we depend on (pgcrypto helpers, future PostGIS functions, etc.)."
  - "Pattern: 'Outbox via enqueueJob(tx, ...)' — Phase 2 Server Actions will write business data + enqueue side-effects in the SAME transaction; COMMIT durably enqueues, ROLLBACK suppresses, no orphan side-effects on crash. Tested in 3 enqueue cases (COMMIT/ROLLBACK/jobKey-dedup)."

requirements-completed:
  - FOUND-10
  - FOUND-11
  - FOUND-14
  - FOUND-16

# Metrics
duration: ~60min (Task 1 prior + Tasks 2-3 in this continuation)
completed: 2026-06-12
---

# Phase 00 Plan 06: Observability + Graphile-Worker Summary

**Layered structured observability (Pino with `requestId`/`tenantId` child bindings + redact filter + Sentry server/client/edge configs with the load-bearing file names per RESEARCH Pitfall 5) and the Postgres-backed background-job harness (Graphile-Worker 0.16.6) on top of the auth + multi-tenant stack. Probed and verified the `graphile_worker.add_job` SQL signature live against the running Postgres + installed schema (mitigates RESEARCH Assumption A1 BEFORE Phase 2's outbox depends on it). Implemented `enqueueJob(tx, ...)` for transactional outbox semantics — proven by 3 cases (COMMIT enqueues, ROLLBACK suppresses, jobKey deduplicates). Discovered + mitigated two real failure modes during runtime test development: (1) Graphile-Worker enables RLS but ships no policies, so under our NOBYPASSRLS contract the worker silently never picks up jobs — added migration 0009 with a permissive policy for fb_eventos_app; (2) postgres.js's default parameter encoding sends JS strings as JSON-string parameters, so the payload was stored as a JSON STRING — added the `::text::json` double cast in `enqueueJob`. RESEARCH Pitfall 8 (Worker process does NOT inherit `app.current_tenant_id`) is now structurally observable: `tests/jobs/worker-without-with-tenant.test.ts` proves a task without `withTenant()` reads 0 rows from a tenant-scoped table; a task WITH `withTenant()` sees the seeded row. ADR-0001 ratifies Graphile-Worker over pg-boss with explicit Phase 4 revisit criteria. 59/59 tests GREEN.**

## Performance

- **Duration:** ~60 min total (Task 1 prior to continuation, Tasks 2-3 in this continuation)
- **Tasks:** 3 / 3 (Task 1 + Task 3 `tdd="true"`; Task 2 = checkpoint:human-verify converted to in-line probe)
- **Files created:** 20 (incl. 3 Sentry configs + 2 migrations + 4 tests)
- **Files modified:** 4

## Commit Trail

| Commit  | Type | Scope                                                                                       |
| ------- | ---- | ------------------------------------------------------------------------------------------- |
| b2b515d | feat | Task 1 — Pino logger + Sentry configs + instrumentation hooks (prior to continuation)        |
| 7872bd6 | feat | Task 2 — graphile-worker schema install (migration 0008) + add_job signature probe test     |
| fec18fb | fix  | Probe test cleanup uses `task_id` subquery instead of nonexistent `task_identifier` column   |
| 31f6618 | feat | Task 3 — runner + enqueueJob + tasks + start-worker entrypoint + ADR-0001 + RLS migration 0009 + 2 tests |

## Pinned Versions (committed in b2b515d, no version drift in this continuation)

| Package          | Version    |
| ---------------- | ---------- |
| pino             | ~10.3.1    |
| pino-pretty      | ^13.1.3 (dev) |
| @sentry/nextjs   | ~10.57.0   |
| graphile-worker  | ~0.16.6    |

`pnpm install` is frozen-lockfile-compatible. No Redis dependency anywhere in `package.json` — verified by `pnpm check:db`.

## Logger API Summary

```ts
// Singleton — for cold paths (instrumentation-node.ts, scripts/jobs/start-worker.ts).
export const logger: pino.Logger

// Bound — for request-scoped code (Server Actions, Server Components, tasks).
export function childLogger(bindings: {
  requestId?: string
  tenantId?: string
  userId?: string
}): pino.Logger
```

**Redact list:** top-level + one-nesting-level `password`, `token`, `secret`, `authorization`; plus `req.headers.authorization`, `req.headers.cookie`, `req.body.password`, `req.body.token`. Verified by `tests/logging/request-id-binding.test.ts`.

## Sentry Config File Names — Pitfall 5 Mitigation

Three files in the repo root, with the EXACT names required by `@sentry/nextjs@10`:

| File                       | Runtime    | Purpose                                                                |
| -------------------------- | ---------- | ---------------------------------------------------------------------- |
| `sentry.client.config.ts`  | browser    | `Sentry.init({ dsn: NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1 })`  |
| `sentry.server.config.ts`  | Node (web) | `Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 })`              |
| `sentry.edge.config.ts`    | Edge       | `Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 })`              |

**Verified absence:** `test -f instrumentation-client.ts` returns false. The Next.js 16 default name is NOT present — the wizard's known-wrong output is structurally avoided.

`next.config.ts` wraps the export with `withSentryConfig(nextConfig, { silent: true, org: 'fb-eventos-placeholder', project: 'fb-eventos-web-placeholder', widenClientFileUpload: false, disableLogger: true, automaticVercelMonitors: false })`. Production org/project come from Coolify env in Plan 07. `output: 'standalone'` is preserved.

## Graphile-Worker `add_job` SQL Signature — Verified Live

Probe output captured in `tests/jobs/add-job-signature-probe.test.ts`:

```text
add_job(
  identifier text,
  payload json DEFAULT NULL,
  queue_name text DEFAULT NULL,
  run_at timestamptz DEFAULT NULL,
  max_attempts integer DEFAULT NULL,
  job_key text DEFAULT NULL,
  priority integer DEFAULT NULL,
  flags text[] DEFAULT NULL,
  job_key_mode text DEFAULT 'replace'
) RETURNS graphile_worker._private_jobs
```

`src/jobs/enqueue.ts` invokes the function with the **named-arg form**:

```sql
SELECT graphile_worker.add_job(
  identifier => ${taskName},
  payload => ${JSON.stringify(payload)}::text::json,
  run_at => ${runAt},
  job_key => ${jobKey},
  max_attempts => ${maxAttempts}
)
```

If a future graphile-worker version shifts arg names or types, the probe test fails BEFORE Phase 2 ships an outbox that depends on it. This mitigates RESEARCH Assumption A1 (the docs URL returned 404 at research time).

## Migrations Added

| File                                                       | What it does                                                                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0008_graphile_worker_install.sql`                         | Reserves the `graphile_worker` schema, grants USAGE to `fb_eventos_app`, pre-installs ALTER DEFAULT PRIVILEGES so every table created later by the runtime bootstrap auto-grants DML to the app role. Header carries the probed `add_job` signature for future reference. |
| `0009_graphile_worker_rls_policies.sql`                    | Creates `fb_install_graphile_worker_policies()` plpgsql function that idempotently installs a permissive policy `fb_eventos_app_full_access` on every RLS-enabled `graphile_worker.*` table. Calls the function once. **Discovered during Task 3 test development** — without policies, the worker silently never picks up jobs under our NOBYPASSRLS contract. |

## Outbox Semantics — Proven by `tests/jobs/enqueue.test.ts` (5 cases)

| Case                               | Assertion                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| COMMIT enqueues                    | Job inserted inside `pool.begin()` that COMMITs is visible in `graphile_worker.jobs` afterwards.                                          |
| ROLLBACK suppresses                | Job inserted inside `pool.begin()` that throws (rolls back) leaves NO row — **the load-bearing outbox guarantee**.                        |
| jobKey deduplicates                | Two enqueues with the same `jobKey` produce exactly one row; the second payload replaces the first (graphile-worker `job_key_mode='replace'` default). |
| Payload round-trip                 | JSON payload stored via `::text::json` cast round-trips through Postgres as a real JSON object — postgres.js auto-parses `json` columns on read. |
| Non-transactional Sql tag          | Passing the raw pool (instead of a TransactionSql) also works (single-statement implicit transaction).                                    |

## RLS-in-Worker Contract — Proven by `tests/jobs/worker-without-with-tenant.test.ts` (2 cases)

| Case                               | Assertion                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Task **without** `withTenant()`    | Reads 0 rows from `organization` even though a tenant + org row IS seeded — RLS default-deny because the worker's pg connection has no `app.current_tenant_id` set. |
| Task **with** `withTenant()`       | Reads 1 row (the seeded org). Same task code shape; the only difference is the `withTenant(payload.tenantId, async db => ...)` wrap.    |

Together: the failure mode that drove FB_APU04's tenant-isolation concerns is structurally **observable rather than silent** in this codebase. A future task author who forgets `withTenant()` gets 0 rows back — loud, not subtle.

## ADR-0001 Link

`docs/adr/0001-queue-backend.md` — Accepted; defends Graphile-Worker on:

- Postgres-native (no Redis = embedded-DB ban satisfied + one fewer infrastructure dependency for the Trindade pilot)
- Outbox-ready: `enqueueJob(tx, ...)` is one SQL function call inside any Server Action transaction
- ACID persistence: jobs are Postgres rows with the same durability + replication semantics as business data
- Active maintenance + reasonable community

Considered alternatives: pg-boss (revisit at Phase 4 if multi-instance Coolify), BullMQ (rejected — Redis violates Postgres-only constraint), self-rolled (rejected — reinvents the wheel), managed SaaS (deferred to Phase 4+).

## Decisions Made

1. **Worker is a separate Node process** — `scripts/jobs/start-worker.ts` runs as its own Coolify service (Plan 07 wiring). Coupling to web freezes hot-reload + entangles pg pools.
2. **Schema bootstrap delegated to graphile-worker's `run()`** — migration 0008 only reserves the schema + pre-grants USAGE/DEFAULT PRIVILEGES. Hand-writing would freeze a version that drifts.
3. **Migration 0009 installs RLS policies on graphile_worker.\*** — load-bearing; without it, our NOBYPASSRLS contract silently breaks the worker.
4. **`::text::json` cast in `enqueueJob`** — defeats postgres.js's JSON-string parameter encoding. Documented inline and tested by the payload round-trip case.
5. **ADR-0001 status = Accepted** (not Proposed) — PROJECT.md + CLAUDE.md already pin Graphile-Worker via the embedded-DB ban. The ADR ratifies and documents the Phase 4 revisit criteria.
6. **Sentry DSN empty default** — `sentry.*.config.ts` guards with `if (dsn)` so CI without a real DSN still passes. Production values via Coolify env (Plan 07).

## Deviations from Plan

### Auto-fixed Issues (Rule 1 / Rule 3)

**1. [Rule 1 - Bug] Probe test cleanup column name (`task_identifier` doesn't exist on `_private_jobs`)**

- **Found during:** First run of `tests/jobs/add-job-signature-probe.test.ts` (committed in 7872bd6).
- **Issue:** The cleanup DELETE used `task_identifier`, which lives on the `graphile_worker.jobs` VIEW but NOT on the underlying `_private_jobs` table (which has `task_id` as a FK to `_private_tasks`). Probe failed with "column does not exist".
- **Fix:** Use a subquery joining `_private_tasks` to resolve the identifier → task_id mapping. Pattern is version-stable across graphile-worker minor bumps.
- **Files modified:** `tests/jobs/add-job-signature-probe.test.ts`
- **Committed in:** `fec18fb`.

**2. [Rule 3 - Blocking] Graphile-Worker enables RLS on its tables but ships no policies — worker silently never picks up jobs under our NOBYPASSRLS contract**

- **Found during:** First run of `tests/jobs/worker-without-with-tenant.test.ts` (Task 3 implementation).
- **Issue:** The worker connected as `fb_eventos_app`, the runner reported "Worker connected and looking for jobs..." but then never executed any enqueued task. Direct query confirmed: `SELECT count(*) FROM graphile_worker._private_jobs` returned 0 rows for the app role even though the migrator role saw 1. Root cause: Graphile-Worker enables RLS on `_private_jobs`, `_private_tasks`, `_private_job_queues`, `_private_known_crontabs` but installs NO policies — its expected operational model is to connect as the table owner or a BYPASSRLS role. Our two-role model deliberately denies BYPASSRLS to every runtime path.
- **Fix:** New migration 0009 installs a permissive `fb_eventos_app_full_access` policy on every RLS-enabled `graphile_worker.*` table via a plpgsql function that's idempotent + forward-compat with future graphile-worker minor bumps that add tables.
- **Tenant isolation clarification:** This is a permissive policy because tenant isolation on JOBS lives in the PAYLOAD (every task that reads tenant data MUST call `withTenant(payload.tenantId, fn)`). Documented in the migration header + ADR + task-header reminders + proven loud by `worker-without-with-tenant.test.ts`.
- **Files modified:** `src/db/migrations/0009_graphile_worker_rls_policies.sql` (new), `src/db/migrations/meta/_journal.json`, `src/db/migrations/meta/0009_snapshot.json` (new).
- **Committed in:** `31f6618`.

**3. [Rule 1 - Bug] postgres.js stores JSON payload as a STRING (json_typeof = 'string') unless cast through ::text first**

- **Found during:** First end-to-end test of `worker-without-with-tenant.test.ts` (Task 3) — the positive case (task with `withTenant()`) crashed with `Failed query: SELECT set_config('app.current_tenant_id', , true)` — the tenantId was empty, meaning the payload destructuring failed.
- **Issue:** postgres.js's default parameter encoding sends JS strings as JSON-string parameters. The original `${JSON.stringify(payload)}::json` cast was interpreted by Postgres as "parse this JSON STRING (`'{"x":1}'`) as a json value" → stored as the JSON VALUE `"\\\"{\\\"x\\\":1}\\\""` (a quoted string). `json_typeof()` returned `'string'` instead of `'object'`. The graphile-worker pg driver then delivered the payload to the task handler as a JSON string instead of a JS object. Verified empirically by inspecting `pg_typeof` and `json_typeof` on the stored row.
- **Fix:** Use `::text::json` (double cast) in `src/jobs/enqueue.ts`. The `::text` first anchors PG's parameter interpretation to the raw text bytes (`'{"x":1}'` as text), then `::json` parses it correctly into a json object. Verified by `json_typeof = 'object'` + payload round-trip test.
- **Files modified:** `src/jobs/enqueue.ts` (cast change + 12-line comment), `tests/jobs/enqueue.test.ts` (assertions simplified — postgres.js auto-parses json on read), `tests/jobs/worker-without-with-tenant.test.ts` (defensive parsing removed).
- **Committed in:** `31f6618`.

### No Architectural Decisions (Rule 4)

No Rule 4 escalations. ADR-0001 documents the Graphile-Worker decision but it was already pinned by PROJECT.md + CLAUDE.md — the ADR is ratification, not a new decision.

### Checkpoint Conversion

Task 2 was originally `type="checkpoint:human-verify"`. The brief converted it to an in-line probe-and-validate flow because the signature matches RESEARCH expectations and the test itself is the proof. The probe test stays in the codebase as a regression guard for future graphile-worker bumps.

---

**Total deviations:** 3 auto-fixed (2 × Rule 1, 1 × Rule 3). No scope expansion. No contract changes from PLAN.md.

## Known Stubs

None. Every wired path has at least one test asserting its behavior. The `crontab` arg in `runner.ts` is empty (`''`) — Phase 2 will add `* * * * * expire-lot-reservations` and other periodic jobs. This is the intended "no cron in Phase 0" state per PLAN.md.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced beyond what the threat model in PLAN.md specified. The worker process surface (separate Coolify service) is documented for Plan 07.

## Open Items for Plan 07 (Coolify Deploy + Health + Walking Skeleton)

- **Worker as a separate Coolify service.** Same Docker image as the web; only the CMD differs (`node dist/worker.js` vs `node dist/web.js`). Both should restart on failure (Coolify `restart: always`).
- **Deploy hook: run migrations BEFORE both web and worker start.** Migration 0009's policy install runs BEFORE worker first boot, AND `runner.ts` (the worker's `run()` call) installs the schema on first boot — so the policy hook fires AFTER schema tables exist. Order matters: web/worker must wait for the migrations step (already drizzle-kit migrate, idempotent).
- **Coolify env: real Sentry DSN + auth token.** `SENTRY_DSN` (server), `NEXT_PUBLIC_SENTRY_DSN` (client), `SENTRY_AUTH_TOKEN` (source-map upload). Replace the placeholder org/project strings in `next.config.ts` via env override.
- **Worker process: log aggregation.** Pino's JSON output goes to stdout — Coolify ships container stdout to its log channel. If we add Loki/Sentry side-channel ingestion later, this is where to wire it.
- **Crontab: empty in Phase 0.** Phase 2 will add periodic jobs (lot-reservation expiry, daily LGPD purge). The runner's `crontab` option is a string — change in `runner.ts` and the cron tasks join the `taskList`.

## Self-Check: PASSED

- **All 20 expected created files exist on disk:**
  - `src/lib/logger.ts` ✓
  - `src/instrumentation.ts` ✓, `src/instrumentation-node.ts` ✓
  - `sentry.client.config.ts` ✓, `sentry.server.config.ts` ✓, `sentry.edge.config.ts` ✓
  - `src/jobs/runner.ts` ✓, `src/jobs/enqueue.ts` ✓
  - `src/jobs/tasks/echo.ts` ✓, `src/jobs/tasks/index.ts` ✓
  - `scripts/jobs/start-worker.ts` ✓
  - `docs/adr/0001-queue-backend.md` ✓
  - `src/db/migrations/0008_graphile_worker_install.sql` ✓
  - `src/db/migrations/0009_graphile_worker_rls_policies.sql` ✓
  - `src/db/migrations/meta/0008_snapshot.json` ✓
  - `src/db/migrations/meta/0009_snapshot.json` ✓
  - `tests/logging/request-id-binding.test.ts` ✓
  - `tests/jobs/add-job-signature-probe.test.ts` ✓
  - `tests/jobs/enqueue.test.ts` ✓
  - `tests/jobs/worker-without-with-tenant.test.ts` ✓

- **All 4 commits reachable in `git log`:**
  - `b2b515d` (Task 1 — Pino + Sentry + instrumentation)
  - `7872bd6` (Task 2 — schema install + probe test)
  - `fec18fb` (probe test cleanup fix)
  - `31f6618` (Task 3 — runner + enqueue + ADR + RLS migration + 2 tests)

- **Quality gates:**
  - `pnpm test` → 18 test files, 59 tests, 0 failures, ~42s
  - `pnpm tsc --noEmit` → exit 0
  - `pnpm check:db` → exit 0 (no embedded-DB / Redis dependency)
  - `pnpm check:all` → exit 0 (all six CI gates)
  - `pnpm worker:dev` smoke test → boots, logs "starting worker" + "worker ready", drains cleanly on SIGTERM

- **Live PG catalog matches contract** (verified):
  - 5 graphile_worker tables exist after first runner boot
  - 4 of them have `fb_eventos_app_full_access` policy installed (migrations 0009 hook)
  - The 5th (`migrations`) has RLS disabled (graphile-worker internal — owner-only access)
  - `add_job` named-arg form is callable from both `fb_eventos_app` and `fb_eventos_migrator`
  - Jobs enqueued via `enqueueJob` round-trip with `json_typeof(payload) = 'object'`

- **Task 1's `tests/logging/request-id-binding.test.ts` still GREEN** after Task 3 changes — no regression.

- **Plan 04's tests still GREEN** (auth flows, session, tenant isolation E2E — 17 cases unchanged).

- **Plan 05's tests still GREEN** (LGPD audit/consent/soft-delete/PII — 10 cases unchanged).

---
*Phase: 00-foundation-stack-lock-anti-pitfall-hardening*
*Completed: 2026-06-12*
