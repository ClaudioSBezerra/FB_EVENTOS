#!/usr/bin/env bash
# Install the official gitleaks security scanner via the canonical install.sh.
#
# Why a script and not `pnpm add gitleaks`?
#   The npm package named "gitleaks" is NOT the Zricethezav/gitleaks scanner
#   (see RESEARCH.md "Package Legitimacy Audit"). Installing it via npm would
#   install an unrelated "custom rules" wrapper that does not scan secrets.
#
# Usage:
#   bash scripts/install-gitleaks.sh
#
# After install, ensure $HOME/.local/bin is on your $PATH:
#   echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
#   source ~/.bashrc
#   gitleaks version

set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
mkdir -p "${BIN_DIR}"

echo "[install-gitleaks] Downloading and installing gitleaks → ${BIN_DIR}"
curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/main/scripts/install.sh \
  | sh -s -- -b "${BIN_DIR}"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[install-gitleaks] Installed to ${BIN_DIR} but binary is not on PATH."
  echo "[install-gitleaks] Add this line to your shell rc file:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  exit 0
fi

gitleaks version
echo "[install-gitleaks] OK — pre-commit hook will now run gitleaks."
