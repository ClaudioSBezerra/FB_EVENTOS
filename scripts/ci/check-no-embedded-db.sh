#!/usr/bin/env bash
# FB_EVENTOS — Embedded-DB ban (Plan 02 / FOUND-02 / FOUND-03 / T-0-04).
#
# Defuses PROJECT.md hard contract + CLAUDE.md "What NOT to Use" — the
# embedded-DB watermark anti-pattern that haunted FB_APU04.
#
# Two checks:
#   A) package.json must not declare sqlite3 / better-sqlite3 / @libsql/*
#      / bun:sqlite — the JS-ecosystem embedded DB packages.
#   B) The working tree must not contain *.db, *.sqlite, or tracker-*.db
#      files. .gitignore (Plan 01) is the passive arm; this is the active arm.
#
# Exits 1 on any hit, 0 on clean. Emits GitHub Actions ::error:: annotations.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

HIT=0

# ---- A) Embedded-DB packages in package.json ----
if [ -f package.json ]; then
  # Match the package name as a JSON key (quoted, followed by colon).
  if grep -nE '"(sqlite3|better-sqlite3|@libsql/client|@libsql/core|bun:sqlite)"\s*:' package.json; then
    echo "::error file=package.json::Embedded database package detected in package.json (sqlite3 / better-sqlite3 / @libsql / bun:sqlite are contractually banned — see CLAUDE.md 'Embedded-DB Anti-Pattern' and PROJECT.md L58/L85)."
    HIT=1
  fi
fi

# ---- B) Embedded-DB files anywhere in the tree ----
# Exclude .git, node_modules, .next, .pnpm-store from the walk so the gate is
# fast and never trips on legitimate dependency-internal fixtures.
FILES=$(find . \
  -not -path './.git' -not -path './.git/*' \
  -not -path './node_modules' -not -path './node_modules/*' \
  -not -path './.next' -not -path './.next/*' \
  -not -path './.pnpm-store' -not -path './.pnpm-store/*' \
  \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name 'tracker-*.db' \) \
  -print 2>/dev/null || true)

if [ -n "$FILES" ]; then
  while IFS= read -r f; do
    echo "::error file=${f}::Embedded database file detected. *.db / *.sqlite / tracker-*.db are banned (see CLAUDE.md 'Embedded-DB Anti-Pattern')."
  done <<< "$FILES"
  HIT=1
fi

if [ "$HIT" -eq 1 ]; then
  exit 1
fi

echo "check-no-embedded-db: OK (no embedded-DB packages or files detected)"
exit 0
