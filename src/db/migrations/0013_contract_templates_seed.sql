-- FB_EVENTOS — Migration 0013: seed fornecedor-stand-v1 contract template +
-- zapsign_documents unique constraint (Phase 1, Plan 01-05).
--
-- HAND-WRITTEN — two concerns bundled because they both support the
-- contracts-PDF-ZapSign vertical (01-05):
--
--   1. Seed the single `fornecedor-stand-v1` template version row in the
--      global `contract_template_versions` lookup. D-08 contract: every
--      generated contract carries `template_version` for reproducibility;
--      the FK on contracts.template_version requires the row to exist
--      before any contract can be inserted.
--
--   2. UNIQUE constraint on zapsign_documents(zapsign_id). The webhook
--      handler uses zapsign_id as the natural dedup key — duplicate
--      deliveries from ZapSign must be idempotent (no double audit, no
--      double email enqueue). The UNIQUE here is the storage-layer guard;
--      the handler's UPSERT path appends to payload_callback on conflict.
--
-- TENANT LOOKUP FOR WEBHOOK:
-- The Route Handler at /api/webhooks/zapsign resolves tenant_id BEFORE
-- entering withTenant() by issuing a single SELECT through migratorPool
-- (a BYPASSRLS path). We deliberately do NOT add a SECURITY DEFINER
-- function here because (a) the surface is identical (caller already
-- knows zapsign_id, lookup returns tenant_id), (b) keeping the function
-- catalog small reduces ownership-transfer permission churn (PG 18
-- tightens ALTER FUNCTION OWNER schema-CREATE checks). migratorPool is
-- already used elsewhere for the same "no session yet" lookups (Plan 01-01
-- factory inserts, audit_log reads, BrasilAPI cache writes).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Seed the global fornecedor-stand-v1 template row
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO "contract_template_versions" (version, description, file_path)
VALUES (
  'fornecedor-stand-v1',
  'Contrato de cessão de espaço — Fornecedor / Stand (v1, pt-BR, Helvetica)',
  'fornecedor-stand-v1.tsx'
)
ON CONFLICT (version) DO NOTHING;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- 2. UNIQUE on zapsign_documents(zapsign_id) — natural webhook dedup key
-- ────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "zapsign_documents_zapsign_id_unique"
  ON "zapsign_documents" ("zapsign_id");
--> statement-breakpoint
