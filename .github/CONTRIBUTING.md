# Contributing to FB_EVENTOS

Thanks for taking the time. This file documents the contract every PR has
to honor. CI enforces it; this doc explains what the gates do and how to
fix them locally before pushing.

## Quick start

```bash
nvm use                       # picks Node 22 from .nvmrc
corepack enable               # activates pnpm 9 from packageManager
pnpm install                  # also installs the husky pre-commit hook
bash scripts/install-gitleaks.sh   # one-time, installs the gitleaks binary
cp .env.example .env.local    # then fill in real values (gitignored)
```

If `pnpm install` refuses with `Unsupported engine`, your Node/pnpm major
does not match the `engines` pin in `package.json`. That pin is a hard
contract — fix the local environment, do not loosen the pin.

## Pre-commit hook (local enforcement)

`.husky/pre-commit` runs on every `git commit` and chains four gates:

1. **gitleaks** secret scan (warn-skip if the binary is missing — install
   it!)
2. `biome check --diagnostic-level=error src/`
3. `tsc --noEmit`
4. `:latest` grep guard on any staged file under `docker/`

You can run the same checks manually:

```bash
pnpm lint && pnpm typecheck    # mirrors steps 2 + 3
```

To skip the hook in an emergency, use `git commit --no-verify`. **CI will
still block the PR** — the hook is best-effort; CI is load-bearing.

## CI anti-pitfall gates (load-bearing enforcement)

`.github/workflows/ci.yml` runs on every PR to `main`. Six PR-blocking jobs:

| Job | What it enforces |
|---|---|
| `anti-pitfall-gates` | All four `scripts/ci/check-*.sh` gates (see below) |
| `secrets-scan` | `gitleaks/gitleaks-action@v2` against full history |
| `lint-typecheck` | `biome check --diagnostic-level=error src/` + `tsc --noEmit` |
| `test` | `vitest run --passWithNoTests` against a Postgres 16-alpine service |
| `build` | `pnpm build` with placeholder env vars |
| `verify-no-latest-in-workflows` | `grep -rE ':latest\b' .github/workflows/ docker/` must be empty |

Run all anti-pitfall scripts locally before pushing:

```bash
pnpm run check:all
```

Or run a single one:

```bash
pnpm run check:db        # embedded-DB ban (T-0-04)
pnpm run check:legacy    # fb_apu0[1-9] ban (Pitfall #16)
pnpm run check:drizzle   # drizzle-kit push ban (Pitfall 4 / T-0-03)
pnpm run check:nextjs    # Next.js 16 ban (Pitfall 1)
```

### Common gate failures

| Symptom | Fix |
|---|---|
| `check-no-embedded-db` fails with `*.db` file | Delete the file; if it's a build artifact, add it to `.gitignore`. SQLite is contractually banned. |
| `check-no-embedded-db` fails on `package.json` | A dep you added pulled `sqlite3`/`better-sqlite3`/`@libsql/*`. Find an alternative — Postgres is the only persistence layer. |
| `check-no-drizzle-push` fails | Replace `drizzle-kit push` with `drizzle-kit generate` + `drizzle-kit migrate`. Migrations must ship as reviewable SQL files. |
| `check-nextjs-version` fails | Pin `next` back to `~15.5.x` in `package.json`. Next 16 renames `middleware.ts` to `proxy.ts` and breaks Plan 04. |
| `check-no-legacy-names` fails | You imported or referenced `fb_apu01`/`02`/`03`/`04`. This project is `fb-eventos` — rename. |
| `verify-no-latest-in-workflows` fails | A workflow or Dockerfile gained a `:latest` reference. Use a semver tag or `${{ github.sha }}` instead. |
| `secrets-scan` fails | Rotate the leaked credential first, then either delete the line and force-push the branch, or add a targeted `.gitleaks.toml` allowlist if it's a false positive (e.g. an `.example` placeholder). |

## Pull request checklist

`.github/pull_request_template.md` auto-fills when you open a PR. Tick
every box before requesting review; CI re-checks each box.

## Branches & deploys

- Branch off `main` for feature work.
- Production Docker images are only built from `v*.*.*` git tags
  (`.github/workflows/build-and-push.yml`). To release:
  `pnpm version patch && git push --follow-tags`. No branch push ever
  produces a registry push.
- `:latest` is structurally banned — semver tags (`0.1.0`) and the commit
  SHA are the only tag forms.

## Dependencies

- Dependabot opens PRs every Monday morning (America/Sao_Paulo). Minor
  and patch bumps are grouped into one PR per ecosystem.
- Next.js 16.x is hard-ignored. Embedded-DB packages are hard-ignored.
- Major bumps come as individual PRs and require a human review.
