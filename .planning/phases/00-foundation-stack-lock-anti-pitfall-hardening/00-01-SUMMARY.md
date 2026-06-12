---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 01
subsystem: infra
tags: [bootstrap, nextjs, typescript, pnpm, biome, husky, gitleaks, docker, tooling]

# Dependency graph
requires: []
provides:
  - "Next.js 15.5.19 + React 19.2.7 + TypeScript 5.6 strict scaffold that boots via `pnpm dev`"
  - "engines pin: Node >=22 <23, pnpm >=9 <10 (enforces stack lock from day 1)"
  - "Biome 2.4.16 lint+format with single-quote + no-semicolon + 2-space style"
  - "Husky 9 pre-commit gate running gitleaks → biome → tsc → :latest guard"
  - "gitleaks installer script (binary, NOT the fake npm package)"
  - ".env.example + .env.production.example with verified key parity (placeholders only)"
  - ".gitignore embedded-DB ban (*.db, *.sqlite, *.sqlite3, tracker-*.db) — local arm of FOUND-02/03"
  - "Multi-stage docker/Dockerfile (Next.js standalone) with ARG APP_VERSION + no floating tag"
  - "src/lib/env.ts stub (Plan 03 swaps body for Zod validation, call sites unchanged)"
affects:
  - 00-02-ci-anti-pitfall-gates    # CI mirror of pre-commit guards
  - 00-03-postgres-drizzle-rls     # Will replace src/lib/env.ts body with Zod parse
  - 00-04-better-auth              # Will consume BETTER_AUTH_SECRET / BETTER_AUTH_URL
  - 00-06-observability            # Will consume SENTRY_DSN / LOG_LEVEL
  - 00-07-coolify-deploy           # Will publish docker/Dockerfile image via APP_VERSION

# Tech tracking
tech-stack:
  added:
    - "next@~15.5.19"
    - "react@~19.2.7"
    - "react-dom@~19.2.7"
    - "typescript@~5.6.0"
    - "@biomejs/biome@~2.4.16"
    - "husky@^9.1.7"
    - "tailwindcss@^4 + @tailwindcss/postcss@^4 (from scaffold)"
  patterns:
    - "engines pin in package.json + .nvmrc (Node lock, dual signal)"
    - "Pre-commit defense-in-depth (gitleaks binary + biome --diagnostic-level=error + tsc + grep guard)"
    - "Two committed env manifests with enforced key parity (RESEARCH Pattern 13)"
    - "Multi-stage Dockerfile producing Next.js standalone with semver-required ARG"
    - "src/lib/env.ts as single-import-site for env vars (Plan 03 swaps body, no call-site churn)"

key-files:
  created:
    - "package.json"
    - "pnpm-lock.yaml"
    - "tsconfig.json (strict + noUncheckedIndexedAccess + noImplicitOverride)"
    - "biome.json"
    - ".nvmrc"
    - ".gitignore (embedded-DB ban)"
    - ".gitattributes (LF on hook scripts)"
    - ".dockerignore"
    - ".env.example"
    - ".env.production.example"
    - ".husky/pre-commit"
    - ".gitleaks.toml"
    - "next.config.ts (output: 'standalone')"
    - "src/app/layout.tsx"
    - "src/app/page.tsx"
    - "src/app/globals.css"
    - "src/lib/env.ts"
    - "docker/Dockerfile"
    - "docker/.env.docker.example"
    - "scripts/install-gitleaks.sh"
    - "README.md"
  modified: []

key-decisions:
  - "Pin Next.js to ~15.5.19, NOT @latest (which resolves to 16 and renames middleware.ts → proxy.ts — RESEARCH Pitfall 1)"
  - "Use Next.js standard webpack build (NOT --turbopack) for dev+build until ecosystem stabilizes for 15.5.x; revisit in Phase 1"
  - "Install gitleaks via the canonical GitHub install.sh script — never via `pnpm add gitleaks` (the npm package of that name is a different project — RESEARCH Package Legitimacy Audit)"
  - "Pre-commit hook augments PATH with ~/.local/bin, ~/.npm-global/bin and sources nvm so pnpm is reachable from any git client (terminal, GUI, IDE), not only login shells"
  - "Biome ignores .css files because Tailwind 4's @theme inline at-rule is unknown to Biome's CSS parser; Tailwind has its own validation path"
  - "Set APP_VERSION default to '0.0.0-unset' so an unintentional build still produces a tagged-but-obviously-wrong image rather than a silently floating one"

patterns-established:
  - "Pattern: env manifest parity — `diff <(grep -oE '^[A-Z_]+=' .env.example | sort -u) <(grep -oE '^[A-Z_]+=' .env.production.example | sort -u)` MUST be empty"
  - "Pattern: pre-commit defense-in-depth — local hook + Plan 02 CI mirror the same rules; either alone catches misses by the other"
  - "Pattern: floating-tag ban — Dockerfile MUST NOT contain `:latest`; pre-commit grep guard + acceptance test enforce on every commit"
  - "Pattern: engines pin is a contract — Node 22 and pnpm 9 are NOT optional; `pnpm install` will refuse to run on the wrong major"

requirements-completed:
  - FOUND-01
  - FOUND-02
  - FOUND-03
  - FOUND-04
  - FOUND-05
  - FOUND-06
  - FOUND-09
  - FOUND-15

# Metrics
duration: ~75min
completed: 2026-06-12
---

# Phase 00 Plan 01: Repo Bootstrap & Tooling Floor Summary

**Next.js 15.5.19 + TypeScript 5.6 strict scaffold with engines-locked Node 22 / pnpm 9, Biome 2 + Husky pre-commit (gitleaks binary, NOT npm) + two parity-checked env manifests + multi-stage Dockerfile with semver-required APP_VERSION — all eight FOUND requirements (-01, -02, -03, -04, -05, -06, -09, -15) defused at the tooling floor before any domain code exists.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-06-12T00:53:00Z (approx, when scaffold began)
- **Completed:** 2026-06-12T01:08:31Z
- **Tasks:** 3 / 3 (all `type="auto"`, no checkpoints)
- **Files created:** 21
- **Files modified:** 0 (greenfield)

## Accomplishments

- **Stack lock at the floor.** `package.json` pins `next@~15.5.19`, `react@~19.2.7`, `typescript@~5.6.0`, and `engines.node: ">=22.0.0 <23.0.0"` + `engines.pnpm: ">=9.0.0 <10.0.0"`. `pnpm install` refuses to run on the wrong Node/pnpm major. `.nvmrc` carries the same lock for nvm users.
- **Anti-pitfall #1 (embedded DB) defused locally.** `.gitignore` lists `*.db`, `*.sqlite`, `*.sqlite3`, `tracker-*.db`. The Plan 02 CI grep gate is the remote arm of the ban.
- **Anti-pitfall #6 (committed secrets) defused locally.** Husky pre-commit runs `gitleaks protect --staged` with a project ruleset (`.gitleaks.toml`) that extends defaults and narrowly allowlists only `.env.example`, `.env.production.example`, and `docker/.env.docker.example`. The npm package named "gitleaks" is NOT the real scanner and a guard in the hook + acceptance test prevent it from ever entering `package.json`. The official binary is installed via `scripts/install-gitleaks.sh` (canonical `gitleaks/gitleaks/install.sh`).
- **Anti-pitfall #19 (Watchtower `:latest` auto-pull) defused structurally.** `docker/Dockerfile` accepts an `ARG APP_VERSION` and stamps it onto `org.opencontainers.image.version`; the `pnpm docker:build:local` script always tags `fb-eventos-web:<package.json version>`. The pre-commit hook greps any staged file under `docker/` for `:latest` and blocks the commit on match.
- **Two env manifests with key parity.** `.env.example` (dev) and `.env.production.example` (prod) share an identical key set (verified by `diff <(grep -oE '^[A-Z_]+=' …)` — returns empty). Both contain only placeholders (`CHANGE_ME`, `GENERATE_WITH_openssl_rand_-hex_32`).
- **Build smoke is green.** `pnpm install --frozen-lockfile=false` → `pnpm typecheck` → `pnpm lint` → `pnpm build` all succeed; `.next/standalone/server.js` is emitted.

## Task Commits

Each task was committed atomically (sequential mode, single working tree):

1. **Task 1: Scaffold Next.js 15 + lock engines + commit basic env/dockerignore** — `485227f` (feat)
2. **Task 2: Install Biome 2 + Husky + gitleaks binary pre-commit hook** — `ead0a24` (chore)
3. **Task 3: Multi-stage Dockerfile + semver discipline + smoke build** — `83ecfbe` (chore)

**Plan metadata commit:** added immediately after this SUMMARY.md lands.

## Files Created / Modified

- `package.json` — pinned versions, engines, packageManager, scripts (dev/build/start/typecheck/lint/format/prepare/docker:build:local)
- `pnpm-lock.yaml` — pnpm 9.15.0 lockfile
- `tsconfig.json` — strict, noUncheckedIndexedAccess, noImplicitOverride, Bundler resolution, ES2022 target
- `biome.json` — Biome 2.4.16 config (single quotes, no semicolons, 2-space, 100-col; ignores `.css` for Tailwind 4 compat)
- `.nvmrc` — `22`
- `.gitignore` — Next defaults + embedded-DB ban (`*.db`, `*.sqlite`, `*.sqlite3`, `tracker-*.db`) + env files
- `.gitattributes` — LF for shell scripts and `.husky/*` so hooks work on Windows checkouts
- `.dockerignore` — excludes `node_modules`, `.next`, `.git`, env files, `.husky`, `.planning`
- `.env.example` — dev env manifest (17 keys, all placeholders)
- `.env.production.example` — prod env manifest (17 keys, identical set)
- `.husky/pre-commit` — PATH-augmented, runs gitleaks (warn-skip if missing) → `biome check --diagnostic-level=error src/` → `tsc --noEmit` → `:latest` grep guard for `docker/**`
- `.gitleaks.toml` — extends default ruleset, allowlists `.env.example`, `.env.production.example`, `docker/.env.docker.example` paths plus `CHANGE_ME` / `GENERATE_WITH_openssl_rand` regexes
- `next.config.ts` — `output: 'standalone'`
- `src/app/layout.tsx` — minimal pt-BR layout with FB_EVENTOS metadata
- `src/app/page.tsx` — Phase 0 scaffold landing page (replaces Vercel demo)
- `src/app/globals.css` — Tailwind 4 import + default tokens (scaffold)
- `src/lib/env.ts` — env lookup stub (Plan 03 swaps body for Zod, call sites unchanged)
- `docker/Dockerfile` — 3 stages on `node:22-alpine`; deps via corepack-pnpm `--frozen-lockfile`; builder runs `pnpm build`; runner copies `.next/standalone`+`.next/static`+`public`, drops to UID 1001 `nextjs`, exposes 3000, `HEALTHCHECK /api/health` (delivered in Plan 07), `ARG APP_VERSION` + `LABEL org.opencontainers.image.version`
- `docker/.env.docker.example` — server-side env subset consumed by `node server.js`
- `scripts/install-gitleaks.sh` — installs the OFFICIAL `gitleaks/gitleaks` binary into `~/.local/bin`; documents the PATH requirement
- `README.md` — quickstart (Node 22 + pnpm 9 + gitleaks install), script reference, Docker note, stack contracts, link to RUNBOOK (Plan 07)

## Decisions Made

1. **Pin `next@~15.5.19`, refuse `@latest`.** RESEARCH Pitfall 1 documents that Next.js 16 renamed `middleware.ts` → `proxy.ts` and the exported function from `middleware()` → `proxy()`; existing `middleware.ts` files are silently ignored. Pinning at `~15.5.19` is non-negotiable for the tenant-routing middleware that lands in Plan 04.
2. **Drop `--turbopack` from `dev`/`build` for now.** Scaffold defaults emit `next dev --turbopack` and `next build --turbopack`; turbopack production builds are still maturing in 15.5.x and add an unnecessary failure mode to the smoke test. Standard webpack builds are the stable, reproducible path. Revisit in Phase 1 once observability is in place.
3. **Install gitleaks via binary, never via npm.** RESEARCH "Package Legitimacy Audit" confirms the npm `gitleaks` package is a different project ("custom rules" wrapper). The hook reads from `$PATH`; the installer script targets `~/.local/bin`; the hook + acceptance test guard against the fake npm package landing in `devDependencies`.
4. **Make the pre-commit hook PATH-robust.** Git invokes hooks with a minimal `PATH` that doesn't include `~/.npm-global/bin` (where the installed pnpm lives on Linux). The hook prepends the common bin dirs and sources nvm if present, so it works from terminal, GUI git clients, and IDEs alike.
5. **Biome ignores `.css` files.** Tailwind 4's `@theme inline` at-rule is unknown to Biome's CSS parser, which would otherwise block every commit. Tailwind 4 has its own validation path; Biome stays focused on TS/TSX/JS/JSON where it adds value.
6. **`APP_VERSION` defaults to `0.0.0-unset`.** A literal placeholder default means an unintentional `docker build` still produces an image with an obviously-wrong tag rather than a silently floating one. The `pnpm docker:build:local` script always overrides.
7. **`src/lib/env.ts` as a single import site.** Today it's a thin wrapper around `process.env`. In Plan 03 it gets swapped to a Zod-validated parser without touching any caller — the centralized import boundary is the trade.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-commit hook could not find `pnpm` on git's minimal PATH**

- **Found during:** Task 2 first commit attempt
- **Issue:** Git invokes hooks with `PATH=node_modules/.bin:/usr/lib/git-core:…` and does not inherit the interactive shell's `$PATH`. On this machine pnpm is installed at `~/.npm-global/bin`, so the hook failed with `pnpm: not found` and aborted the Task 2 commit.
- **Fix:** Prepended `~/.local/bin:~/.npm-global/bin:/usr/local/bin:/usr/bin:/bin` to `PATH` at the top of `.husky/pre-commit` and conditionally sourced `nvm.sh` if `~/.nvm` exists. This makes the hook work from terminal, GUI git, and IDE integrations regardless of how the shell was launched.
- **Files modified:** `.husky/pre-commit`
- **Verification:** Re-ran the Task 2 commit; hook executed all four steps cleanly (gitleaks warn, biome 0 errors, tsc 0 errors, no docker/ in staging). Tasks 2 and 3 both committed without further hook failures.
- **Committed in:** `ead0a24` (Task 2 commit, in the same hook file)

**2. [Rule 3 - Blocking] Comments containing the literal string `:latest` failed the acceptance grep**

- **Found during:** Task 3 verification
- **Issue:** The plan's acceptance test runs `! grep -E ':latest\b' docker/Dockerfile` and requires exit 0. My initial Dockerfile had comments like `\`:latest\` is structurally forbidden` and `NEVER tag :latest`, which legitimately documented the rule but tripped the grep.
- **Fix:** Rewrote the comments to say "floating tags are structurally forbidden" and "NEVER use a floating tag" while keeping the intent crystal clear. The `:latest` substring now appears nowhere in `docker/Dockerfile`.
- **Files modified:** `docker/Dockerfile`
- **Verification:** `! grep -E ':latest\b' docker/Dockerfile && echo NO-LATEST-OK` now prints `NO-LATEST-OK`.
- **Committed in:** `83ecfbe` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — Blocking)
**Impact on plan:** Both fixes were necessary to complete the planned tasks. Neither expanded scope; both made the planned guardrails actually work in this environment.

## Issues Encountered

- **`pnpm create next-app .` rejected the directory name `FB_EVENTOS`** (npm naming restriction — capital letters not allowed). Worked around by scaffolding into a sibling directory named `fb-eventos`, then copying the output into the project root. The resulting `package.json` already had `"name": "fb-eventos"` so no further rename was needed. This is a one-time scaffold quirk; no follow-up.

## User Setup Required

- **Install the gitleaks binary** before the pre-commit hook can scan for secrets:
  ```bash
  bash scripts/install-gitleaks.sh
  # then ensure ~/.local/bin is on $PATH (the script reminds you if not)
  ```
- Until then the hook prints a yellow warning and skips the scan. CI in Plan 02 will catch what local skipping misses.
- Copy `.env.example` to `.env.local` and fill in real values for any service you plan to exercise during Phase 0 (Postgres lands in Plan 03; auth in Plan 04; observability in Plan 06).

## Open Items for Plan 02 (CI Anti-Pitfall Gates)

Plan 02 must mirror these guards server-side in `.github/workflows/ci.yml`:

| Guard | Pre-commit (this plan) | CI mirror (Plan 02) |
|---|---|---|
| Embedded-DB package ban (`sqlite3` / `better-sqlite3` / `@libsql/*`) | None — relies on `.gitignore` for files only | **Required:** `grep -E '"(sqlite3\|better-sqlite3\|@libsql)"' package.json` must return empty |
| Embedded-DB file ban (`*.db`, `*.sqlite`, `tracker-*.db`) | `.gitignore` (passive) | **Required:** repo-wide `find` gate |
| `fb_apu0[1-9]` legacy module names | Not enforced locally | **Required:** `grep -rn 'fb_apu0[1-9]' src/` |
| Next.js 16 upgrade | Not enforced locally | **Required:** assert `dependencies.next` matches `^15` |
| Secret scan | `gitleaks protect --staged` (warn-skip if binary missing) | **Required:** `gitleaks/gitleaks-action@v2` on `pull_request` |
| Biome lint | `biome check --diagnostic-level=error src/` | **Required:** same command in CI |
| Type check | `tsc --noEmit` | **Required:** same command in CI |
| Docker `:latest` ban | Pre-commit grep on `docker/**` | **Required:** repo-wide grep gate |

The pre-commit hook is best-effort (developers can `--no-verify`); the CI gates in Plan 02 are the load-bearing enforcement.

## Next Plan Readiness

- Plan 02 (CI Anti-Pitfall Gates) — **READY.** All guards to mirror are documented above. `.gitleaks.toml`, `biome.json`, `tsconfig.json`, and `package.json` scripts are all in place; CI can call them directly.
- Plan 03 (Postgres + Drizzle + RLS) — **READY.** Env manifest already lists `DATABASE_URL` + `DATABASE_MIGRATOR_URL`; `src/lib/env.ts` is the swap point for Zod validation; no scaffolding work blocked.
- No blockers, no carryover.

## Self-Check: PASSED

- All 21 expected files exist on disk (verified with `[ -e ]` for each).
- All 3 task commits are reachable in `git log --all` (`485227f`, `ead0a24`, `83ecfbe`).
- `pnpm install` / `pnpm typecheck` / `pnpm lint` / `pnpm build` all exit 0.
- `.env.example` ↔ `.env.production.example` key sets are identical.
- `docker/Dockerfile` contains no `:latest` substring and has 3 `node:22-alpine` stages.

---
*Phase: 00-foundation-stack-lock-anti-pitfall-hardening*
*Completed: 2026-06-12*
