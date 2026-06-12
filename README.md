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
the multi-stage image and pushes two tags to GHCR:
`ghcr.io/<repo>:<x.y.z>` and `ghcr.io/<repo>:<commit-sha>`. Coolify pulls
the semver tag, so a deploy is a deliberate, reviewable artifact.

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
Operational runbook: `docs/RUNBOOK.md` — created in Plan 07.

## License

Proprietary.
