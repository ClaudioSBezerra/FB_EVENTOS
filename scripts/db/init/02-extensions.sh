#!/bin/bash
# FB_EVENTOS — required Postgres extensions (auto-runs after 01-roles.sh).
#
# pgcrypto    — gen_random_uuid() default for UUID PKs (Plan 03 + all schemas)
# pg_trgm     — trigram indexes for ILIKE search (Phase 4 marketplace; harmless
#               to enable now)

set -euo pipefail

echo "[02-extensions.sh] Installing pgcrypto + pg_trgm..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname fb_eventos_dev <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL

echo "[02-extensions.sh] OK"
