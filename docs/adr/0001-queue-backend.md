# ADR-0001 — Queue backend: Graphile-Worker (over pg-boss, BullMQ)

- **Status:** Accepted
- **Date:** 2026-06-12
- **Deciders:** Solo dev (FB_EVENTOS) — informed by `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md` "ADR-001 Recommendation"
- **Requirement traced:** FOUND-14

## Context

FB_EVENTOS needs a background-job queue for, at minimum:

- Pagar.me webhook retries (Phase 2).
- Email dispatch + retry (welcome / confirmation / receipt).
- PDF generation (contracts, invoices, receipts).
- Reservation expiration cron (the Fornecedor flow holds lots for N minutes before re-releasing them).
- Periodic data purges / LGPD-driven anonymization (Phase 4).

Three architectural constraints narrow the candidate set:

1. **PROJECT.md / CLAUDE.md contractual ban on embedded DBs.** No SQLite-backed queues, no file-watermark trackers, no in-process JSON queues. The ban traces directly to the FB_APU04 incident where a SQLite-backed bridge accumulated unbounded watermark state and tenant isolation was config-stem (fragile, no validation).
2. **Postgres-as-single-source-of-truth.** Adding Redis is an extra moving part for the pilot deployment (Festa de Trindade/GO, ≤3 months timeline). Every dependency added now must be carried by the solo dev for the entire pilot.
3. **Outbox pattern for Phase 2.** Server Actions need to enqueue side-effects (email, webhook callback) atomically with the business write. This is impossible if the queue lives in a separate datastore from the business data — a crash between business COMMIT and queue INSERT silently drops the side-effect.

## Decision

Adopt **Graphile-Worker 0.16.6** as the queue backend for Phase 0 through Phase 3.

The queue tables (`graphile_worker._private_jobs`, `_private_tasks`, etc.) live in the same Postgres instance as application data. Schema bootstrap is invoked at runtime by `run()` on first start; migration `0008_graphile_worker_install.sql` pre-creates the schema and pre-grants DML privileges to `fb_eventos_app` so the runtime worker process can read/write jobs without DDL.

The runner is a SEPARATE Node process (`scripts/jobs/start-worker.ts`) — independent uptime from the Next.js web process. Plan 07 will wire it as its own Coolify service.

## Alternatives Considered

| Option | Why not in Phase 0–3 | Revisit at |
|--------|----------------------|-----------|
| **pg-boss 12.x** | Also Postgres-native and viable. More features (multi-master coordination, web dashboard, official Drizzle adapter). Larger API surface; less idiomatic for "enqueue inside a transaction via a SQL function call". | Phase 4, if multi-instance Coolify becomes required AND Graphile-Worker's coordination story proves insufficient. |
| **BullMQ + Redis 7** | Requires a Redis container. Violates the "Postgres-as-single-source-of-truth" constraint and adds an additional operational surface the solo dev must own during the Trindade pilot. | Never within the constraint window. Re-evaluate only if Redis enters the stack for a different reason (e.g. session cache, rate limiting) AND queue scale exceeds Graphile-Worker's single-master ceiling. |
| **Self-rolled `_jobs` table + LISTEN/NOTIFY** | Reinvents Graphile-Worker poorly. We would re-implement retries, exponential backoff, job locks, cron, idempotency keys — all of which Graphile-Worker provides for free with an active maintainer. | Never. |
| **AWS SQS / Cloud Tasks / Inngest / Trigger.dev (managed)** | Vendor lock-in; each adds a network hop to side-effect dispatch; outbox pattern becomes harder (two-phase commit across Postgres + SaaS). | Phase 4+ if the team grows and operational burden becomes a more expensive resource than vendor lock-in. |

## Consequences

### Positive

- **One fewer infrastructure dependency.** No Redis container in `docker/compose.yml` or in Coolify. The pilot deploy is web + worker + Postgres + MinIO — that's it.
- **Outbox pattern is one SQL function call.** `enqueueJob(tx, taskName, payload, opts)` runs inside any Server Action's transaction; the job row commits atomically with the business write. See `src/jobs/enqueue.ts`.
- **Tasks are typed Node functions.** No separate language or runtime to learn.
- **Cron is built-in.** Phase 2's reservation-expiry cron is a one-line addition to `runner.ts`'s `crontab` option.
- **ACID job persistence.** The FB_APU04 sqlite-watermark anti-pattern is structurally impossible — jobs are Postgres rows with the same durability and replication semantics as business data.
- **Active maintenance.** Graphile-Worker is part of the Graphile project (Postgraphile ecosystem), released regularly, type-safe with first-class TypeScript types.

### Negative

- **Single-master.** One runner consumes one database. Multi-instance Coolify deploy in Phase 4 may want pg-boss's multi-master coordination — explicitly listed as the revisit trigger in the table above.
- **No first-party web dashboard.** Job inspection is via `psql` queries against `graphile_worker.jobs`. For the pilot this is acceptable; if a dashboard becomes worth the integration cost, the revisit criteria below apply.
- **Worker is a separate Node process.** One more deploy artifact than a monolithic web server. Mitigated: it shares the same Docker image; only the CMD differs (Plan 07 wires this).

## Verification

- `tests/jobs/add-job-signature-probe.test.ts` — verifies the `graphile_worker.add_job` SQL signature is still callable on every test run (mitigates RESEARCH Open Question 1 / Assumption A1 — the signature could drift between minor versions).
- `tests/jobs/enqueue.test.ts` — verifies transactional outbox semantics: COMMIT enqueues, ROLLBACK does not, and `jobKey` deduplicates.
- `tests/jobs/worker-without-with-tenant.test.ts` — verifies RESEARCH Pitfall 8 mitigation: a worker task that reads tenant data WITHOUT calling `withTenant()` returns 0 rows (RLS default-deny), making the misuse loud rather than silent.

## Revisit Criteria

Re-evaluate this ADR at the start of Phase 4 planning if **any** of the following becomes true:

- Multi-instance Coolify deploy becomes required (load exceeds a single Node process / a single runner database connection cap).
- Job inspection / failure-replay UI becomes worth a managed-service integration cost.
- pg-boss adds Graphile-Worker-equivalent transactional-enqueue ergonomics that materially close the API-shape gap.
- A separate, validated need for Redis enters the stack (e.g. session cache, rate limiting) — at which point BullMQ becomes "free" infrastructure-wise and the trade-off shifts.

When revisiting, the deliverable is ADR-0001-update.md (amendment, not replacement) so the original decision context stays intact for future maintainers.

## References

- `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md` — sections "Pattern 6: Graphile-Worker Setup", "Assumptions Log A1", "Open Questions #1", "ADR-001 Recommendation".
- `CLAUDE.md` — "What NOT to Use" table (SQLite ban, BullMQ-vs-Graphile-Worker note).
- `.planning/PROJECT.md` — Constraints section ("Persistência: PostgreSQL como source-of-truth único. Proibido SQLite embarcado...").
- `src/db/migrations/0008_graphile_worker_install.sql` — schema bootstrap + default-privileges hook.
- `src/jobs/runner.ts`, `src/jobs/enqueue.ts`, `src/jobs/tasks/` — the implementation this ADR justifies.
