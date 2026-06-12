# Coolify Deploy Runbook — FB_EVENTOS

**Plan 07, Phase 0 — load-bearing operational document.**

This is the source-of-truth for deploying FB_EVENTOS to a Coolify-managed
host (Hetzner / AWS EC2 / DigitalOcean). Every section is required reading
before the first deploy.

> **Operator substitution table:** the placeholders in this doc map to
> `docs/RUNBOOK.md` "Operator Substitution Table". Set every `{{...}}`
> value in the Coolify env UI before triggering a deploy.

---

## Section 1 — First-Time Setup

### 1.1 Provision the Coolify host

1. Provision a VM (Hetzner CX21 minimum for piloto; CPX31 recommended).
2. Install Coolify per the official docs (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`).
3. Verify Coolify dashboard reachable at `https://{{COOLIFY_URL}}` (you
   may want a separate subdomain for the dashboard itself, e.g.
   `coolify.fbeventos.com.br`).

### 1.2 Connect GitHub + GHCR

1. In Coolify dashboard → "Sources" → "Add Git Source" → GitHub App
   installation OR Personal Access Token (PAT) with `repo` + `read:packages`.
2. Coolify pulls images from GHCR — ensure the Coolify host has access:
   - Public GHCR images: no auth needed.
   - Private GHCR images: in Coolify → "Servers" → your server →
     "Container Registries" → "Add" → GHCR + PAT with `read:packages`.

### 1.3 Provision Postgres

1. Coolify dashboard → "Resources" → "Add Resource" → "Database" → "Postgres 16".
2. Coolify auto-generates a superuser + password. Save them in Coolify's
   secrets vault.
3. Once provisioned, open the Postgres service "Terminal" tab and run
   the role bootstrap (this requires the superuser conn URL):
   ```bash
   PG_BOOTSTRAP_URL='postgresql://{{COOLIFY_PG_SUPERUSER}}:{{COOLIFY_PG_SUPERUSER_PW}}@localhost:5432/postgres' \
     bash scripts/db/setup-roles.sh
   ```
   This creates `fb_eventos_app` (NOBYPASSRLS) + `fb_eventos_migrator`
   per `docker/coolify/postgres.service.md`.
4. Enable the required extensions (one-time, may need Postgres superuser):
   ```sql
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
   If Coolify's UI has an "Extensions" panel, enable them there first
   (RESEARCH Open Question #2).

### 1.4 Provision MinIO

1. Coolify → "Resources" → "Add Resource" → "Object Storage" → MinIO.
2. Save the auto-generated `MINIO_ROOT_USER` + `MINIO_ROOT_PASSWORD`.
3. Create the `fb-eventos` bucket via the MinIO console + a per-tenant
   prefix policy.

### 1.5 Set Coolify Env Vars

For each of `fb-eventos-web` and `fb-eventos-worker`, populate the env
vars listed in `docker/coolify/{web,worker}.service.md`. Source secrets:

| Placeholder              | Source                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `{{DB_APP_PASSWORD}}`    | `scripts/db/setup-roles.sh` output (Step 1.3)                    |
| `{{DB_MIGRATOR_PASSWORD}}` | `scripts/db/setup-roles.sh` output (Step 1.3)                  |
| `{{BETTER_AUTH_SECRET}}` | `openssl rand -hex 32` (generate ONCE, store in Coolify vault)   |
| `{{RESEND_API_KEY}}`     | Resend dashboard → API Keys                                      |
| `{{SENTRY_DSN}}`         | Sentry → Project Settings → Client Keys (DSN)                    |
| `{{SENTRY_AUTH_TOKEN}}`  | Sentry → Settings → Auth Tokens (`project:releases` scope)       |
| `{{MINIO_ACCESS_KEY}}`   | MinIO Console → Identity → Service Accounts                      |
| `{{MINIO_SECRET_KEY}}`   | MinIO Console → Identity → Service Accounts                      |
| `{{PRODUCTION_HOST}}`    | Your chosen production hostname (e.g. `app.fbeventos.com.br`)    |

### 1.6 Configure DNS + TLS

See `docker/coolify/traefik-labels.md` Section "DNS Setup". After DNS
propagates, Coolify's Traefik will obtain the Let's Encrypt cert on the
first request.

---

## Section 2 — Per-Service Configuration

Each service has its own dedicated manifest:

- `docker/coolify/web.service.md` — Next.js web container.
- `docker/coolify/worker.service.md` — Graphile-Worker process.
- `docker/coolify/postgres.service.md` — Postgres 16 + role + extensions.
- `docker/coolify/traefik-labels.md` — TLS + Host routing.

Follow each in order; the web service's pre-deploy hook depends on the
Postgres roles existing (Step 1.3) and the worker depends on migration
0009's RLS policy hook being installed.

---

## Section 3 — Deploy Procedure (every release)

### 3.1 Cut a release

```bash
# On your local machine, on a clean main branch:
git pull --rebase origin main

# Bump the version (patch for hotfix, minor for new plan-level features,
# major for breaking schema changes).
pnpm version patch              # → e.g. 0.1.0 -> 0.1.1
git push --follow-tags
```

### 3.2 CI builds + pushes images

`.github/workflows/build-and-push.yml` triggers on the `v*.*.*` tag:

1. Builds `ghcr.io/{{GHCR_ORG}}/fb-eventos-web:{{APP_VERSION}}`.
2. Builds `ghcr.io/{{GHCR_ORG}}/fb-eventos-worker:{{APP_VERSION}}`.
3. Pushes both to GHCR.
4. Floating-tag guard re-verifies no `:latest` snuck in.

Verify via GitHub Actions tab — both jobs green within ~5 min.

### 3.3 Coolify pulls + deploys

1. Coolify dashboard → `fb-eventos-web` service → "Settings" →
   "Image Tag" → update to the new semver (e.g. `0.1.1`).
2. Repeat for `fb-eventos-worker`.
3. Click "Deploy" on the web service. Coolify:
   - Runs the pre-deploy hook (`node dist/scripts/migrate.js`).
   - On hook success, pulls the new image.
   - Starts the new container; waits for `/api/health` to return 200.
   - Switches Traefik upstream from old to new.
   - Stops the old container.
4. Click "Deploy" on the worker service. Coolify:
   - Sends SIGTERM to the old worker; awaits drain.
   - Pulls the new image; starts it.

**Migration ordering invariant:** the web service's pre-deploy hook MUST
finish before the worker starts (it installs migration 0009's RLS policy
hook that the worker needs to claim jobs). If you deploy the worker
first, jobs will silently never be picked up — proven by Plan 06's
"discovery during Task 3 test development" debugging note.

### 3.4 Verify the deploy

```bash
# 1. /api/health returns 200 + JSON {status:'ok',checks:{db:true}}
curl -fsSL https://{{PRODUCTION_HOST}}/api/health

# 2. Pino logs in Coolify "Logs" tab are JSON (no plaintext leak)
# 3. Sentry "Releases" tab shows {{APP_VERSION}}
# 4. Worker logs include "worker ready — awaiting jobs"
```

---

## Section 4 — Rollback Procedure

### When to rollback

- `/api/health` returns 503 after deploy (DB unreachable).
- Sentry shows a spike in errors tagged with the new release.
- Real-user reports indicate broken functionality.

### How to rollback

1. Coolify dashboard → `fb-eventos-web` → "Settings" → "Image Tag" →
   change back to the previous semver (e.g. `0.1.0`).
2. Click "Deploy". Coolify pulls the previous image.
3. Repeat for `fb-eventos-worker`.

### Schema implications

Phase 0 ships **forward-only migrations**. If a deploy applied a new
migration (the pre-deploy hook ran), the previous image may not be
compatible with the new schema. In that case:

1. STOP. Rolling back the image WITHOUT reverting the migration may
   crash the old code (missing column, etc.).
2. Identify the rollback safety:
   - **Additive migration** (new column with default) → old code likely
     fine to roll back.
   - **Destructive migration** (column drop, type change) → old code
     will crash. Must roll forward with a fix instead.
3. If unsure, follow `docs/RUNBOOK.md` "Incident: Data corruption
   suspected" — pg_dump first, then decide.

Phase 4+ may introduce down-migrations as a deliberate pattern; until
then, rollback safety is a per-incident judgment call.

---

## Section 5 — Domain + TLS

See `docker/coolify/traefik-labels.md`. Phase 0 uses a single host
(`{{PRODUCTION_HOST}}`); Phase 4 will add wildcard `*.fbeventos.com.br`
for per-tenant subdomains.

---

## Section 6 — First-Deploy Verification Checklist

Run this checklist after the first production deploy (and re-run after
any infra-level change):

- [ ] **Semver tag in Coolify config** — `fb-eventos-web` image tag is
      `0.1.0` (or current), NOT `latest`. T-0-07 mitigation.
- [ ] **`/api/health` returns 200** — `curl -fsSL
      https://{{PRODUCTION_HOST}}/api/health` exits 0 with
      `{"status":"ok","checks":{"db":true}}`.
- [ ] **Postgres roles + NOBYPASSRLS** — run the verification SQL in
      `docker/coolify/postgres.service.md` Section "Verification SQL"
      query #1; expect both `rolbypassrls=f`.
- [ ] **Postgres extensions installed** — `\dx` lists `pgcrypto` AND
      `pg_trgm`. FOUND-16.
- [ ] **FORCE RLS still active** — query #2; expect 9 tables with both
      `relrowsecurity=t` AND `relforcerowsecurity=t`.
- [ ] **Audit-log append-only at GRANT layer** — query #4; expect
      `app_update=f, app_delete=f, app_insert=t, app_select=t`. LGPD-04.
- [ ] **Pino structured logs** — Coolify web service logs are JSON,
      include `service: 'fb-eventos-web'`, `level`, `time`, `msg` fields.
- [ ] **Worker boots** — Coolify worker service logs include
      "worker ready — awaiting jobs".
- [ ] **Sentry test event arrives** — trigger a test exception (e.g. a
      one-off `/test-sentry` route), verify it appears in Sentry
      dashboard within 2 minutes. Releases tab shows `{{APP_VERSION}}`.
- [ ] **Walking-skeleton E2E passes against production** — run
      `PLAYWRIGHT_BASE_URL=https://{{PRODUCTION_HOST}} pnpm test:e2e`
      against the live host (one-time, do NOT commit the override).
- [ ] **`:latest` reality check** — search Coolify UI for `:latest`;
      should return zero matches.
- [ ] **Backup configured (FOUND-12)** — Postgres service backup tier
      enabled with retention ≥7 days. If Coolify only offers snapshots,
      provision the `pg_dump → MinIO` supplement from
      `docs/deploy/BACKUP.md`.

If any check fails, follow `docs/RUNBOOK.md` for the corresponding
incident scenario.

---

## See Also

- `docs/RUNBOOK.md` — incident response.
- `docs/deploy/BACKUP.md` — backup + restore procedures.
- `docker/coolify/*.md` — per-service manifests.
- `.github/workflows/build-and-push.yml` — image build pipeline.
