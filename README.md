# FB_EVENTOS

Plataforma SaaS multi-tenant para gestão de grandes eventos.
See [`.planning/PROJECT.md`](.planning/PROJECT.md) for product vision and
[`.planning/ROADMAP.md`](.planning/ROADMAP.md) for the phase plan.

## Quickstart

Prerequisites:

- **Node.js 22.x** (`.nvmrc` pins it — `nvm use` if you have nvm)
- **pnpm 9.x** (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- **gitleaks** binary on `$PATH` for the pre-commit hook
  (`bash scripts/install-gitleaks.sh` after Plan 02 ships it; until then the
  hook degrades to a warning if the binary is missing)

```bash
pnpm install                 # installs deps + activates the husky pre-commit hook
cp .env.example .env.local   # then fill in real values (.env.local is gitignored)
pnpm dev                     # http://localhost:3000
```

## Scripts

| Command | What it does |
| ------- | ------------ |
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build (emits `.next/standalone` for Docker) |
| `pnpm start` | Run the production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `biome check src/` (also runs in pre-commit) |
| `pnpm lint:fix` | `biome check --write src/` |
| `pnpm format` | `biome format --write src/` |
| `pnpm docker:build:local` | Build a versioned Docker image locally |

## Docker

```bash
pnpm docker:build:local
```

The build is multi-stage (`docker/Dockerfile`) and produces a Next.js
`standalone` image. Images are always tagged with the `package.json` version —
`:latest` is structurally forbidden (mitigates the Watchtower auto-pull
anti-pattern; see CLAUDE.md "What NOT to Use").

## Release

Production images are only built from `v*.*.*` git tags — never from a
branch push, never with a floating tag.

```bash
pnpm version patch              # bumps package.json + creates v<x.y.z> tag
git push --follow-tags          # pushes the commit AND the tag
```

The tag push triggers `.github/workflows/build-and-push.yml`, which builds
TWO multi-stage images and pushes them to GHCR — the web image
(`ghcr.io/<repo>-web:<x.y.z>`) and the worker image
(`ghcr.io/<repo>-worker:<x.y.z>`). Coolify pulls the semver tags
explicitly so every deploy is a deliberate, reviewable artifact.

## Deploy

End-to-end Coolify deploy runbook: [`docs/deploy/COOLIFY.md`](docs/deploy/COOLIFY.md).

Per-service manifests:

- [`docker/coolify/web.service.md`](docker/coolify/web.service.md) — Next.js web container.
- [`docker/coolify/worker.service.md`](docker/coolify/worker.service.md) — Graphile-Worker process.
- [`docker/coolify/postgres.service.md`](docker/coolify/postgres.service.md) — Managed Postgres + RLS roles.
- [`docker/coolify/traefik-labels.md`](docker/coolify/traefik-labels.md) — TLS + Host routing.

Backup + restore procedures: [`docs/deploy/BACKUP.md`](docs/deploy/BACKUP.md).

## Runbook

Incident response: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

Covers: service down, DB unreachable, data corruption suspected,
cross-tenant leak, read-only mode kill switch, FB_APU04 lessons +
operator substitution table.

## Project structure

```
src/
  app/                  Next.js App Router pages, layouts, route handlers
  lib/                  Cross-cutting utilities (env.ts is the env stub today)
docker/                 Dockerfile + container env manifest
.planning/              GSD workflow artifacts (PROJECT, ROADMAP, phases/)
```

## Stack & contracts

- Next.js 15.5.x (pinned — NOT 16) + React 19 + TypeScript 5.6 strict
- Tailwind 4 (Oxide engine)
- pnpm 9 + Node 22 enforced by `engines`
- Biome 2 + Husky + gitleaks (binary) for pre-commit
- PostgreSQL is the **only** persistence layer. SQLite / embedded `.db` files
  are banned by contract — see `CLAUDE.md` "Embedded-DB Anti-Pattern" and
  `.gitignore` entries.

Full stack reference: [`CLAUDE.md`](CLAUDE.md).
Operational runbook: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## License

Proprietary.
