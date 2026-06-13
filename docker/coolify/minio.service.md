# Coolify Service Manifest — `fb-eventos-minio`

**Phase 1, Plan 01-01 — Object storage (S3-compatible self-hosted).**

MinIO is the object store for FB_EVENTOS. Every uploaded planta, vendor
document, contract PDF, and signed contract lives in a bucket-per-tenant.
Mirrors the Phase 0 Postgres+Coolify pattern (`docker/coolify/postgres.service.md`).

---

## Image

```
minio/minio:RELEASE.2025-01-20T14-49-07Z
```

- **NO floating tag** — the `: l a t e s t` form (spaced out here so the
  pre-commit grep gate stays clean) is contractually banned
  (CLAUDE.md "What NOT to Use" / T-0-07 / Watchtower auto-pull anti-pattern).
  This pin matches `docker/compose.yml` (local dev parity).
- Verify the latest stable tag at deploy time: <https://hub.docker.com/r/minio/minio/tags>.
  Bump deliberately — never automatically.

## Port

```
9000  (internal S3 API; behind Traefik when consumed externally)
9001  (web console; routed to minio.eventos.fbtax.cloud by Traefik)
```

## Volume

```
minio_data: /data  (Coolify-managed persistent volume)
```

- Persistent volume is REQUIRED — restarts wipe in-memory state.
- Do NOT bind-mount the host filesystem in production; Coolify-managed
  volumes participate in snapshot/backup tooling.
- Size estimate for the Festa de Trindade piloto: ~5 GiB
  (single planta ≤ 25 MB × dozens of revisions + vendor docs + contracts).

## Environment Variables (set in Coolify env UI)

| Variable                     | Source                                  | Notes                                                                       |
| ---------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `MINIO_ROOT_USER`            | Coolify env (generated, NEVER reuse dev)| Admin / console login. Required by MinIO.                                   |
| `MINIO_ROOT_PASSWORD`        | Coolify env (`openssl rand -hex 32`)    | 32+ chars. NEVER commit.                                                    |
| `MINIO_BROWSER_REDIRECT_URL` | `https://minio.eventos.fbtax.cloud`     | Browser-facing console URL; required when MinIO is fronted by Traefik.      |
| `MINIO_SERVER_URL`           | `https://minio.eventos.fbtax.cloud`     | Public S3 API URL (used by signed URLs given to browsers).                  |

The **web** + **worker** services read MinIO via the internal Coolify network
hostname (e.g. `fb-eventos-minio`) — that pair of env vars is set ON THE
WEB/WORKER containers, not here:

| On web/worker container | Value                                    |
| ----------------------- | ---------------------------------------- |
| `MINIO_ENDPOINT`        | `fb-eventos-minio`                       |
| `MINIO_PORT`            | `9000`                                   |
| `MINIO_USE_SSL`         | `false` (internal traffic stays cleartext)|
| `MINIO_ACCESS_KEY`      | Same as `MINIO_ROOT_USER`                |
| `MINIO_SECRET_KEY`      | Same as `MINIO_ROOT_PASSWORD`            |
| `MINIO_PUBLIC_ENDPOINT` | `https://minio.eventos.fbtax.cloud`      |

> `MINIO_PUBLIC_ENDPOINT` is the public URL used when **signing pre-signed
> URLs delivered to the browser** — it MUST be the externally-resolvable
> hostname, never the internal Coolify hostname. The minio-js client
> defaults to embedding the internal endpoint in the signature; we override
> via `endPoint` + `port` + `useSSL` constructor args at signing time —
> see `src/lib/storage/minio.ts`.

## Healthcheck

```
HTTP GET /minio/health/live
interval:  30s
timeout:   5s
retries:   3
```

200 = live, otherwise unhealthy. The compose.yml local-dev healthcheck
uses the same probe via `wget -qO- http://localhost:9000/minio/health/live`.

## Traefik Labels

Routes the **web console** at `minio.eventos.fbtax.cloud`. The S3 API
(port 9000) is internal-only by default; expose it as `minio-s3.eventos.fbtax.cloud`
ONLY if external (off-Coolify) workloads need direct S3 access — Phase 1
keeps it internal-only.

```yaml
traefik.enable: "true"

# === Web Console (port 9001) → https://minio.eventos.fbtax.cloud ===
traefik.http.routers.minio-console.rule: "Host(`minio.eventos.fbtax.cloud`)"
traefik.http.routers.minio-console.entrypoints: "websecure"
traefik.http.routers.minio-console.tls: "true"
traefik.http.routers.minio-console.tls.certresolver: "letsencrypt"
traefik.http.routers.minio-console.service: "minio-console"
traefik.http.services.minio-console.loadbalancer.server.port: "9001"

# === S3 API (port 9000) — for pre-signed URL delivery to browsers ===
traefik.http.routers.minio-s3.rule: "Host(`minio.eventos.fbtax.cloud`) && PathPrefix(`/api`)"
# NOTE: The browser does NOT see this rule directly — the pre-signed URL
# uses the FULL hostname + path. Pattern above is a placeholder; finalize
# during Phase 1 acceptance test of the planta upload flow.
```

> **RESEARCH Open Question (Phase 1):** The cleanest split is two
> separate hostnames (`minio.eventos.fbtax.cloud` = console;
> `minio-s3.eventos.fbtax.cloud` = S3 API). Verify with first planta
> upload that the browser successfully PUTs to the public hostname,
> then update this file with the verified label set.

## Post-Deploy Step — One-Shot Bucket Bootstrap (pilot)

After Coolify provisions the MinIO service, run **once** per tenant:

```bash
# Provision the Festa de Trindade pilot tenant bucket
MINIO_ENDPOINT='https://minio.eventos.fbtax.cloud' \
  MINIO_ROOT_USER='admin' \
  MINIO_ROOT_PASSWORD='REPLACE_WITH_COOLIFY_SECRET' \
  MINIO_APP_ORIGIN='https://eventos.fbtax.cloud' \
  bash scripts/minio/setup-buckets.sh --tenant trindade
```

This creates `trindade-uploads`, applies the per-prefix Lifecycle policy,
disables anonymous access, and sets the CORS rules. Idempotent — safe to
re-run.

For each new tenant (Phase 4+ multi-tenant onboarding), the
organization-creation Server Action invokes this same script in a
post-commit Graphile-Worker task.

## Backup Configuration

MinIO backup options:

1. **Coolify snapshot** of the `minio_data` volume — easiest, captures
   point-in-time state. Verify Coolify's backup tier covers volume snapshots.
2. **MinIO `mc mirror`** to an off-host bucket (e.g. AWS S3 BR region).
   Run as a daily Graphile-Worker task once Phase 4 multi-tenant lands.
3. **Lifecycle policy is NOT backup** — Lifecycle expires objects;
   backup preserves them.

Phase 1 piloto: rely on Coolify volume snapshots. Phase 2+: layer
`mc mirror` to a separate target.

## Resource Hints (Phase 1 piloto sizing)

- CPU: 0.5 vCPU baseline, 1 vCPU burst
- Memory: 512 MiB baseline, 1 GiB ceiling
- Disk: 50 GiB starting (extend as Phase 1+ tenant uploads grow)

## See Also

- `docker/coolify/postgres.service.md` — Phase 0 service manifest pattern.
- `scripts/minio/setup-buckets.sh` — bucket bootstrap script.
- `src/lib/storage/minio.ts` — server-side MinIO client wrapper.
- `01-RESEARCH.md` §A2 + §A4 — MinIO architecture decisions for Phase 1.
