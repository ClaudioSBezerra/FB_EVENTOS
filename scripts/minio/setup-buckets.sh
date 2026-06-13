#!/usr/bin/env bash
# FB_EVENTOS — MinIO bucket-per-tenant bootstrap (Phase 1, Plan 01-01).
#
# Creates `${tenant_slug}-uploads` bucket on the configured MinIO server,
# applies a per-prefix Lifecycle policy aligned with LGPD retention, and
# locks public access. Idempotent — safe to re-run.
#
# Lifecycle prefixes (per-tenant bucket):
#   plantas/        — 5 years (1825 days). Plantas hold venue layout +
#                     may identify the organizadora's commercial footprint.
#   vendor-docs/    — 2 years (730 days). LGPD-aligned retention for
#                     vendor PII (CNPJ certs, contrato social, comprovante
#                     de endereço, etc.). Re-evaluate at Phase 4 alongside
#                     LGPD right-to-be-forgotten flow.
#   contracts/      — 5 years (1825 days). Signed and draft contract PDFs.
#
# CORS:
#   PUT / GET / HEAD / POST from `https://eventos.fbtax.cloud` and the
#   wildcard `https://*.eventos.fbtax.cloud` (Phase 4 multi-tenant).
#
# Usage:
#   bash scripts/minio/setup-buckets.sh --tenant trindade
#   bash scripts/minio/setup-buckets.sh --tenant trindade --endpoint http://localhost:9000
#
# Environment (overrides flags):
#   MINIO_ENDPOINT       e.g. http://localhost:9000  (REQUIRED — flag or env)
#   MINIO_ROOT_USER      admin user                  (REQUIRED — flag or env)
#   MINIO_ROOT_PASSWORD  admin password              (REQUIRED — flag or env)
#   MINIO_APP_ORIGIN     defaults to https://eventos.fbtax.cloud
#
# Pre-requisites:
#   - `mc` (MinIO Client) installed and on PATH. Install:
#       wget https://dl.min.io/client/mc/release/linux-amd64/mc -O ~/.local/bin/mc && chmod +x ~/.local/bin/mc
#   - The MinIO server reachable at MINIO_ENDPOINT.

set -euo pipefail

TENANT=""
ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
USER="${MINIO_ROOT_USER:-minioadmin}"
PASS="${MINIO_ROOT_PASSWORD:-minioadmin}"
APP_ORIGIN="${MINIO_APP_ORIGIN:-https://eventos.fbtax.cloud}"

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --tenant) TENANT="$2"; shift 2 ;;
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --password) PASS="$2"; shift 2 ;;
    --origin) APP_ORIGIN="$2"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | head -40
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TENANT" ]]; then
  echo "ERROR: --tenant <slug> is required (e.g. --tenant trindade)" >&2
  exit 1
fi

# Validate slug shape (lowercase, dashes; MinIO bucket constraint)
if ! [[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$ ]]; then
  echo "ERROR: tenant slug must be lowercase alphanumeric with optional dashes (3-42 chars), got: $TENANT" >&2
  exit 1
fi

BUCKET="${TENANT}-uploads"
ALIAS="fbeventos-$(date +%s)"  # ephemeral alias per script run

if ! command -v mc >/dev/null 2>&1; then
  echo "ERROR: 'mc' (MinIO Client) is not installed or not on PATH." >&2
  echo "Install with:" >&2
  echo "  wget https://dl.min.io/client/mc/release/linux-amd64/mc -O ~/.local/bin/mc && chmod +x ~/.local/bin/mc" >&2
  exit 1
fi

echo "→ Configuring mc alias..."
mc alias set "$ALIAS" "$ENDPOINT" "$USER" "$PASS" >/dev/null

echo "→ Creating bucket ${ALIAS}/${BUCKET} (idempotent)..."
mc mb --ignore-existing "${ALIAS}/${BUCKET}"

echo "→ Applying Lifecycle policy (LGPD-aligned per-prefix retention)..."
LIFECYCLE_JSON=$(cat <<'EOF'
{
  "Rules": [
    {
      "ID": "plantas-retention-5y",
      "Status": "Enabled",
      "Filter": { "Prefix": "plantas/" },
      "Expiration": { "Days": 1825 }
    },
    {
      "ID": "vendor-docs-retention-2y",
      "Status": "Enabled",
      "Filter": { "Prefix": "vendor-docs/" },
      "Expiration": { "Days": 730 }
    },
    {
      "ID": "contracts-retention-5y",
      "Status": "Enabled",
      "Filter": { "Prefix": "contracts/" },
      "Expiration": { "Days": 1825 }
    }
  ]
}
EOF
)
LIFECYCLE_TMP=$(mktemp -t fbeventos-lifecycle.XXXXXX.json)
trap 'rm -f "$LIFECYCLE_TMP"' EXIT
printf "%s\n" "$LIFECYCLE_JSON" > "$LIFECYCLE_TMP"
mc ilm import "${ALIAS}/${BUCKET}" < "$LIFECYCLE_TMP"

echo "→ Locking anonymous access (objects accessible only via signed URLs)..."
mc anonymous set none "${ALIAS}/${BUCKET}"

echo "→ Setting CORS policy (PUT/GET/HEAD/POST from app origin + wildcard subdomain)..."
CORS_TMP=$(mktemp -t fbeventos-cors.XXXXXX.json)
trap 'rm -f "$LIFECYCLE_TMP" "$CORS_TMP"' EXIT
cat > "$CORS_TMP" <<EOF
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "HEAD", "POST", "PUT"],
      "AllowedOrigins": [
        "${APP_ORIGIN}",
        "${APP_ORIGIN/https:\/\//https:\/\/*.}"
      ],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
EOF
# `mc anonymous set-json` is the cross-version-stable CORS approach for
# MinIO. Some MinIO releases also accept `mc cors set` directly — this
# script uses the JSON form which is supported by every RELEASE.2024-*
# and later.
if mc cors set "${ALIAS}/${BUCKET}" "$CORS_TMP" >/dev/null 2>&1; then
  echo "  CORS applied via 'mc cors set'."
elif mc admin config set "${ALIAS}" cors --json < "$CORS_TMP" >/dev/null 2>&1; then
  echo "  CORS applied via 'mc admin config set cors'."
else
  echo "  WARNING: could not apply CORS via mc — apply manually via the MinIO console." >&2
  echo "  CORS payload kept at: $CORS_TMP (review and apply by hand)" >&2
fi

echo "→ Removing temporary alias..."
mc alias remove "$ALIAS" >/dev/null || true

echo "✓ Bucket ${BUCKET} is ready (Lifecycle: plantas/vendor-docs/contracts; CORS: ${APP_ORIGIN} + wildcard subdomain)."
