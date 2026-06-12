#!/usr/bin/env bash
# FB_EVENTOS — Next.js 16 drift ban (Plan 02 / RESEARCH Pitfall 1).
#
# Next.js 16 renamed `middleware.ts` → `proxy.ts` and the exported entry
# function from `middleware()` → `proxy()`. Existing `middleware.ts` files
# are silently ignored on Next 16 → tenant-routing middleware (Plan 04)
# would no-op. Pin must stay on ~15.5.x.
#
# Exit codes:
#   0 — pin matches ~15.5.x (the warranted version) OR matches another 15.x
#       that we emit a warning for (transitional acceptance)
#   1 — pin matches Next.js 16+ in any form (hard fail)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if [ ! -f package.json ]; then
  echo "check-nextjs-version: OK (no package.json yet — bootstrap phase)"
  exit 0
fi

# Read the dependencies.next value via Node — robust against trailing commas
# and quoting variations.
VERSION=$(node -e "
const pkg = require('./package.json');
const next = (pkg.dependencies && pkg.dependencies.next) || '';
process.stdout.write(next);
" 2>/dev/null || true)

if [ -z "$VERSION" ]; then
  echo "::warning::next not present in dependencies — skipping version check."
  exit 0
fi

# Hard fail: ^16, ~16, 16., >=16, >16
if echo "$VERSION" | grep -qE '^(\^|~)?16\.|^>=16|^>16'; then
  echo "::error file=package.json::Next.js 16 detected in dependencies (\`next\`: ${VERSION}). Pin to \`~15.5.x\` — Next 16 renamed middleware.ts → proxy.ts (RESEARCH Pitfall 1)."
  exit 1
fi

# Sanity warn: not on ~15.5.x (e.g. someone bumps to 15.6 or downshifts to
# 15.4). We allow transitional bumps inside the 15.5 minor and warn elsewhere.
if echo "$VERSION" | grep -qE '^(\^|~)?15\.5\.'; then
  echo "check-nextjs-version: OK (next ${VERSION} is in the warranted ~15.5.x band)"
  exit 0
fi

if echo "$VERSION" | grep -qE '^(\^|~)?15\.'; then
  echo "::warning file=package.json::next ${VERSION} is on the 15.x line but NOT ~15.5.x — the contract pins ~15.5.x (Plan 01 SUMMARY decision 1). Treat as transitional."
  exit 0
fi

echo "::warning file=package.json::Unrecognized next version spec '${VERSION}'. Expected ~15.5.x."
exit 0
