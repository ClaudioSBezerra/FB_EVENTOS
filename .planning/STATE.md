# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-11)

**Core value:** Habilitar a organizadora a vender espaços de eventos a fornecedores de forma self-service, com planta visual e pagamento integrado — sem precisar de WhatsApp/Excel/contratos em papel.
**Current focus:** Phase 0: Foundation, Stack Lock & Anti-Pitfall Hardening

## Current Position

Phase: 0 of 4 (Foundation, Stack Lock & Anti-Pitfall Hardening)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-06-11 — Roadmap created (5 phases, 107/107 requirements mapped)

Progress: [░░░░░░░░░░] 0%

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

Last session: 2026-06-11 16:45
Stopped at: Roadmap created and committed; ready to plan Phase 0
Resume file: None
