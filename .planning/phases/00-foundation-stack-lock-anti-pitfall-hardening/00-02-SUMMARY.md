---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 02
subsystem: ci
tags: [ci, github-actions, gitleaks, anti-pitfall, embedded-db-ban, dependabot, docker-tagging]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "scripts/install-gitleaks.sh + .gitleaks.toml ruleset (Plan 01) — CI consumes the same config"
      - "package.json with engines + scripts surface (Plan 01) — CI runs pnpm lint/typecheck/build"
      - "Husky pre-commit chain (Plan 01) — CI mirrors the same four guards plus :latest enforcement"
      - "docker/Dockerfile with APP_VERSION ARG (Plan 01) — build-and-push consumes it"
provides:
  - "Six PR-blocking CI jobs (.github/workflows/ci.yml): anti-pitfall-gates / secrets-scan / lint-typecheck / test / build / verify-no-latest-in-workflows"
  - "Tag-only build-and-push workflow (.github/workflows/build-and-push.yml) producing semver + SHA tags to GHCR — NEVER :latest, NEVER from a branch push"
  - "Postgres 16-alpine sidecar in CI (test job) — ready for Plan 03 RLS tests"
  - "Dependabot policy (.github/dependabot.yml): weekly grouped minor+patch with hard ignores for next 16.x + sqlite3/better-sqlite3/@libsql/*"
  - "CODEOWNERS + PR template + CONTRIBUTING.md — the human-side of the contract"
  - "Reusable scripts/ci/check-*.sh quartet hardened against self-trip false-positives"
affects:
  - 00-03-postgres-drizzle-rls    # Test job's Postgres sidecar runs Plan 03 RLS integration tests
  - 00-04-better-auth             # Build job catches Better Auth misconfig at PR time
  - 00-06-observability           # Build job catches Sentry/Pino misconfig
  - 00-07-coolify-deploy          # Coolify will pull semver tags produced by build-and-push.yml
  - all-phase-1+                  # Every future PR runs through these six gates

# Tech tracking
tech-stack:
  added:
    - "actions/checkout@v4"
    - "actions/setup-node@v4 (node-version: 22, cache: pnpm)"
    - "pnpm/action-setup@v4 (version: 9)"
    - "gitleaks/gitleaks-action@v2 (binary scanner — NOT the npm package)"
    - "docker/setup-buildx-action@v3"
    - "docker/login-action@v3"
    - "docker/build-push-action@v6"
    - "postgres:16-alpine (CI service container)"
  patterns:
    - "PR-blocking job dependency chain: anti-pitfall-gates → (secrets-scan ∥ lint-typecheck ∥ test) → build"
    - "Defense-in-depth: each anti-pitfall guard runs in BOTH the husky pre-commit (Plan 01) AND the CI workflow (Plan 02)"
    - "Tag-only registry push: production images can only originate from a git tag matching v*.*.*"
    - "Self-trip immunity: every reusable gate uses --include filters and structural anchors so the gate's own documentation/label cannot fail the gate"
    - "Action version pinning at major: every uses: line pins @v<n> (no SHA-pinning until SBOM phase)"

key-files:
  created:
    - ".github/workflows/ci.yml"
    - ".github/workflows/build-and-push.yml"
    - ".github/dependabot.yml"
    - ".github/CODEOWNERS"
    - ".github/pull_request_template.md"
    - ".github/CONTRIBUTING.md"
  modified:
    - "scripts/ci/check-no-drizzle-push.sh (gate hardened against self-trip — Rule 1 fix)"
    - "scripts/ci/check-no-legacy-names.sh (markdown excluded — Rule 1 fix)"
    - "README.md (Release section added)"

key-decisions:
  - "Six CI jobs, not five — added verify-no-latest-in-workflows directly to ci.yml in Task 2 rather than appending it in Task 3. The workflow is one indivisible artifact and the gate is conceptually the PR-time half of Task 3's release-time enforcement."
  - "Two acceptable tags from build-and-push: ${APP_VERSION} (semver from git tag) and ${github.sha} (commit SHA). Floating tag is structurally banned by the verify-no-floating-tag step in BOTH workflows."
  - "Floating-tag regex tightened to '[A-Za-z0-9_./-]:latest\\b' — the original ':latest\\b' matched its own documentation, making the gate self-trip. Same false-positive class as the drizzle-push and legacy-name gates needed a Rule 1 fix in this plan."
  - "Dependabot hard-ignores: next@16.x (RESEARCH Pitfall 1 — middleware.ts → proxy.ts rename), sqlite3, better-sqlite3, @libsql/* (embedded-DB ban). Major bumps elsewhere still open as individual PRs for human review."
  - "Markdown excluded from check-no-legacy-names.sh because .github/CONTRIBUTING.md legitimately documents the gate by spelling out fb_apu01/02/03/04. Documentation is not runtime code; the gate stays load-bearing on TS/JS/JSON/YAML/sh/Dockerfile."
  - "CODEOWNERS placeholder @REPO_OWNER_PLACEHOLDER until first push to GitHub. CONTRIBUTING.md flags the placeholder as a documented follow-up — the gate runs on every PR regardless."
  - "pnpm/action-setup@v4 pinned at version: 9 to match the engines block from Plan 01. setup-node@v4 uses node-version: 22 with cache: pnpm so cold installs stay under one minute."

patterns-established:
  - "Pattern: gate self-trip immunity — every reusable check-*.sh script must use --include filters and structural anchors (whitespace/quote/EOL boundaries) so the gate's own labels, error messages, and documentation cannot trip it. Three Rule 1 fixes in this plan (drizzle-push, legacy-names, floating-tag) established the pattern."
  - "Pattern: gates as a quartet — embedded-DB / legacy-names / drizzle-push / Next.js-16 run as one fail-fast job (anti-pitfall-gates), and the same scripts power pnpm run check:all for local pre-push validation."
  - "Pattern: tag-only release path — production artifacts are only produced when GITHUB_REF_NAME starts with v. Branch pushes can never produce a registry push. Manual GitHub-UI edits of the release workflow are blocked by an in-workflow guard step."
  - "Pattern: action-version policy — every uses: line pins @v<major>. Dependabot's github-actions ecosystem (weekly) surfaces minor/patch drift; major bumps come as individual PRs."
  - "Pattern: explicit minimum permissions — workflow default is contents:read + pull-requests:read. Jobs opt INTO additional scopes (security-events:write on secrets-scan; packages:write on build-and-push)."

requirements-completed:
  - FOUND-04
  - FOUND-05
  - FOUND-07

# Metrics
duration: ~60min
completed: 2026-06-12
---

# Phase 00 Plan 02: CI Anti-Pitfall Gates Summary

**Six PR-blocking CI jobs + tag-only build-and-push workflow + dependabot/CODEOWNERS/CONTRIBUTING — every contractual anti-pitfall (embedded-DB ban, committed secrets, drizzle-push, Next.js 16 drift, fb_apu0[1-9] legacy names, floating registry tags) is now a structural CI gate that blocks merge before drift can land on `main`.**

## Performance

- **Duration:** ~60 min
- **Started:** 2026-06-12T01:14:00Z (approx — Task 1 commit was the prior session's last act)
- **Completed:** 2026-06-12T02:14:00Z (approx)
- **Tasks:** 3 / 3 (all `type="auto"`, no checkpoints)
- **Files created:** 6 (.github/* + new workflow)
- **Files modified:** 3 (two CI gate scripts hardened against self-trip + README.md Release section)

## Accomplishments

- **PR-blocking gate quartet wired into CI.** `.github/workflows/ci.yml` runs all four `scripts/ci/check-*.sh` gates as the first job (`anti-pitfall-gates`); the rest of the pipeline (`secrets-scan`, `lint-typecheck`, `test`, `build`, `verify-no-latest-in-workflows`) follows. Job names are stable so branch protection rules can target them by name.
- **gitleaks server-side scan via the official action.** `gitleaks/gitleaks-action@v2` with `fetch-depth: 0` runs against the full diff on every PR using the project's `.gitleaks.toml` ruleset (allowlists `.env.example` placeholders). The npm package named "gitleaks" is NOT used — the binary action + the local pre-commit binary install (Plan 01) are the only acceptable sources.
- **Postgres 16-alpine sidecar in CI.** The `test` job spins up `postgres:16-alpine` with a `pg_isready` healthcheck and exports `DATABASE_URL`/`DATABASE_MIGRATOR_URL` so Plan 03's RLS integration tests have a clean DB on every PR. Vitest runs with `--passWithNoTests` for now; Plan 03 adds the first real tests and the flag becomes redundant.
- **`pnpm build` smoke at PR time.** The `build` job catches Next.js config drift (missing env, broken plugin, breaking Tailwind 4 migration) before merge using placeholder env vars that mirror Plan 03+ runtime expectations.
- **Tag-only Docker push to GHCR.** `.github/workflows/build-and-push.yml` triggers ONLY on `push: tags: ['v*.*.*']`. The workflow extracts `APP_VERSION` from `$GITHUB_REF_NAME`, builds `docker/Dockerfile` with the matching `--build-arg`, and pushes two tags: `ghcr.io/${repo}:${APP_VERSION}` + `ghcr.io/${repo}:${github.sha}`. Floating tag is NEVER pushed; the workflow re-greps itself at release time as a belt-and-braces guard against UI-edit drift.
- **Floating-tag PR gate.** `ci.yml` has a `verify-no-latest-in-workflows` job that fails the PR if any workflow YAML, Dockerfile, or compose file gains a real `<image>:latest` reference. The regex (`[A-Za-z0-9_./-]:latest\b`) requires a word/path char immediately before the marker so documentation strings pass.
- **Dependabot policy locked.** Weekly Monday 07:00 America/Sao_Paulo. npm minor+patch grouped; major bumps as individual PRs. Hard ignores: `next@16.x`, `sqlite3`, `better-sqlite3`, `@libsql/*`. GitHub Actions weekly so action-major drift surfaces explicitly.
- **CODEOWNERS + PR template + CONTRIBUTING.** The human-side of the contract: every PR auto-loads the anti-pitfall checklist; security-sensitive paths (`workflows/`, `scripts/ci/`, `docker/`, `.gitleaks.toml`) get owner review; CONTRIBUTING.md documents how to reproduce every CI gate locally with `pnpm run check:all`.

## Task Commits

Each task was committed atomically (sequential mode, single working tree). Rule 1 auto-fixes for gate self-trip live in their own commits so the history shows the bug → fix sequence cleanly:

1. **Task 1: Reusable anti-pitfall shell gates** — `8dabe5b` (feat, from prior session)
2. **Rule 1 fix: drizzle-push gate self-trip** — `e87c89e` (fix)
3. **Task 2: CI workflow + dependabot + CODEOWNERS + PR template** — `293a71f` (feat)
4. **Rule 1 fix: legacy-name gate markdown self-trip** — `c85c4aa` (fix)
5. **Task 3: build-and-push workflow + floating-tag PR gate + README Release** — `e8cd894` (feat)

**Plan metadata commit** will land immediately after this SUMMARY.md.

## Files Created / Modified

**Created:**
- `.github/workflows/ci.yml` — six PR-blocking jobs (see Accomplishments)
- `.github/workflows/build-and-push.yml` — tag-triggered Docker build → GHCR, semver + SHA tags only, in-workflow floating-tag guard
- `.github/dependabot.yml` — npm + github-actions ecosystems, weekly grouped, hard ignores
- `.github/CODEOWNERS` — placeholder `@REPO_OWNER_PLACEHOLDER` until first GitHub push; security paths covered
- `.github/pull_request_template.md` — Summary / Linked Plan / Test Plan / Anti-Pitfall Checklist / Local Verification / Notes sections
- `.github/CONTRIBUTING.md` — quickstart, pre-commit hook reference, CI gate table, common-failure remediation matrix, release process

**Modified:**
- `scripts/ci/check-no-drizzle-push.sh` — restricted `--include` to executable file types, tightened end-of-match boundary, filtered out YAML `name:` step labels (Rule 1 fix from `e87c89e`)
- `scripts/ci/check-no-legacy-names.sh` — dropped `--include='*.md'` so CONTRIBUTING.md's documentation of the gate cannot trip the gate (Rule 1 fix from `c85c4aa`)
- `README.md` — added "Release" section documenting `pnpm version patch && git push --follow-tags` as the only release path

## Decisions Made

1. **Six CI jobs, not five — fold `verify-no-latest-in-workflows` into ci.yml during Task 2 rather than appending in Task 3.** The plan describes Task 2 as five jobs + Task 3 appending a sixth. In practice the workflow file is one indivisible artifact; including the floating-tag gate in the initial ci.yml commit keeps the PR-time enforcement story coherent (Task 2 = PR-time; Task 3 = release-time). The acceptance check `grep -q 'verify-no-latest-in-workflows' .github/workflows/ci.yml` still passes — the job is present, just authored earlier than the literal task split.
2. **Two acceptable image tags from a release: semver + commit SHA.** Both `ghcr.io/${repo}:${APP_VERSION}` and `ghcr.io/${repo}:${github.sha}` get pushed. Semver is what Coolify pulls; SHA is what an ops investigation pins to for incident triage. Adding floating tag would obviate both — structurally banned.
3. **Floating-tag regex tightened to `[A-Za-z0-9_./-]:latest\b`.** The plan's verify step used `:latest\b`, which matched its own documentation and grep pattern. New regex requires a word/path char immediately before `:latest` so only real image references match. Sanity confirmed (scratch fixture) that `run: docker pull ghcr.io/me/app:latest` matches and `# describes the :latest ban` does not.
4. **Markdown excluded from the legacy-name gate.** `.github/CONTRIBUTING.md` has to spell out `fb_apu01/02/03/04` to explain what the gate catches. Documentation is not runtime code; load-bearing coverage on TS/JS/JSON/YAML/sh/Dockerfile is preserved. Sanity verified that a `*.ts` import of `'fb_apu04/legacy'` still fails the gate.
5. **drizzle-push gate restricted to executable file types.** Same false-positive class as #3 and #4. The gate now scans only `*.sh`, `*.yml`/`*.yaml`, `package.json`, `Dockerfile*`, `*.dockerfile`, `docker-compose*.yml/yaml`. YAML `name:` step labels are filtered out via a post-grep `grep -v`. A real `pnpm drizzle-kit push` invocation in a `run:` block or a `"db:push": "drizzle-kit push"` script entry still fails the gate.
6. **`gitleaks-action@v2` pinned (not v3).** RESEARCH verified v2 is the current major; v3 was flagged as a "version recheck open question" but no evidence supports moving yet. Dependabot's github-actions schedule will surface a real v3 release when it ships.
7. **CODEOWNERS placeholder over blocking-progress.** The plan accepts a placeholder owner with the rationale that the developer fills it in after the first push to GitHub. Documented in `.github/CODEOWNERS` and `.github/CONTRIBUTING.md` as a follow-up — not a runtime blocker because solo-dev workflows don't require code review until collaborators join.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] drizzle-push gate tripped on its own documentation**

- **Found during:** Task 2 verification (after authoring `.github/workflows/ci.yml` and `.github/pull_request_template.md` and re-running `pnpm run check:all`)
- **Issue:** `scripts/ci/check-no-drizzle-push.sh` used `grep -rnE 'drizzle-kit[[:space:]]+push'` which matched a CI workflow step `name: drizzle-kit push ban` and a PR template item `No \`drizzle-kit push\` invocation added`. Documentation of the ban tripped the ban — meaning every PR template and every workflow step name that DESCRIBED the rule would have failed CI.
- **Fix:** Restricted `--include` to file types that can actually run a command (`*.sh`, `*.yml`/`*.yaml`, `package.json`, `Dockerfile*`, `*.dockerfile`, `docker-compose*.yml`). Tightened the trailing boundary to `[[:space:]"']|$` so `"drizzle-kit push"` (package.json script) is caught while `` `drizzle-kit push` `` (prose backtick) passes. Added a post-grep `grep -v` to drop YAML `name:` step labels. Updated the script header comment to explain the carve-out so a future contributor cannot "fix" the absence of markdown without re-reading why it was removed.
- **Files modified:** `scripts/ci/check-no-drizzle-push.sh`
- **Verification:** Scratch fixture (`/tmp/drizzle-test/`) confirmed:
  - Catches `pnpm drizzle-kit push --schema=…` in `*.sh`
  - Catches `- run: pnpm drizzle-kit push` in `*.yml`
  - Catches `"db:push": "drizzle-kit push"` in `package.json`
  - Skips `- name: drizzle-kit push ban` (YAML name: key)
  - Skips markdown prose entirely (e.g., `` No `drizzle-kit push` invocation `` in CONTRIBUTING.md / PR template)
  - Real-repo `bash scripts/ci/check-no-drizzle-push.sh` exits 0
- **Committed in:** `e87c89e`

**2. [Rule 1 - Bug] floating-tag PR gate tripped on its own grep pattern**

- **Found during:** Task 3 verification (after authoring `.github/workflows/build-and-push.yml` and re-running the verify-no-latest step locally)
- **Issue:** `ci.yml`'s `verify-no-latest-in-workflows` step used `grep -rnE ':latest\b'`. That regex pattern itself contains the substring `:latest`, AND the workflow's comments document the ban with phrases like `` `:latest` reappears ``. The gate matched its own documentation, error messages, and the grep pattern literal — meaning the PR-time verify step would always fail.
- **Fix:** Tightened the regex to `[A-Za-z0-9_./-]:latest\b` — requires a word/path character (the prefix of a Docker image identifier) immediately before the floating-tag marker. Real references (`image: foo:latest`, `FROM bar/baz:latest`, `ghcr.io/o/r:latest`) match; documentation strings where the marker is preceded by space, backtick, or quote do not. Applied the same tightening to the in-workflow guard step inside `build-and-push.yml`. Renamed the output line to `verify-no-floating-tag` and rewrote the inline comments to avoid spelling out `name + floating-tag` in concatenated form.
- **Files modified:** `.github/workflows/ci.yml`, `.github/workflows/build-and-push.yml`
- **Verification:** Scratch fixture confirmed:
  - Catches `run: docker pull ghcr.io/me/app:latest`
  - Skips `# describes the :latest ban` (space before marker)
  - Skips `if grep ... ':latest\\b'` (quote before marker)
  - Real-repo `grep -rnE '[A-Za-z0-9_./-]:latest\b' .github/workflows/ docker/` exits 1 (no hits)
- **Committed in:** `e8cd894` (folded into Task 3 since it's part of the floating-tag enforcement story)

**3. [Rule 1 - Bug] legacy-name gate tripped on CONTRIBUTING.md's documentation table**

- **Found during:** Final pre-summary verification (after committing Task 3, re-running all four gates as a final check)
- **Issue:** `scripts/ci/check-no-legacy-names.sh` scanned markdown via `--include='*.md'`. `.github/CONTRIBUTING.md` line 53 has a "common failures" table row that legitimately writes ``| `check-no-legacy-names` fails | You imported or referenced `fb_apu01`/`02`/`03`/`04` | …`` — the table entry that explains what the gate catches. Same false-positive class as #1 and #2.
- **Fix:** Dropped `--include='*.md'` from the legacy-name grep. Markdown does not get compiled or executed; a legacy-name mention in prose is documentation, not drift. The gate keeps full coverage of runtime code paths (TS/JS/JSON imports, workflow `run:` blocks, shell scripts, Dockerfiles). Added a header comment explaining the carve-out so a future contributor cannot "fix" the absence of markdown without re-reading why it was removed.
- **Files modified:** `scripts/ci/check-no-legacy-names.sh`
- **Verification:** Scratch fixture (`src/bad.ts` with `import { foo } from 'fb_apu04/legacy'`) confirmed the gate still catches a real reference. Real-repo `bash scripts/ci/check-no-legacy-names.sh` exits 0.
- **Committed in:** `c85c4aa`

---

**Total deviations:** 3 auto-fixed (all Rule 1 — gate self-trip bugs)
**Impact on plan:** All three deviations were necessary for the gates to actually be load-bearing. A gate that self-trips fails every PR and forces contributors to invent euphemisms in documentation — which defeats the purpose of describing the rule. None expanded scope; all three made the planned gates work as designed. The shared root cause (gates matching their own documentation) is now a pattern in the project: "gate self-trip immunity" — every reusable `check-*.sh` script must use `--include` filters and structural anchors so its own labels and prose cannot trip it.

## Issues Encountered

- **Pre-commit hook warns about missing gitleaks binary on every commit.** This is Plan 01's intended degraded-fallback behavior — the hook prints a yellow warning and skips the local scan if `gitleaks` is not on `$PATH`. CI catches anything local skipping misses. Documented in `.github/CONTRIBUTING.md` quickstart: developers should run `bash scripts/install-gitleaks.sh` once after `pnpm install`. Not a runtime blocker.
- **YAML comments containing example image references would trip the new floating-tag regex.** While drafting `.github/workflows/build-and-push.yml`, my initial comment used `image: foo:latest` / `ghcr.io/o/r:latest` as inline documentation — both real-looking image references that the tightened regex matched. Rewrote the comments to use spaced-out tokens (e.g., "the floating-tag marker") rather than concatenated `name:floating-tag` examples. This is a one-time authoring lesson, not a structural issue.

## Threat Flags

No new threat-relevant surface introduced beyond the three CI gates the plan's threat model already covers (T-0-02, T-0-03, T-0-04, T-0-07, T-0-SC). All anti-pitfall mitigations are implemented per the plan's STRIDE register.

## User Setup Required

None — CI runs automatically on push and on `pull_request` once the repository lives on GitHub. Two one-time follow-ups (already documented in `.github/CONTRIBUTING.md` and `.github/CODEOWNERS`):

1. **Replace `@REPO_OWNER_PLACEHOLDER` in `.github/CODEOWNERS`** with the actual GitHub handle after the first push. The gate runs whether the owner is real or placeholder; the placeholder just means PR review notifications go to nobody until the handle is real.
2. **Enable branch protection on `main`** in GitHub repo settings → require status checks → tick all six job names (`anti-pitfall-gates`, `secrets-scan`, `lint-typecheck`, `test`, `build`, `verify-no-latest-in-workflows`). Without branch protection the gates run but don't actually block merge — they're informational. The job names were chosen to be stable precisely so this checklist can be ticked once and forgotten.

## Self-Check: PASSED

- All 6 created files exist on disk:
  - `[ -f .github/workflows/ci.yml ]` ✓
  - `[ -f .github/workflows/build-and-push.yml ]` ✓
  - `[ -f .github/dependabot.yml ]` ✓
  - `[ -f .github/CODEOWNERS ]` ✓
  - `[ -f .github/pull_request_template.md ]` ✓
  - `[ -f .github/CONTRIBUTING.md ]` ✓
- All 5 task commits reachable in `git log --all`:
  - `8dabe5b` (Task 1, prior session)
  - `e87c89e` (Rule 1 fix — drizzle-push)
  - `293a71f` (Task 2)
  - `c85c4aa` (Rule 1 fix — legacy-name markdown)
  - `e8cd894` (Task 3)
- Both new workflow YAML files parse with `python3 yaml.safe_load`.
- All four `scripts/ci/check-*.sh` gates exit 0 on the working tree.
- `pnpm run check:all` exits 0.
- `grep -rnE '[A-Za-z0-9_./-]:latest\b' .github/workflows/ docker/` exits 1 (no real floating-tag references).
- `grep -q 'gitleaks/gitleaks-action@v2' .github/workflows/ci.yml` ✓
- `grep -q 'postgres:16-alpine' .github/workflows/ci.yml` ✓
- `grep -q "'v\*\.\*\.\*'" .github/workflows/build-and-push.yml` ✓ (tag-only trigger)
- `grep -q '^## Release' README.md` ✓

## Next Plan Readiness

- **Plan 03 (Postgres + Drizzle + RLS) — READY.** The CI `test` job already runs a `postgres:16-alpine` sidecar with `DATABASE_URL`/`DATABASE_MIGRATOR_URL` exported; Plan 03's two-role setup (`fb_eventos_app` / `fb_eventos_migrator`) plus the RLS integration tests can hit it directly. `--passWithNoTests` becomes redundant once Plan 03 adds the first `*.test.ts` files.
- **Plan 04 (Better Auth) — READY.** The `build` job already exports `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` placeholders so a missing-env Next.js misconfig is caught at PR time.
- **Plan 07 (Coolify Deploy) — READY.** The semver/SHA tag scheme produced by `build-and-push.yml` is exactly what Coolify pulls. Coolify needs a GHCR pull token; documented as Plan 07's responsibility.
- **No blockers, no carryover.** Two follow-ups (CODEOWNERS handle, branch protection enable) are user-action items documented in CONTRIBUTING.md, not engineering blockers.

---
*Phase: 00-foundation-stack-lock-anti-pitfall-hardening*
*Completed: 2026-06-12*
