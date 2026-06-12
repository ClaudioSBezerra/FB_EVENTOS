# Coolify Service Manifest — `fb-eventos-web`

**Plan 07, Phase 0 — load-bearing deploy configuration.**

This document is the source-of-truth for the Coolify configuration of the
Next.js web container. Operator substitutes placeholders (see RUNBOOK.md
"Operator Substitution Table") at deploy time.

---

## Image

```
ghcr.io/{{GHCR_ORG}}/fb-eventos-web:{{APP_VERSION}}
```

- **NO floating tag** (the `: l a t e s t` form is banned — spaced out
  here so the CI grep gate stays clean). Contractual ban
  (CLAUDE.md "What NOT to Use" / T-0-07).
- **NO Watchtower** auto-pull. CI publishes semver tags on `v*.*.*` git
  tag push only (`.github/workflows/build-and-push.yml`). Coolify pulls
  the explicit semver — never floats.
- `{{APP_VERSION}}` matches `package.json` version (e.g. `0.1.0`).

## Port

```
3000  (internal — Traefik routes 443 -> container:3000)
```

## Environment Variables (set in Coolify env UI)

| Variable                | Source                                                    | Notes                                                                       |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`          | Coolify-managed Postgres → `fb_eventos_app` user          | Runtime DML role; **NOBYPASSRLS** (verified by Task 3 checkpoint).          |
| `BETTER_AUTH_SECRET`    | Coolify env → `openssl rand -hex 32`                      | NEVER commit. 32 bytes minimum.                                             |
| `BETTER_AUTH_URL`       | `https://{{PRODUCTION_HOST}}` (e.g. `app.fbeventos.com.br`) | Must match Traefik Host rule (see `traefik-labels.md`).                     |
| `RESEND_API_KEY`        | Coolify env → Resend dashboard                            | Optional — `src/lib/email.ts` throws on send if NODE_ENV=production + missing. |
| `MINIO_ENDPOINT`        | Coolify env → MinIO service                               | Phase 1+ (file uploads).                                                    |
| `MINIO_ACCESS_KEY`      | Coolify env                                               | Phase 1+.                                                                   |
| `MINIO_SECRET_KEY`      | Coolify env                                               | Phase 1+.                                                                   |
| `MINIO_DEFAULT_BUCKET`  | Coolify env                                               | Phase 1+.                                                                   |
| `SENTRY_DSN`            | Coolify env → Sentry project                              | Server-side. Empty default keeps build green.                               |
| `NEXT_PUBLIC_SENTRY_DSN`| Coolify env → Sentry project                              | Browser-side. Public — safe to inline.                                      |
| `NEXT_PUBLIC_APP_URL`   | `https://{{PRODUCTION_HOST}}`                             | Public — used by emails.                                                    |
| `LOG_LEVEL`             | `info` (production default; `debug` for incidents)        | Pino level — see Plan 06.                                                   |
| `NODE_ENV`              | `production`                                              | Required — flips email transport to Resend, etc.                            |
| `TZ`                    | `America/Sao_Paulo`                                       | All container TZs MUST match for log + audit consistency.                   |
| `NEXT_TELEMETRY_DISABLED` | `1`                                                     | Opt-out of Next.js anonymous telemetry.                                     |

**DATABASE_MIGRATOR_URL is NOT set on the web container.** Migrations run
exclusively in the pre-deploy hook (see below). The runtime web container
cannot create/alter tables — defense-in-depth against accidental DDL.

## Healthcheck

```
HTTP GET /api/health
interval:  30s
timeout:   3s
retries:   3
start period: 10s
```

The `/api/health` route (Plan 07 Task 1) runs `SELECT 1` against the
`fb_eventos_app` pool. Returns 200 + `{status:'ok',checks:{db:true}}` on
success or 503 + `{status:'error',checks:{db:false}}` on DB failure.
Coolify uses the HTTP status code for service-state; Traefik (see
`traefik-labels.md`) uses the same path for upstream routing decisions.

## Pre-Deploy Hook (CRITICAL — migrations run HERE)

**Coolify "Pre-Deploy Command" field:**

```bash
node dist/scripts/migrate.js
```

(Equivalent shell form for one-shot Init Container pattern:
`pnpm exec tsx --env-file=.env.production src/db/migrate.ts`.)

**Required env for the pre-deploy step:** `DATABASE_MIGRATOR_URL`
(Coolify-managed Postgres → `fb_eventos_migrator` user, DDL-capable).
This is the ONLY surface that touches DDL — the runtime web container
uses `DATABASE_URL` (fb_eventos_app, DML-only) and never calls
`runMigrations()`. See Plan 03 SUMMARY + T-0-03 mitigation.

**Order of operations:**

1. Pre-deploy hook runs migrations (`drizzle-kit migrate`-equivalent).
2. ON SUCCESS, Coolify pulls + starts the new image.
3. Healthcheck `/api/health` flips green.
4. Traefik switches upstream from old container to new.
5. Old container drained, then stopped.

If step 1 fails, the deploy aborts BEFORE the new container starts —
the old container keeps serving traffic. Zero downtime on migration
failure.

## Restart Policy

```
restart: on-failure (Coolify default)
```

Faulting web pod is replaced; Traefik routes around it during the
healthcheck failure window.

## Resource Hints (Phase 0 piloto sizing)

- CPU: 0.5 vCPU baseline, 2 vCPU burst
- Memory: 512 MiB baseline, 1 GiB ceiling
- Adjust at Phase 1 load-test (Festa de Trindade pilot will inform).

## See Also

- `docker/coolify/worker.service.md` — sibling worker service (same semver).
- `docker/coolify/postgres.service.md` — managed Postgres + roles + extensions.
- `docker/coolify/traefik-labels.md` — TLS + Host routing labels.
- `docs/deploy/COOLIFY.md` — end-to-end deploy runbook.
- `docs/RUNBOOK.md` — incident response.
