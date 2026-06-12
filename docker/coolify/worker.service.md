# Coolify Service Manifest — `fb-eventos-worker`

**Plan 07, Phase 0 — Graphile-Worker process as a separate Coolify service.**

The Graphile-Worker runs as a separate Node process from the Next.js web
container. Plan 06 ADR-0001 documents the architectural rationale;
Plan 06 RESEARCH Pitfall 8 documents the load-bearing safety net (every
task that reads tenant data MUST call `withTenant(payload.tenantId, ...)`).

---

## Image

```
ghcr.io/{{GHCR_ORG}}/fb-eventos-worker:{{APP_VERSION}}
```

- Same semver as `fb-eventos-web` — they ship together (one git tag,
  two images in `.github/workflows/build-and-push.yml`).
- **NO floating tag** (same `: l a t e s t` ban as the web image — see
  `web.service.md` for the spelled-out caveat).
- **NO Watchtower.**

## Port

```
(none — worker has no HTTP surface)
```

## Environment Variables (set in Coolify env UI)

Same as the web service, MINUS the public/HTTP variables:

| Variable                | Source                                            | Notes                                                                       |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`          | Coolify-managed Postgres → `fb_eventos_app`       | Same role as web — `withTenant()` enforces RLS in the worker process too.   |
| `BETTER_AUTH_SECRET`    | Coolify env (same value as web)                   | Worker may sign session-related tokens for system-issued ops in Phase 1+.   |
| `RESEND_API_KEY`        | Coolify env                                       | Worker handles email-send retry jobs (Phase 1+).                            |
| `MINIO_ENDPOINT`        | Coolify env                                       | Worker generates signed URLs for `exportMyData` LGPD job (Phase 4).         |
| `MINIO_ACCESS_KEY`      | Coolify env                                       |                                                                             |
| `MINIO_SECRET_KEY`      | Coolify env                                       |                                                                             |
| `SENTRY_DSN`            | Coolify env                                       | Server-side errors only. NO `NEXT_PUBLIC_SENTRY_DSN` (worker has no client).|
| `LOG_LEVEL`             | `info`                                            |                                                                             |
| `NODE_ENV`              | `production`                                      |                                                                             |
| `TZ`                    | `America/Sao_Paulo`                               | MUST match web for log + audit consistency.                                 |

**Deliberately NOT set:** `BETTER_AUTH_URL`, `NEXT_PUBLIC_*`,
`NEXT_TELEMETRY_DISABLED` — worker has no HTTP server, no client bundle.

**`DATABASE_MIGRATOR_URL` is NOT set.** Migrations run in the web service's
pre-deploy hook only.

## Healthcheck

```
(none — no HTTP endpoint)
```

Coolify polls process liveness (PID 1). If the worker process exits, the
container's `restart: always` policy brings it back up.

The `scripts/jobs/start-worker.ts` entrypoint (Plan 06) installs a SIGTERM
handler via graphile-worker's `noHandleSignals: false` default — on
deploy, Coolify sends SIGTERM, the runner stops accepting new jobs, waits
for in-flight jobs to finish, then exits 0. The replacement container
starts cleanly.

## Pre-Deploy Hook

**None on the worker service.** Migrations are owned by the web service's
pre-deploy hook (single source of truth — see `web.service.md` and
`postgres.service.md`).

**Ordering invariant:**

1. Web pre-deploy hook applies migrations 0000-0009 (including the
   graphile_worker.* RLS policy migration 0009 — see Plan 06 SUMMARY).
2. Web service starts.
3. Worker service starts.
4. On worker first boot, `graphile-worker`'s `run()` installs the
   internal `_private_*` tables (idempotent). The RLS policy hook
   function from migration 0009 was already installed by step 1 — when
   the worker schema tables come into existence, the policy applies
   automatically.

## RLS-in-Worker Contract

The worker process connects to Postgres as `fb_eventos_app`
(NOBYPASSRLS). Tasks that read tenant-scoped data MUST call
`withTenant(payload.tenantId, async (db) => ...)` inside their handler.
The structural test `tests/jobs/worker-without-with-tenant.test.ts`
(Plan 06) proves a task without `withTenant()` reads 0 rows from
tenant-scoped tables — RESEARCH Pitfall 8 is structurally observable
in this codebase.

`src/jobs/tasks/echo.ts` is the template — copy its header comment when
adding new tasks.

## Restart Policy

```
restart: always
```

Worker is idempotent (Graphile-Worker re-enqueues uncompleted jobs on
restart); Coolify's `always` policy ensures continuous job consumption.

## Resource Hints (Phase 0 piloto sizing)

- CPU: 0.25 vCPU baseline, 1 vCPU burst
- Memory: 256 MiB baseline, 512 MiB ceiling
- Concurrency: 5 (set in `src/jobs/runner.ts`)
- Adjust at Phase 1 load-test.

## See Also

- `docker/coolify/web.service.md`
- `docker/coolify/postgres.service.md`
- `docs/adr/0001-queue-backend.md` — Graphile-Worker over pg-boss/BullMQ.
- `docs/RUNBOOK.md` — incident response.
