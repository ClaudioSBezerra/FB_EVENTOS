---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 07
subsystem: dashboards + occupancy + financeiro
tags: [dashboard, konva, read-only, aggregates, financial, server-component]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "Drizzle 0.45 + postgres.js 3.4 + withTenant() boundary"
      - "RLS forced on every Phase 1 tenant-scoped table"
  - phase: 01 (this phase)
    provides:
      - "01-01: tenants table + lots/lot_categories/contracts/payments/lot_assignments/vendors all FORCE-RLS"
      - "01-03: planta-editor.tsx (extensible — Plan 01-07 reuses with `mode` prop) + computeLotPrice + formatBRL helpers"
      - "01-03: lot_assignments + active-assignment partial UNIQUE — used by getEventLotsForDashboard LEFT JOIN"
      - "01-04: vendors with status FSM + appPool+SET LOCAL fixture pattern (reused for payments insert helper)"
      - "01-06: payments.status='paid' + payments.amount_brl_cents — source of truth for recebido"
provides:
  - "tenants.platform_commission_pct numeric(5,4) NOT NULL DEFAULT 0.0500 (Migration 0016)"
  - "src/lib/actions/dashboard.ts: three pure-helper + thin-action pairs (getEventOccupancy, getEventFinancials, getEventLotsForDashboard) — Server Components consume directly inside withTenant()"
  - "src/lib/actions/dashboard.ts: getLotColorForStatus(status) — single source of truth for status → hex mapping (available=#10B981, reserved=#F59E0B, sold=#EF4444)"
  - "src/lib/validators/dashboard.ts: dashboardEventScopeSchema (uuid eventId)"
  - "src/components/eventos/planta-editor.tsx: extended with `mode: 'editor' | 'dashboard'` prop + dashboardLots map + inline DashboardLotPopover sub-component (avoids adding @radix-ui/react-popover)"
  - "src/components/dashboard/{occupancy-cards,financial-cards,financial-by-vendor-table}.tsx: three presentational Server Components"
  - "src/app/[slug]/eventos/[eventId]/dashboard/page.tsx: 3-col responsive grid (planta lg:col-span-2, cards lg:col-span-1) — fetches occupancy + dashboard lots + categories via Promise.all inside one withTenant block"
  - "src/app/[slug]/eventos/[eventId]/financeiro/page.tsx: FinancialCards + FinancialByVendorTable side by side"
  - "tests/eventos/dashboard-aggregates.test.ts: 6 cases proving occupancy math (empty event, mixed status, mixed area, mixed prices, RLS isolation, soft-deleted exclusion)"
  - "tests/eventos/financial-aggregates.test.ts: 6 cases proving financial math (paid+pending sums, default commission, tenant override @ 8%, by-vendor sort + per-vendor commission, refund exclusion, RLS isolation)"
affects:
  - 01-08-notifications: dashboard pages are read-only Server Components; no SSE in Phase 1 (deferred to Phase 2 — RESEARCH §SSE+pg_notify is the documented upgrade path)
  - phase-2: real-time updates would replace the Server-Component fetch with TanStack Query subscribed to a `/api/events/[eventId]/occupancy/stream` SSE route hooked to `pg_notify('occupancy_changed', tenant_id::text)` on payments/lots UPDATE
  - phase-2: lot-detail popover gets richer (contract status + signing link + payment status + due date) once those become per-lot first-class

# Tech tracking
tech-stack:
  added:
    - "tenants.platform_commission_pct column (operational config, NOT PII)"
  patterns:
    - "Pure-helper + thin-action split (Phase 1 invariant — established in Plans 01-03 → 01-06): tests drive `*InTenant(db, ..)` helpers directly inside withTenant; the next-safe-action wrapper just delegates"
    - "`db.execute<RowShape>(sql\`...\`)` with explicit `Array.from(rows as Iterable<...>)`: postgres-js result is iterable but Drizzle's PgRaw typing doesn't narrow — Array.from + type assertion gives runtime safety AND type guidance"
    - "GROUP BY status + FILTER + COALESCE pattern in raw SQL via sql template tags — one round-trip per dashboard read, no N+1"
    - "Inline popover sub-component instead of @radix-ui/react-popover: matches the project's minimal-shadcn style (Plan 01-03's lot-assignment-dialog uses the same pattern). Keeps the dependency tree narrow until v2 needs more dialog primitives"
    - "PlantaEditor `mode` prop discriminant: a single client component handles both editor + dashboard rendering. Dashboard mode disables draggable + click handler routes to popover; editor mode is unchanged. Tests prove zero editor regression."

# Key files
key-files:
  created:
    - "src/db/migrations/0016_tenant_platform_commission.sql"
    - "src/lib/actions/dashboard.ts"
    - "src/lib/validators/dashboard.ts"
    - "src/components/dashboard/occupancy-cards.tsx"
    - "src/components/dashboard/financial-cards.tsx"
    - "src/components/dashboard/financial-by-vendor-table.tsx"
    - "src/app/[slug]/eventos/[eventId]/dashboard/page.tsx"
    - "src/app/[slug]/eventos/[eventId]/financeiro/page.tsx"
    - "tests/eventos/dashboard-aggregates.test.ts"
    - "tests/eventos/financial-aggregates.test.ts"
  modified:
    - "src/db/schema/tenants.ts (added platformCommissionPct column)"
    - "src/db/migrations/meta/_journal.json (new 0016 entry)"
    - "src/components/eventos/planta-editor.tsx (added mode + dashboardLots props + DashboardLotPopover)"
    - "src/app/[slug]/eventos/[eventId]/page.tsx (added Dashboard / Financeiro / Categorias nav buttons)"

# Decisions
decisions:
  - "Migration renumbered from PLAN.md's '0013' → '0016'. Plans 01-05 (0013_contract_templates_seed + 0014_zapsign_webhook_tenant_lookup) and 01-06 (0015_pagarme_webhook_tenant_lookup) already consumed three slots. 0016 is the next available index. The PLAN.md note explicitly warned this would happen."
  - "Status → color contract lives in `src/lib/actions/dashboard.ts::getLotColorForStatus`. Single source of truth; the PlantaEditor dashboard mode reads `colorFill` / `colorStroke` directly from `dashboardLots` map (computed server-side), so a future UX redesign updates colors in ONE place. Editor mode (category color) is unchanged — no regression."
  - "Popover is an inline sub-component instead of installing @radix-ui/react-popover. The popover is single-purpose (lot details on click), positions itself relative to the canvas Stage, and stays inside the same client component. Matches Plan 01-03's lot-assignment-dialog inline-picker approach. Phase 4 will install Radix Dialog/Popover wholesale when the vendor combobox + planta-overlay dialogs land."
  - "Financial by-vendor table is a plain semantic <table> — no shadcn `table` install. Same rationale: minimal-shadcn, accessible markup, no Radix dep needed for a static read-only render."
  - "Dashboard page uses `Promise.all` for the four reads (event, occupancy, dashboardLots, lots, categories). All four happen inside the SAME withTenant() transaction so RLS holds and the database round-trips are parallelized. Plan 01-08's notification skeleton may need the same shape for cross-table aggregates."
  - "Server Components only (no TanStack Query) for Phase 1. Real-time SSE via pg_notify is the documented Phase 2 upgrade path — RESEARCH §A11 already specifies the route handler shape."
  - "Tests drive `*InTenant` helpers directly inside `withTenant`. The next-safe-action wrappers are tested transitively via the page-render path; we don't double-test the wrapper boilerplate. Same approach as every other Phase 1 plan."

# Metrics
metrics:
  start: "2026-06-14T14:30:00-03:00"
  end: "2026-06-14T14:55:00-03:00"
  duration_minutes: 25
  tasks_completed: 2
  files_created: 10
  files_modified: 4
  tests_added: 12
  total_tests_passing: 169
  baseline_tests: 157
  requirements_addressed: [ORG-13, ORG-14]
---

# Phase 01 Plan 07: Dashboards (Ocupação + Financeiro) Summary

**Vertical slice 6 of Phase 1** — organizadora opens `/[slug]/eventos/[eventId]/dashboard` and sees the planta colored by occupancy + stats cards (% vendido por R$ / m² / qty); switches to `/financeiro` and sees recebido / a receber / comissão + by-fornecedor table. Delivers **ORG-13** (occupancy dashboard) and **ORG-14** (financial dashboard).

## Verification

### Tasks completed (2/2)

#### Task 1 — Tenant platform commission column + dashboard Server Actions

Committed: `bf65a4c` `feat(01-07): platform commission column + dashboard aggregates Server Actions + tests`

- **Schema change**: `tenants.platform_commission_pct numeric(5,4) NOT NULL DEFAULT 0.0500` via Migration 0016. NOT PII (operational config; no `COMMENT ON COLUMN 'PII:'` annotation).
- **`src/lib/actions/dashboard.ts`** — three pure-helper + thin-action pairs:
  - **`getEventOccupancyInTenant`** — single GROUP BY query: `lots.status`, `COUNT(*)`, `SUM(area_m2)`, `SUM(base_fixed + area × per_sqm_rate)`. Returns `totalLots / byStatus / percent{Lots,M2,Revenue}Sold / totalRevenueBRL / soldRevenueBRL / totalAreaM2 / soldAreaM2`. Soft-deleted lots excluded via `lots.deleted_at IS NULL` predicate.
  - **`getEventFinancialsInTenant`** — JOIN payments → contracts → lots / vendors, GROUP BY vendor. Uses `FILTER (WHERE status='paid'|'pending')` to compute totals in ONE query. Refunded + failed exclude themselves naturally. Looks up tenant.platform_commission_pct (no-RLS lookup table) for the commission rate. Returns `recebidoBRL / aReceberBRL / comissaoBRL / commissionRate / byVendor[]` sorted by `totalPaidBRL DESC` with localeCompare pt-BR tiebreak.
  - **`getEventLotsForDashboardInTenant`** — Drizzle query builder; LEFT JOIN lot_assignments (active only) → LEFT JOIN vendors. Returns `id / code / status / geometry / categoryId / categoryName / areaM2 / priceBRL / colorFill / colorStroke / vendorId / vendorLegalName`.
  - **`getLotColorForStatus(status)`** — single status → `{fill, stroke}` hex mapping. Exported so Plan 01-08 / Phase 2 SSE consumers stay in sync.
- **12 tests** in two files (6 + 6):
  - `tests/eventos/dashboard-aggregates.test.ts` — empty event (0/0/0), mixed status (1 av + 1 res + 2 sold → 50%), mixed area (50 m² sold of 100 → 50% m² but 33.3% by count), mixed prices via categories (premium 2000 + standard 1000 → 66.7% sold), cross-tenant isolation (tenant B sees 0), soft-deleted lots excluded.
  - `tests/eventos/financial-aggregates.test.ts` — recebido + aReceber math, default 5% commission, tenant override @ 8%, by-vendor aggregation sorted desc + per-vendor commission, refund/failed exclusion, cross-tenant isolation.

#### Task 2 — Konva read-only dashboard mode + occupancy/financial pages

Committed: `82a940c` `feat(01-07): Konva read-only dashboard mode + occupancy + financial pages`

- **`src/components/eventos/planta-editor.tsx`** extended:
  - New props: `mode: 'editor' | 'dashboard'` (default `'editor'`) + `dashboardLots: Record<string, DashboardLotMeta>`
  - Dashboard mode: no Konva.Transformer, lots not draggable, colors from `dashboardLots[id].colorFill/colorStroke`, click opens absolute-positioned `<DashboardLotPopover>` showing lot code + category + status + price + assigned vendor.
  - Editor mode: completely unchanged behavior — Plans 01-03 tests still GREEN (verified by full suite re-run).
  - Inline `DashboardLotPopover` sub-component (no Radix dependency). Position clamped so popover never escapes the 1200×800 stage; close button + auto-close on Stage repaint.
- **`src/components/dashboard/occupancy-cards.tsx`** — 2x2 grid of shadcn Cards: lotes vendidos / área vendida / receita vendida / status breakdown (with the same legend the planta uses).
- **`src/components/dashboard/financial-cards.tsx`** — 3-col grid: recebido (emerald) / a receber (amber) / comissão (slate, shows commission rate for transparency).
- **`src/components/dashboard/financial-by-vendor-table.tsx`** — semantic `<table>` with thead/tbody + empty-state.
- **`src/app/[slug]/eventos/[eventId]/dashboard/page.tsx`** — Server Component:
  - Auth + tenant slug match (mirrors planta page).
  - One `withTenant()` block does `Promise.all` over event, occupancy, dashboard lots, lots (for editor), categories.
  - Builds `dashboardLotsMap` from `dashboardLots[]` → `Record<string, DashboardLotMeta>`.
  - Renders 3-col responsive grid: planta `lg:col-span-2`, cards `lg:col-span-1`.
- **`src/app/[slug]/eventos/[eventId]/financeiro/page.tsx`** — Server Component; renders `<FinancialCards>` + a wrapped `<FinancialByVendorTable>`.
- **Event home page nav** updated to add Dashboard / Financeiro / Categorias buttons (Plan 01-02 surface).

### Quality gates

- `pnpm test` → **38 files, 169/169 tests passing** (baseline 157 + 12 new — zero regression).
- `pnpm tsc --noEmit` → 0 errors.
- `pnpm lint` → 0 errors (3 pre-existing warnings unrelated to Plan 01-07).
- `pnpm check:all` → all four CI gates GREEN (no embedded DB, no legacy names, no drizzle-push, Next.js ~15.5.x).
- `pnpm db:migrate` applied 0016 idempotently. Verified: `SELECT platform_commission_pct FROM tenants` returns `0.0500` for existing rows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug fix] Migration numbering**
- **Found during:** Task 1 setup (pre-flight numbering check)
- **Issue:** PLAN.md targeted `0013_tenant_platform_commission.sql` but slots 0013/0014/0015 were already consumed by Plans 01-05 / 01-06 (contract templates seed + ZapSign webhook lookup + Pagar.me webhook lookup). The PLAN.md prompt explicitly warned about this.
- **Fix:** Used the next available slot, `0016_tenant_platform_commission.sql`, and added the matching `_journal.json` entry.
- **Files modified:** `src/db/migrations/0016_tenant_platform_commission.sql`, `src/db/migrations/meta/_journal.json`
- **Commit:** `bf65a4c`

**2. [Rule 1 — DX choice] Replace shadcn Popover with inline component**
- **Found during:** Task 2 planning (component dependency check)
- **Issue:** PLAN.md said to install `@radix-ui/react-popover` via `shadcn add popover`. The project's Plan 01-03 lot-assignment-dialog already established the pattern of inline pickers without adding new Radix dependencies; the dashboard popover is single-purpose (lot details on click) and lives entirely inside the canvas component.
- **Fix:** Inlined `DashboardLotPopover` as a sub-component inside `planta-editor.tsx`. Same accessibility (close button, aria-label), no new dependency, narrower bundle.
- **Files modified:** `src/components/eventos/planta-editor.tsx` (inline sub-component)
- **Commit:** `82a940c`
- **Documented for future:** This decision is captured in the Decisions section above — Phase 4 will install Radix Dialog/Popover wholesale when the vendor combobox + planta-overlay dialogs need them.

**3. [Rule 1 — DX choice] Replace shadcn Table with semantic `<table>`**
- **Found during:** Task 2 planning
- **Issue:** PLAN.md said to install shadcn `table`. Same minimal-shadcn rationale as the popover.
- **Fix:** Plain semantic `<table>` with Tailwind utility classes. Accessible, no new dep.
- **Files modified:** `src/components/dashboard/financial-by-vendor-table.tsx`
- **Commit:** `82a940c`

### Auth gates

None — Plan 01-07 reads existing fixtures; no third-party API calls (Pagar.me / ZapSign already wired by 01-05/01-06).

## Issues encountered

- **`db.execute<RowShape>` return type ambiguity.** `db.execute()` returns the underlying postgres-js result, which is iterable at runtime but typed loosely. Resolved by `Array.from(rows as Iterable<RowShape>)` — works across both array-shaped and result-shaped returns.
- **Numeric coming back as string.** `postgres@3.4.x` returns `numeric` columns as strings by default. `getEventFinancialsInTenant` uses `::text` cast in the raw SQL + `Number(...)` at the JS boundary; matches Plan 01-03's `computeLotPrice` approach.

## Carryover for next plan (01-08 Notifications + walking-skeleton extension)

- Dashboard pages are pure Server Components — Plan 01-08's notifications must keep them server-rendered. SSE updates are deferred to Phase 2.
- `getEventFinancialsInTenant` produces `byVendor[]` with `comissaoBRL` per row — the notifications template "pagamento_recebido" can reuse this shape to render a thank-you email with the commission breakdown if needed.
- `getLotColorForStatus` is the single source of status → color mapping. The Phase 2 SSE channel will fan out lot UPDATEs as `{lotId, newStatus}`; the client just calls `getLotColorForStatus(newStatus)` and re-fills the polygon — no extra metadata needed.
- Migration slot count: 0016 used. Next available is 0017 for Plan 01-08.

## Self-Check: PASSED

- All 10 created files exist on disk:
  - `src/db/migrations/0016_tenant_platform_commission.sql` ✓
  - `src/lib/actions/dashboard.ts` ✓
  - `src/lib/validators/dashboard.ts` ✓
  - `src/components/dashboard/occupancy-cards.tsx` ✓
  - `src/components/dashboard/financial-cards.tsx` ✓
  - `src/components/dashboard/financial-by-vendor-table.tsx` ✓
  - `src/app/[slug]/eventos/[eventId]/dashboard/page.tsx` ✓
  - `src/app/[slug]/eventos/[eventId]/financeiro/page.tsx` ✓
  - `tests/eventos/dashboard-aggregates.test.ts` ✓
  - `tests/eventos/financial-aggregates.test.ts` ✓
- Both task commits reachable: `bf65a4c` + `82a940c` via `git log`.
- 169/169 tests passing — 157 baseline + 12 new (zero regression).
- 2 ORG requirements addressed: ORG-13 (occupancy dashboard) + ORG-14 (financial dashboard).

---
*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Completed: 2026-06-14*
