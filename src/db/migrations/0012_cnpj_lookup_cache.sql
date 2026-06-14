-- FB_EVENTOS — Migration 0012: cnpj_lookup_cache table (Phase 1, Plan 01-04 Task 1).
--
-- HAND-WRITTEN (same convention as 0011) because we need:
--   1. NO ROW LEVEL SECURITY — this is a GLOBAL cache of PUBLIC data
--      (CNPJ + razão social + endereço from Receita Federal via BrasilAPI).
--      Tenant isolation does not apply; all tenants share the cache to
--      amortize the BrasilAPI free-tier budget across the SaaS.
--   2. Explicit GRANT SELECT, INSERT to fb_eventos_app (no UPDATE — the
--      cache is write-once-then-stale; a stale row is refreshed by
--      INSERT … ON CONFLICT (cnpj) DO UPDATE in the lookup action).
--   3. An index on cached_at for periodic cleanup (Phase 4 LGPD purge job
--      may sweep rows older than 90 days even though the data itself is
--      public — keeps the table small).
--
-- WHY THIS TABLE EXISTS:
--   BrasilAPI is free + no published SLA + no published rate limit. A
--   typical pilot day (10s of new vendor registrations) is fine to call
--   directly; but a marketplace day (1000s of fornecedores onboarding for
--   Festa de Trindade) could exhaust the free tier. The 7-day cache (read
--   from `cached_at`) lets the SaaS serve hot CNPJs without re-hitting
--   BrasilAPI for every form submit.
--
-- WHY NOT CACHE FAILURES:
--   `situacao_cadastral` is volatile: an inactive CNPJ today may be active
--   tomorrow (and vice versa). Caching only ATIVA (=2) responses means
--   the next lookup on a non-ATIVA CNPJ goes back to BrasilAPI — which is
--   the desired UX. Empty 404 / 5xx / timeout responses ALSO bypass the
--   cache so the next call gets a fresh result.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Create the cache table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "cnpj_lookup_cache" (
  "cnpj" text PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "cached_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Index on cached_at for periodic cleanup queries
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "cnpj_lookup_cache_cached_at_idx"
  ON "cnpj_lookup_cache" ("cached_at");
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Grant SELECT, INSERT, UPDATE to fb_eventos_app
--    UPDATE is needed for the INSERT … ON CONFLICT (cnpj) DO UPDATE refresh
--    path. NO RLS, so the policy layer does not gate writes here.
-- ────────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON "cnpj_lookup_cache" TO fb_eventos_app;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Documentation comment — disambiguate from PII data sources
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE "cnpj_lookup_cache"
  IS 'Global (cross-tenant) cache of BrasilAPI /cnpj/v1/:cnpj responses. PUBLIC data only — no RLS. 7-day TTL applied at read time.';
--> statement-breakpoint
