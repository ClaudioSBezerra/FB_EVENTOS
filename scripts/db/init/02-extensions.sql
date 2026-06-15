-- FB_EVENTOS — required Postgres extensions (auto-runs after 01-roles.sql).
--
-- pgcrypto    — gen_random_uuid() default for UUID PKs (Plan 03 + all schemas)
-- pg_trgm     — trigram indexes for ILIKE search (Phase 4 marketplace; harmless
--               to enable now)

\c fb_eventos_dev

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
