---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 1 paused at plan 01-04 Task 1 partial (CNPJ validators + cache schema committed; BrasilAPI action + tests pending)
last_updated: "2026-06-14T14:10:26.578Z"
last_activity: 2026-06-14
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 15
  completed_plans: 12
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-11)

**Core value:** Habilitar a organizadora a vender espaços de eventos a fornecedores de forma self-service, com planta visual e pagamento integrado — sem precisar de WhatsApp/Excel/contratos em papel.
**Current focus:** Phase 01 — Organizadora End-to-End (Piloto Festa de Trindade)

## Current Position

Phase: 01 (Organizadora End-to-End (Piloto Festa de Trindade)) — EXECUTING
Plan: 5 of 8
Status: Ready to execute
Last activity: 2026-06-14

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 0. Foundation | 0/TBD | — | — |
| 1. Organizadora | 0/TBD | — | — |
| 2. Fornecedor | 0/TBD | — | — |
| 3. Prestador | 0/TBD | — | — |
| 4. Público | 0/TBD | — | — |

**Recent Trend:**

- Last 5 plans: (none)
- Trend: N/A (project just initialized)

*Updated after each plan completion*
| Phase 00 P02 | 60min | 3 tasks | 9 files |
| Phase 00 P03 | 75min | 3 tasks | 24 files |
| Phase 00 P05 | 45min | 3 tasks | 13 files |
| Phase 00 P06 | 60min | 3 tasks | 20 files |
| Phase 01 P01 | 135min | 3 tasks | 28 files |
| Phase 01 P02 | 55min | 2 tasks | 13 files |
| Phase 01 P04 | 80 | 3 tasks | 18 files |
| Phase 01 P05 | 145 | 3 tasks | 35 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Vertical MVP per persona (Organizadora → Fornecedor → Prestador → Público)
- Stack locked: Next.js 15 + TypeScript + Drizzle + Postgres 16 + Better Auth + Konva.js + Pagar.me v5
- Embedded-DB banned (contratual): PostgreSQL é o único source-of-truth; Graphile-Worker substitui BullMQ/Redis para fila
- Multi-tenant via RLS FORCED + role `fb_eventos_app` SEM `BYPASSRLS` desde a Phase 0
- LGPD baseline (consent + audit + PII tags) na Phase 1; direito ao esquecimento completo na Phase 4
- Pilot event: Festa de Trindade/GO (≤3 meses) — define escopo de Phase 1
- [Phase 00]: Plan 02: six PR-blocking CI jobs + tag-only build-and-push + dependabot/CODEOWNERS/CONTRIBUTING — every contractual anti-pitfall is now a structural gate
- [Phase 00]: Plan 02 established 'gate self-trip immunity' pattern after three Rule 1 fixes (drizzle-push, legacy-names, floating-tag) — gates must use --include filters and structural anchors so their own documentation cannot trip them
- [Phase 00]: Plan 03: RLS contract enforced at catalog layer — two-role model (fb_eventos_app NOBYPASSRLS + fb_eventos_migrator), FORCE RLS on session/organization/member/invitation, withTenant() with SET LOCAL semantics, 10/10 contract tests GREEN — T-0-01 mitigated at the deepest layer; multi-tenant promise enforced by Postgres catalog and asserted on every CI run
- [Phase 00]: Plan 03 established '.enableRLS()' pattern (drizzle 0.45.2 API; .withRLS rename pending future bump) and 'fixtures via appPool + SET LOCAL' pattern (production-realistic test writes — RLS misconfig surfaces in test setup, not in prod)
- [Phase ?]: [Phase 00]: Plan 05: LGPD baseline schema landed — audit_log append-only via REVOKE UPDATE/DELETE + FORCE RLS; consent_records extended with versioned consent_text snapshot + nullable tenant_id for pre-signup; 12 PII columns inventoried via COMMENT ON COLUMN 'PII:'; soft-delete helpers + consent banner + docs/LGPD.md placeholder; 4 LGPD integration tests (10 cases) prove the contract including the load-bearing singleton-db-misuse rejection (pg 22P02)
- [Phase ?]: [Phase 00]: Plan 05 established 'PII: COMMENT ON COLUMN' inventory pattern + 'recordAudit(db, opts) singleton-db rejected loudly' pattern — every PII column in Phase 1+ MUST carry a 'PII:' prefixed comment; recordAudit signature stays explicit (no AsyncLocalStorage in Phase 0) so the call site documents which transaction it lands in
- [Phase 00]: Plan 06: Pino structured logger + Sentry server/client/edge configs with the load-bearing file names (Pitfall 5 mitigated); Graphile-Worker 0.16.6 wired with transactional outbox `enqueueJob(tx, ...)`; add_job SQL signature probed live (RESEARCH A1 mitigated); RLS policies installed on graphile_worker.* tables (Migration 0009, discovered during test development — our NOBYPASSRLS contract would otherwise silently break the worker); `::text::json` double cast in enqueueJob defeats postgres.js's JSON-string parameter encoding; RESEARCH Pitfall 8 (Worker doesn't inherit app.current_tenant_id) now structurally observable via worker-without-with-tenant.test.ts. ADR-0001 ratifies Graphile-Worker over pg-boss with Phase 4 revisit criteria. 59/59 tests GREEN.
- [Phase 00]: Plan 06 established three patterns: (1) 'Probe test for SQL function signatures' — boot the dependency briefly, read pg_proc, invoke the named-arg form; catches drift BEFORE downstream code depends on it. (2) 'Outbox via enqueueJob(tx, ...)' — Phase 2 Server Actions get atomic business-write + side-effect-enqueue for free. (3) '::text::json double cast' for postgres.js → graphile-worker payload integrity — without it, payloads are stored as JSON strings (json_typeof = 'string') and the task handler receives a string instead of an object.
- [Phase ?]: [Phase 01]: Plan 01-01: 12 RLS-FORCED domain tables + Wave 0 test infra + setActiveOrganization → session.tenant_id wiring via Better Auth databaseHooks. Pattern: SECURITY DEFINER tenant-context-resolution function owned by NOLOGIN+BYPASSRLS fb_eventos_sysreader role
- [Phase ?]: [Phase 01]: Plan 01-01 established Wave 0 test pattern — MSW server with happy-path defaults + per-test overrides for ZapSign/Pagar.me/BrasilAPI/Resend, in-memory MockMinIOClient matching minio-js v8 surface, 3 raw-SQL factories bypassing FORCE RLS via migratorPool
- [Phase ?]: [Phase 01]: Plan 01-04: D-16 materialized — 2-layer CNPJ (cnpjSchema Layer 1 + lookupCNPJCore Layer 2 with 7-day cnpj_lookup_cache, AbortController 5s timeout, degrade-with-warning); cnpj_redacted in audit payloads; email job envelope { tenant_id, vendor_id, event, legal_name, email, reason? } pinned for 01-08 via notifications.test.ts
- [Phase ?]: [Phase 01]: Plan 01-04 established 'rawSqlFromTenantDb' pattern (extracts postgres.js TransactionSql from Drizzle TenantDb via session.client) so enqueueJob lands in the same tx as the business UPDATE — outbox pattern over a Drizzle handle; future actions wanting atomic side-effects can reuse this 1-line helper
- [Phase ?]: [Phase 01]: Plan 01-04 established 'no-RLS on global public-data cache' pattern (cnpj_lookup_cache stores Receita Federal data shared cross-tenant); COMMENT ON TABLE documents the no-RLS decision so future contributors don't 'fix' it
- [Phase ?]: [Phase 01]: Plan 01-04 established 'audit-on-every-download' pattern for LGPD compliance: mintVendorDocDownloadUrl writes audit_log row BEFORE returning URL — the audit row IS the compliance contract, not the URL itself. Cross-tenant attempts throw BEFORE recordAudit to avoid polluting victim's audit_log
- [Phase ?]: [Phase 01]: Plan 01-05: Contracts PDF + ZapSign vertical landed — @react-pdf/renderer + sequential signers + belt-and-suspenders webhook defense (Basic Auth + API re-fetch). Two new ADRs (0002 ZapSign over Clicksign; 0004 @react-pdf over Puppeteer). Two-step outbox chain pdf.generate-contract → zapsign.send-contract → email.send-status-update with per-step atomicity. Migration 0014 narrow SELECT-only RLS policy for migrator on zapsign_documents replaces a SECURITY DEFINER approach blocked by PG 18 ALTER FUNCTION OWNER schema-CREATE check. 18 new tests bring suite to 144 GREEN.

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-14T14:10:05.292Z
Stopped at: Phase 1 paused at plan 01-04 Task 1 partial (CNPJ validators + cache schema committed; BrasilAPI action + tests pending)
Resume file: None
