---
phase: 00-foundation-stack-lock-anti-pitfall-hardening
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - .github/workflows/ci.yml
  - .github/workflows/build-and-push.yml
  - .github/dependabot.yml
  - .github/CODEOWNERS
  - .github/pull_request_template.md
  - .github/CONTRIBUTING.md
  - scripts/ci/check-no-drizzle-push.sh
  - scripts/ci/check-no-legacy-names.sh
  - scripts/ci/check-no-embedded-db.sh
  - scripts/ci/check-nextjs-version.sh
autonomous: true
requirements:
  - FOUND-04
  - FOUND-05
  - FOUND-07
requirements_addressed:
  - FOUND-04
  - FOUND-05
  - FOUND-07
tags:
  - ci
  - github-actions
  - gitleaks
  - anti-pitfall
  - embedded-db-ban
must_haves:
  truths:
    - "Every PR runs a CI workflow that exits non-zero if package.json gains `sqlite3`/`better-sqlite3`/`@libsql/*`/`bun:sqlite`"
    - "Every PR runs a CI step that exits non-zero if any `*.db`/`*.sqlite`/`tracker-*.db` file is committed"
    - "Every PR runs `gitleaks-action@v2` against the diff and blocks on detected secrets"
    - "Every PR runs Biome lint + `tsc --noEmit` and blocks on errors"
    - "Every PR runs Vitest (no tests yet — exit 0 with `--passWithNoTests` is acceptable in Plan 02; tests added in Plan 03+)"
    - "Every PR runs `pnpm build` and blocks on failure"
    - "CI blocks any reintroduction of `fb_apu0[1-9]` legacy module names in `src/`"
    - "CI blocks `drizzle-kit push` invocation in any committed script/workflow"
    - "CI blocks Next.js 16 in dependencies (only `~15.5.x` allowed)"
    - "A separate build-and-push workflow tags the Docker image with semver from package.json + git SHA — never `:latest`"
  artifacts:
    - path: ".github/workflows/ci.yml"
      provides: "PR-blocking CI pipeline with anti-pitfall gates"
      contains: "anti-pitfall-gates"
    - path: ".github/workflows/build-and-push.yml"
      provides: "Tag-triggered Docker build pushing semver to GHCR"
    - path: "scripts/ci/check-no-embedded-db.sh"
      provides: "Embedded-DB grep gate (also reusable by Husky / local)"
    - path: "scripts/ci/check-no-drizzle-push.sh"
      provides: "Blocks `drizzle-kit push` invocations in scripts/CI"
    - path: ".github/pull_request_template.md"
      provides: "PR checklist referencing anti-pitfall gates"
  key_links:
    - from: ".github/workflows/ci.yml"
      to: "scripts/ci/*.sh"
      via: "run: bash scripts/ci/check-no-embedded-db.sh"
      pattern: "bash\\s+scripts/ci/check-"
    - from: ".github/workflows/ci.yml"
      to: "gitleaks/gitleaks-action@v2"
      via: "uses: gitleaks/gitleaks-action@v2"
      pattern: "gitleaks/gitleaks-action@v2"
    - from: ".github/workflows/build-and-push.yml"
      to: "docker/Dockerfile"
      via: "docker build -f docker/Dockerfile with semver tag"
      pattern: "docker build.+--build-arg APP_VERSION"
---

<objective>
Install the PR-blocking CI gates that enforce the contractual anti-pitfalls from `.planning/research/PITFALLS.md` and CLAUDE.md "What NOT to Use". Without Plan 02, the FB_APU04 disasters (embedded SQLite watermark, committed secrets, `:latest` auto-deploy, self-healing migrations, legacy module name drift) can creep back in via a single careless PR.

Purpose: Anti-pitfalls #1 (embedded-DB ban), #6 (committed secrets), #16 (legacy module names), #17 (self-healing migrations via push), #19 (Watchtower/`:latest`) are turned into structural CI gates that fail PRs before merge. Defuses T-0-02, T-0-03, T-0-04, T-0-07.

Output: GitHub Actions workflows + reusable shell gate scripts + Dependabot config + PR template + CODEOWNERS — the full "no PR merges without passing the contract" floor.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/PROJECT.md
@.planning/research/PITFALLS.md
@.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md
@.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-VALIDATION.md

<interfaces>
<!-- Required GitHub Actions / Action versions (verified in RESEARCH.md). -->
<!-- Pin EXACTLY — these are the CI gate dependencies. -->

actions:
  actions/checkout@v4
  actions/setup-node@v4
  pnpm/action-setup@v4 (version: 9)
  gitleaks/gitleaks-action@v2          # NOT v1; v2 is what RESEARCH.md verifies
  docker/setup-buildx-action@v3        (for build-and-push.yml)
  docker/login-action@v3
  docker/build-push-action@v6

ci.yml expected jobs (names must match exactly so branch protection can target them):
  - anti-pitfall-gates
  - secrets-scan
  - lint-typecheck
  - test
  - build

# Banned patterns enforced by gates:
embedded_db_packages_regex: '"(sqlite3|better-sqlite3|@libsql|bun:sqlite|@libsql/client)"'
embedded_db_file_glob:      '*.db, *.sqlite, tracker-*.db'
legacy_module_regex:        'fb_apu0[1-9]'
nextjs_16_regex:            '^\^?16\.|^>=16|^>16'
drizzle_push_regex:         'drizzle-kit\s+push'
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Author reusable anti-pitfall shell gates</name>
  <files>scripts/ci/check-no-embedded-db.sh, scripts/ci/check-no-legacy-names.sh, scripts/ci/check-no-drizzle-push.sh, scripts/ci/check-nextjs-version.sh, package.json</files>
  <read_first>
    - .planning/research/PITFALLS.md (pitfalls #1, #16, #17, #19)
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (section "Pattern 12: CI Pipeline YAML" — copy the grep/find patterns)
    - CLAUDE.md (section "What NOT to Use")
  </read_first>
  <action>
    Extract the gates into reusable bash scripts so both Husky pre-commit (Plan 01) and CI (Tasks 2-3 below) call the same code paths. Each script: `#!/usr/bin/env bash`, `set -euo pipefail`, emits `::error::` annotations on GitHub Actions, exits 1 on hit, exits 0 on clean.

    1. `scripts/ci/check-no-embedded-db.sh` — defuses pitfall #1 (T-0-04).
       - Step A: `grep -E '"(sqlite3|better-sqlite3|@libsql|bun:sqlite|@libsql/client)"' package.json` → if match, print `::error::Embedded database package detected in package.json` and exit 1.
       - Step B: `find . -not -path './.git/*' -not -path './node_modules/*' -not -path './.next/*' \( -name "*.db" -o -name "*.sqlite" -o -name "tracker-*.db" \) -print` → if any output, error + exit 1.

    2. `scripts/ci/check-no-legacy-names.sh` — defuses pitfall #16 (legacy `fb_apu04` module name drift).
       - `grep -rn 'fb_apu0[1-9]' src/ .github/ docker/ scripts/ docs/ --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.yaml" --include="*.sh" --include="*.dockerfile" --include="Dockerfile*" --include="*.md" 2>/dev/null || true` — if any line returned, error + exit 1.

    3. `scripts/ci/check-no-drizzle-push.sh` — defuses pitfall #17 (self-healing/destructive migrations via `drizzle-kit push`).
       - `grep -rn -E 'drizzle-kit\s+push' .github/ scripts/ docker/ package.json 2>/dev/null || true` — if any line returned, error + exit 1 with message `drizzle-kit push is contractually banned (RESEARCH Pitfall 4)`.

    4. `scripts/ci/check-nextjs-version.sh` — defuses pitfall (Next.js 16 drift, RESEARCH Pitfall 1).
       - `VERSION=$(node -e "console.log(require('./package.json').dependencies.next || '')")`
       - If `$VERSION` matches `^(\^?16\.|>=16|>16)` → error + exit 1.
       - If `$VERSION` does NOT match `^(\^?~?15\.5\.|~15\.5)` → emit `::warning::` (not error — allows transitional `~15.5.19`).

    5. Add npm scripts to `package.json`:
       - `"check:db"`: `bash scripts/ci/check-no-embedded-db.sh`
       - `"check:legacy"`: `bash scripts/ci/check-no-legacy-names.sh`
       - `"check:drizzle"`: `bash scripts/ci/check-no-drizzle-push.sh`
       - `"check:nextjs"`: `bash scripts/ci/check-nextjs-version.sh`
       - `"check:all"`: composes the four above with `&&`.

    6. `chmod +x scripts/ci/*.sh`.

    Per D-01/D-04 (researcher reconciliation): Plan 01 already added the embedded-DB lines to `.gitignore` and the husky hook can chain to these scripts; Plan 02 is the load-bearing CI enforcement, not the only enforcement.
  </action>
  <verify>
    <automated>chmod +x scripts/ci/*.sh && bash scripts/ci/check-no-embedded-db.sh && bash scripts/ci/check-no-legacy-names.sh && bash scripts/ci/check-no-drizzle-push.sh && bash scripts/ci/check-nextjs-version.sh && pnpm run check:all</automated>
  </verify>
  <acceptance_criteria>
    - All four `scripts/ci/check-*.sh` exist and are executable
    - All four exit 0 against the current (clean) repo state
    - Each script emits `::error::` GitHub-Actions-format messages on hit (verified by injecting a temporary `*.db` file in a test scratch checkout — manual sanity check)
    - `package.json` adds `check:db`, `check:legacy`, `check:drizzle`, `check:nextjs`, `check:all` scripts
    - `pnpm run check:all` exits 0
  </acceptance_criteria>
  <done>Reusable shell gates exist for embedded-DB ban, legacy-name ban, drizzle-push ban, Next.js-16 drift. CI workflow (next task) just calls them.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: CI workflow with gates + lint/typecheck/test/build (PR-blocking)</name>
  <files>.github/workflows/ci.yml, .github/dependabot.yml, .github/CODEOWNERS, .github/pull_request_template.md, .github/CONTRIBUTING.md</files>
  <read_first>
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (section "Pattern 12: CI Pipeline YAML")
    - scripts/ci/*.sh (just created in Task 1)
    - package.json (after Plan 01 + Task 1 — has check:* scripts)
    - CLAUDE.md (section "What NOT to Use" — Watchtower/`:latest` ban)
  </read_first>
  <action>
    Mitigates T-0-02, T-0-03, T-0-04 by gating every PR through structural checks.

    Create `.github/workflows/ci.yml` with five jobs (job names MUST match exactly so branch protection rules can target them):

    Job 1 `anti-pitfall-gates`:
      - `actions/checkout@v4`
      - Run `bash scripts/ci/check-no-embedded-db.sh`
      - Run `bash scripts/ci/check-no-legacy-names.sh`
      - Run `bash scripts/ci/check-no-drizzle-push.sh`
      - Run `bash scripts/ci/check-nextjs-version.sh`

    Job 2 `secrets-scan` (FOUND-04, T-0-02):
      - `actions/checkout@v4` with `fetch-depth: 0` (gitleaks needs full history)
      - `uses: gitleaks/gitleaks-action@v2` with `GITHUB_TOKEN` and `GITLEAKS_CONFIG: .gitleaks.toml`

    Job 3 `lint-typecheck` (FOUND-05): depends on `anti-pitfall-gates`
      - Checkout, `pnpm/action-setup@v4` (version 9), `actions/setup-node@v4` (node-version 22, cache pnpm)
      - `pnpm install --frozen-lockfile`
      - `pnpm lint` (Biome)
      - `pnpm typecheck` (`tsc --noEmit`)

    Job 4 `test`: depends on `anti-pitfall-gates`
      - Same setup as job 3 + Postgres 16-alpine service exactly as RESEARCH Pattern 12 (env: POSTGRES_USER=fb_test, POSTGRES_DB=fb_eventos_test, port 5432, `pg_isready` healthcheck).
      - `pnpm install --frozen-lockfile`
      - `pnpm vitest run --passWithNoTests` (Phase 0 Plan 02 has no tests yet — `--passWithNoTests` keeps this green; Plan 03 onward adds real tests and the flag becomes redundant).
      - Env: DATABASE_URL/DATABASE_MIGRATOR_URL pointing at the service; BETTER_AUTH_SECRET=test-secret-32-chars-minimum-here.

    Job 5 `build` (FOUND-07): depends on `[lint-typecheck, test]`
      - Setup as above
      - `pnpm install --frozen-lockfile`
      - `pnpm build` with placeholder env vars (NEXT_TELEMETRY_DISABLED=1, build-time placeholders for DATABASE_URL/BETTER_AUTH_SECRET etc.) per RESEARCH Pattern 12.

    Workflow trigger: `on: pull_request: branches: [main]` AND `on: push: branches: [main]`.

    Permissions: explicit minimum (`permissions: contents: read, pull-requests: read` at workflow level; `security-events: write` only on the `secrets-scan` job for SARIF upload).

    Then create:
    - `.github/dependabot.yml` — weekly npm + GitHub-Actions updates, grouped minor/patch, manual review for majors. Especially: `ignore: [{dependency-name: "next", versions: ["16.x", ">=16"]}]` (don't auto-bump to Next 16).
    - `.github/CODEOWNERS` — single owner `*` → `@<github-handle-placeholder>` (developer fills in after first commit; documented in README).
    - `.github/pull_request_template.md` — checklist: [ ] anti-pitfall gates green; [ ] no `:latest` introduced; [ ] no `drizzle-kit push` added; [ ] no embedded-DB package; [ ] secret scan clean; [ ] LGPD impact assessed (if touching PII).
    - `.github/CONTRIBUTING.md` — short doc explaining the gates and how to debug them locally (`pnpm run check:all`).
  </action>
  <verify>
    <automated>test -f .github/workflows/ci.yml && grep -E '^jobs:' .github/workflows/ci.yml && grep -E '^\s+anti-pitfall-gates:' .github/workflows/ci.yml && grep -E '^\s+secrets-scan:' .github/workflows/ci.yml && grep -E '^\s+lint-typecheck:' .github/workflows/ci.yml && grep -E '^\s+test:' .github/workflows/ci.yml && grep -E '^\s+build:' .github/workflows/ci.yml && grep -q 'gitleaks/gitleaks-action@v2' .github/workflows/ci.yml && grep -q 'bash scripts/ci/check-no-embedded-db.sh' .github/workflows/ci.yml && grep -q 'postgres:16-alpine' .github/workflows/ci.yml && test -f .github/dependabot.yml && test -f .github/CODEOWNERS && test -f .github/pull_request_template.md</automated>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/ci.yml` has five jobs with the exact names: `anti-pitfall-gates`, `secrets-scan`, `lint-typecheck`, `test`, `build`
    - `lint-typecheck`, `test`, `build` jobs declare `needs: anti-pitfall-gates` (gates run first)
    - `secrets-scan` job uses `gitleaks/gitleaks-action@v2` (exact pin) and passes `GITLEAKS_CONFIG: .gitleaks.toml`
    - `test` job declares a Postgres 16-alpine service with `pg_isready` healthcheck
    - `anti-pitfall-gates` job runs all four `bash scripts/ci/check-*.sh` scripts
    - Workflow uses `actions/checkout@v4`, `actions/setup-node@v4` (node-version: 22), `pnpm/action-setup@v4` (version: 9)
    - `.github/dependabot.yml` exists with `ignore` block for `next` 16.x
    - `.github/pull_request_template.md` contains the anti-pitfall checklist
    - `.github/CODEOWNERS` exists (placeholder owner allowed; flagged in README)
  </acceptance_criteria>
  <done>CI workflow runs all anti-pitfall gates + secrets scan + lint + typecheck + test + build on every PR. Dependabot + CODEOWNERS + PR template wire the human side of the contract.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Tag-triggered build-and-push workflow (semver-only Docker push to GHCR)</name>
  <files>.github/workflows/build-and-push.yml, .github/workflows/ci.yml</files>
  <read_first>
    - .planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md (Pattern 11 Dockerfile)
    - docker/Dockerfile (created in Plan 01 Task 3)
    - CLAUDE.md ("What NOT to Use" → Watchtower/`:latest`)
  </read_first>
  <action>
    Mitigates T-0-07 (Watchtower auto-deploy of `:latest`) by making semver pushes the only path to the registry.

    Create `.github/workflows/build-and-push.yml`:
    - Trigger: `on: push: tags: ['v*.*.*']` only (no branch trigger — production images are tagged releases, not every commit on main).
    - Permissions: `packages: write, contents: read`.
    - Job `build-and-push`:
      - Checkout
      - `docker/setup-buildx-action@v3`
      - `docker/login-action@v3` to `ghcr.io` with `GITHUB_TOKEN`
      - Extract version from git tag: `APP_VERSION=${GITHUB_REF_NAME#v}` (e.g. tag `v0.1.0` → `0.1.0`)
      - `docker/build-push-action@v6` with:
        - `context: .`
        - `file: docker/Dockerfile`
        - `build-args: APP_VERSION=${{ env.APP_VERSION }}`
        - `tags: ghcr.io/${{ github.repository }}:${{ env.APP_VERSION }}` AND `ghcr.io/${{ github.repository }}:${{ github.sha }}`
        - NEVER `latest` tag — DO NOT include `:latest` in tags list. Add an explicit comment `# DO NOT add :latest — contractual ban (CLAUDE.md / T-0-07)`.
        - `push: true`

    Also add a "guard" final step in this workflow:
    ```
    - name: Reject :latest tag attempts
      run: |
        if grep -E ':latest\b' .github/workflows/build-and-push.yml; then
          echo "::error:::latest tag detected in build-and-push workflow"; exit 1
        fi
    ```

    Append a final job to `ci.yml` (PR-blocking) called `verify-no-latest-in-workflows`:
    ```
    - run: |
        if grep -rE ':latest\b' .github/workflows/ docker/; then
          echo "::error::Reintroduction of :latest detected"; exit 1
        fi
    ```

    Add a one-line `README.md` deploy section: "To release: `pnpm version patch && git push --follow-tags`. The tag triggers the build-and-push workflow."

    Per D-04 (CLAUDE.md ban + T-0-07): `:latest` MUST NOT appear in any workflow YAML, any Dockerfile, or any docker-compose file. The verify-no-latest grep gate catches reintroduction at PR time.
  </action>
  <verify>
    <automated>test -f .github/workflows/build-and-push.yml && grep -E "^on:\s*$|tags:\s*\['v\*\.\*\.\*'\]" .github/workflows/build-and-push.yml && ! grep -E ':latest\b' .github/workflows/build-and-push.yml && grep -q 'docker/build-push-action@v6' .github/workflows/build-and-push.yml && grep -q 'APP_VERSION' .github/workflows/build-and-push.yml && grep -q 'verify-no-latest-in-workflows' .github/workflows/ci.yml</automated>
  </verify>
  <acceptance_criteria>
    - `.github/workflows/build-and-push.yml` triggers ONLY on `push: tags: ['v*.*.*']`
    - The workflow uses `docker/login-action@v3` and `docker/build-push-action@v6` (verified action versions)
    - Tag list pushed includes `${{ env.APP_VERSION }}` and `${{ github.sha }}` (no `:latest`)
    - `! grep -E ':latest\b' .github/workflows/build-and-push.yml` exits 0
    - `! grep -rE ':latest\b' .github/workflows/` exits 0 (no :latest anywhere in workflows)
    - `ci.yml` includes a `verify-no-latest-in-workflows` step that greps for `:latest` and fails on hit
    - README.md has a "Release" section documenting `pnpm version patch && git push --follow-tags`
  </acceptance_criteria>
  <done>Production Docker images can only be produced by tagged releases; semver tags are the only artifact pushed; `:latest` cannot reappear via PR without the CI gate blocking it.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| PR author → main branch | CI workflow is the only barrier; branch protection should require ci/* checks |
| GHCR tag → Coolify pull | Only semver-tagged images exist; no `:latest` rolling tag |
| Diff content → committed history | gitleaks-action@v2 scans full diff on every PR |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-0-02 | Information Disclosure | committed source files | mitigate | `gitleaks/gitleaks-action@v2` job; full-history fetch; `.gitleaks.toml` allowlist for .example files |
| T-0-03 | Tampering | drizzle-kit migration discipline | mitigate | `scripts/ci/check-no-drizzle-push.sh` blocks any `drizzle-kit push` in workflows or scripts |
| T-0-04 | Tampering / Information Disclosure | embedded-DB package or file drift | mitigate | `scripts/ci/check-no-embedded-db.sh` + `.gitignore` (Plan 01) — defense-in-depth |
| T-0-07 | Tampering / EoP | Docker image tagging | mitigate | `verify-no-latest-in-workflows` CI step + `build-and-push.yml` only triggers on `v*.*.*` tags; no branch push triggers |
| T-0-SC | Supply Chain | GitHub Actions versions | mitigate | All actions pinned to verified major (`@v4`, `@v6`, `@v2`); RESEARCH Open Question A4 flagged `gitleaks-action` version recheck |
</threat_model>

<verification>
1. CI workflow file is parsed by GitHub (push a no-op commit; workflow should appear in Actions tab without YAML errors).
2. `bash scripts/ci/check-no-embedded-db.sh` exits 0 on clean repo, exits 1 if a `test.db` file is added (manual sanity).
3. `! grep -rE ':latest\b' .github/workflows/ docker/` exits 0.
4. `grep -q 'gitleaks/gitleaks-action@v2' .github/workflows/ci.yml` exits 0.
5. `grep -q 'tags: \[.*v\*\.\*\.\*' .github/workflows/build-and-push.yml` or equivalent — the build-and-push trigger is tag-only.
</verification>

<success_criteria>
- Every PR runs five CI jobs in order: anti-pitfall-gates → secrets-scan → lint-typecheck → test → build; all PR-blocking
- All four anti-pitfall shell gates (embedded-DB, legacy-name, drizzle-push, Next.js-16) are reusable scripts callable from CI and Husky
- Dependabot ignores Next.js 16+ bumps
- Production Docker images can ONLY be built from `v*.*.*` git tags; never from branch pushes; never tagged `:latest`
- The `:latest` ban is reinforced by a dedicated CI grep step that fails the PR if reintroduced
</success_criteria>

<output>
Create `.planning/phases/FB_EVENTOS-00-foundation-stack-lock-anti-pitfall-hardening/00-02-SUMMARY.md` listing:
- All five CI job names + their dependencies
- Path to each anti-pitfall shell gate
- Tag-trigger pattern for production builds
- Anti-pitfalls structurally enforced (#1, #6, #16, #17, #19)
</output>
