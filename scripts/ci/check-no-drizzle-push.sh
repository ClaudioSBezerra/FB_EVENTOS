#!/usr/bin/env bash
# FB_EVENTOS — drizzle-kit push ban (Plan 02 / RESEARCH Pitfall 4 / T-0-03).
#
# `drizzle-kit push` is the destructive "sync schema to DB without generating
# a migration file" command. It produces no reviewable artifact, no rollback
# path, and silently drops columns when the in-code schema diverges from the
# live DB — exactly the failure mode FB_APU04's `DROP TABLE schema_migrations`
# auto-heal exhibited.
#
# Migrations in FB_EVENTOS go through `drizzle-kit generate` + `drizzle-kit
# migrate` only. This gate blocks any CI workflow, script, docker invocation,
# or package.json script that calls `drizzle-kit push`.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

SCAN_PATHS=()
for p in .github scripts docker package.json; do
  [ -e "$p" ] && SCAN_PATHS+=("$p")
done

if [ "${#SCAN_PATHS[@]}" -eq 0 ]; then
  echo "check-no-drizzle-push: OK (no scan targets present yet)"
  exit 0
fi

# Match real invocations of `drizzle-kit push` only — not documentation
# references. A real invocation appears in:
#   - a shell script (`*.sh`)
#   - a CI workflow's `run:` shell block (`*.yml` / `*.yaml`)
#   - a package.json `scripts` entry
#   - a Dockerfile / docker-compose
#
# Markdown files are NOT scanned because they describe the ban (PR
# template, READMEs, this script's own header). The gate's job is to fail
# a build if a command actually runs, not to police prose.
#
# Workflow `name:` keys are also excluded since they describe the step's
# purpose — banning the substring would force euphemisms for the step
# label that documents the ban itself.
HITS=$(grep -rnE 'drizzle-kit[[:space:]]+push([[:space:]"'"'"']|$)' "${SCAN_PATHS[@]}" \
  --include='*.sh' \
  --include='*.yml' --include='*.yaml' \
  --include='package.json' \
  --include='Dockerfile*' --include='*.dockerfile' \
  --include='docker-compose*.yml' --include='docker-compose*.yaml' \
  --exclude='check-no-drizzle-push.sh' \
  2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*-?[[:space:]]*name:' \
  || true)

if [ -n "$HITS" ]; then
  echo "::error::\`drizzle-kit push\` is contractually banned (RESEARCH Pitfall 4 / T-0-03). Use \`drizzle-kit generate\` + \`drizzle-kit migrate\` so every schema change ships as a reviewable migration file."
  while IFS= read -r line; do
    FILE=$(printf '%s' "$line" | cut -d: -f1)
    LINENO=$(printf '%s' "$line" | cut -d: -f2)
    MSG=$(printf '%s' "$line" | cut -d: -f3-)
    echo "::error file=${FILE},line=${LINENO}::drizzle-kit push call detected: ${MSG}"
  done <<< "$HITS"
  exit 1
fi

echo "check-no-drizzle-push: OK (no drizzle-kit push invocations detected)"
exit 0
