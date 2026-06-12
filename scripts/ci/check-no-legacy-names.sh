#!/usr/bin/env bash
# FB_EVENTOS — Legacy FB_APU0[1-9] module-name ban (Plan 02 / Pitfall #16).
#
# FB_APU04 still imports `fb_apu01/...` modules — the stale name confused
# contributors and contributed to the 2026-05-07 wrong-binary deploy.
# This project is `fb-eventos` from day one; any reintroduction of
# `fb_apu0[1-9]` in source, workflows, dockerfiles, scripts, or docs fails
# the build.
#
# Allowed exception: this script itself (the regex literal is documentation).
# Allowed by virtue of being out-of-scan: .planning/ (research/history docs)
# and CLAUDE.md (which references the lesson learned).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Scan directories that ship in the runtime image or in operational tooling.
# Explicitly skip:
#   - the gate script itself (this file)
#   - .planning/ (intentional historical references)
#   - CLAUDE.md (intentional historical reference)
SCAN_DIRS=()
for d in src .github docker scripts docs; do
  [ -d "$d" ] && SCAN_DIRS+=("$d")
done

if [ "${#SCAN_DIRS[@]}" -eq 0 ]; then
  echo "check-no-legacy-names: OK (no scan dirs present yet)"
  exit 0
fi

# Use grep -r with multiple --include masks. Exclude the gate script itself.
#
# Markdown is intentionally NOT scanned — `.github/CONTRIBUTING.md` and the
# anti-pitfall docs legitimately reference `fb_apu01..04` when explaining
# what the gate catches. Markdown does not get compiled or executed, so a
# legacy-name mention in prose is documentation, not drift. The gate's
# load-bearing job is to catch the name in runtime code paths
# (TS/JS/JSON imports, workflow `run:` blocks, scripts, Dockerfiles).
HITS=$(grep -rn 'fb_apu0[1-9]' "${SCAN_DIRS[@]}" \
  --include='*.ts' --include='*.tsx' \
  --include='*.js' --include='*.jsx' \
  --include='*.json' \
  --include='*.yml' --include='*.yaml' \
  --include='*.sh' \
  --include='Dockerfile*' --include='*.dockerfile' \
  --exclude='check-no-legacy-names.sh' \
  2>/dev/null || true)

if [ -n "$HITS" ]; then
  echo "::error::Legacy FB_APU04 module name (fb_apu0[1-9]) detected — FB_EVENTOS uses 'fb-eventos' throughout (CLAUDE.md 'What NOT to Use')."
  while IFS= read -r line; do
    # Format as GitHub annotation: "file:line:col: …"
    FILE=$(printf '%s' "$line" | cut -d: -f1)
    LINENO=$(printf '%s' "$line" | cut -d: -f2)
    MSG=$(printf '%s' "$line" | cut -d: -f3-)
    echo "::error file=${FILE},line=${LINENO}::Legacy module name reference: ${MSG}"
  done <<< "$HITS"
  exit 1
fi

echo "check-no-legacy-names: OK (no fb_apu0[1-9] references in source/workflow/script/docs)"
exit 0
