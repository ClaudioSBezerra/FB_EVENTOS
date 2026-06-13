---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 07
type: execute
wave: 5
depends_on:
  - "01-03"
  - "01-06"
autonomous: true
requirements:
  - ORG-13
  - ORG-14
requirements_addressed:
  - ORG-13
  - ORG-14
tags:
  - dashboard
  - konva
  - read-only
  - aggregates
  - financial
must_haves:
  truths:
    - "Occupancy dashboard at /[slug]/eventos/[eventId]/dashboard renders the Konva planta in read-only mode (mode='dashboard'); lots colored by status: available=green, reserved=yellow, sold=red; PlantaEditor component is reused with prop mode='dashboard' (read-only, no transformer)"
    - "Stats cards lado-a-lado show: total lots, % vendido em quantidade, % vendido em m², % vendido em R$, valor recebido R$, valor a receber R$, comissão da plataforma calculada (configurable via tenant.platform_commission_pct column)"
    - "Financial dashboard at /[slug]/eventos/[eventId]/financeiro shows: recebido (payments.status=paid), a receber (payments.status=pending), comissão = sum(paid) × tenant.platform_commission_pct, by-fornecedor table"
    - "All aggregates computed in Server Actions inside withTenant — Server Components consume via direct call, not via TanStack Query (Phase 1 sticks to Server Components; real-time SSE is deferred to Phase 2)"
    - "Tenant isolation proven by integration test — tenant B never sees tenant A's aggregates"
files_modified:
  - src/app/[slug]/eventos/[eventId]/dashboard/page.tsx
  - src/app/[slug]/eventos/[eventId]/financeiro/page.tsx
  - src/components/eventos/planta-editor.tsx
  - src/components/dashboard/occupancy-cards.tsx
  - src/components/dashboard/financial-cards.tsx
  - src/components/dashboard/financial-by-vendor-table.tsx
  - src/lib/actions/dashboard.ts
  - src/db/schema/tenants.ts
  - src/db/migrations/0013_tenant_platform_commission.sql
  - tests/eventos/dashboard-aggregates.test.ts
  - tests/eventos/financial-aggregates.test.ts
---

<objective>
Vertical slice 6 of Phase 1. Organizadora opens `/[slug]/eventos/[eventId]/dashboard` and sees the planta colored by occupancy + stats cards (% vendido R$/m²/qty); switches to `/financeiro` and sees recebido / a receber / comissão + by-vendor table. Delivers ORG-13, ORG-14.
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md (D-12 dashboard mapa + cards lado-a-lado)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Dashboard aggregates SQL + §Konva read-only mode
- src/components/eventos/planta-editor.tsx (Plan 01-03 — extend with mode prop)
- src/db/schema/{tenants,lots,payments}.ts
</files_to_read>

<task id="1" name="Tenant platform commission column + dashboard Server Actions">
<action>
Add column to tenants in `src/db/schema/tenants.ts`: `platform_commission_pct numeric(5,4) not null default 0.0500` (5% default; range 0..1). Update Drizzle schema export.

Migration `src/db/migrations/0013_tenant_platform_commission.sql`:
```sql
ALTER TABLE tenants ADD COLUMN platform_commission_pct numeric(5,4) NOT NULL DEFAULT 0.0500;
COMMENT ON COLUMN tenants.platform_commission_pct IS 'Platform commission rate (0..1) applied to paid charges; default 5%';
```

Create `src/lib/actions/dashboard.ts` — withTenantAction (Server Actions, used by Server Components):
- `getEventOccupancy({eventId})` — returns `{ totalLots, byStatus: {available, reserved, sold}, percentLotsSold, percentM2Sold, percentRevenueSold, totalRevenueR$ }`. SQL: SELECT lot.status, count(*), sum(area_m2), sum(price_brl) GROUP BY status. Price computed as `category.base_fixed + lot.area_m2 * category.per_sqm_rate` via JOIN.
- `getEventFinancials({eventId})` — returns `{ recebidoR$, aReceberR$, comissaoR$, byVendor: [{vendorId, vendorName, totalPaid, totalPending, comissao}] }`. SQL: SELECT payment.status, sum(amount_brl_cents)/100 GROUP BY status from payments joined to contracts joined to lots in this event. Commission = sum_paid × tenant.platform_commission_pct.
- `getEventLotsForDashboard({eventId})` — returns lots with `{id, code, status, geometry, color_class}` mapping status → color (available='#10B981' green, reserved='#F59E0B' yellow, sold='#EF4444' red); used by Konva read-only render.

Write `tests/eventos/dashboard-aggregates.test.ts`:
1. Empty event → 0/0/0 across all percentages
2. Event with 4 lots (1 available, 1 reserved, 2 sold) → percentLotsSold=50%
3. Mixed area sizes → percentM2Sold computed correctly
4. Mixed prices via categories → totalRevenueR$ matches sum
5. Tenant B sees 0 for tenant A's event
6. Soft-deleted lots excluded

Write `tests/eventos/financial-aggregates.test.ts`:
1. 2 paid + 1 pending payment → recebido + aReceber correct
2. Commission = recebido × 0.05 (default)
3. tenant with platform_commission_pct=0.08 → 8% applied
4. byVendor table aggregates per-fornecedor totals
5. Refunded payment subtracted from recebido
6. Tenant isolation

Commit: `feat(01-07): platform commission column + dashboard aggregates Server Actions + tests`
</action>
<read_first>
- src/db/schema/tenants.ts (existing columns)
- src/lib/actions/safe-action.ts
- src/lib/lots/price.ts (Plan 01-03 — computeLotPrice helper)
- src/db/migrations/0011_phase1_force_rls.sql (RLS policy pattern)
</read_first>
<acceptance_criteria>
- `pnpm test tests/eventos/dashboard-aggregates.test.ts tests/eventos/financial-aggregates.test.ts` → 12+ tests pass
- `pnpm db:migrate` applies 0013 idempotently
- `SELECT platform_commission_pct FROM tenants` returns 0.0500 for existing tenants
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
</acceptance_criteria>
</task>

<task id="2" name="Konva read-only dashboard mode + occupancy cards + financial cards + pages">
<action>
Extend `src/components/eventos/planta-editor.tsx`: add prop `mode: 'editor' | 'dashboard'`. When `mode='dashboard'`:
- No Konva.Transformer; lots not draggable
- Lots filled with status color (received via `color_class` from getEventLotsForDashboard)
- Click on lot opens a small popover (shadcn Popover) showing lot code, category, vendor (if assigned), status, price
- No toolbar (only zoom/pan)
- Background planta still rendered as in editor mode

Create `src/components/dashboard/occupancy-cards.tsx` — Server Component receives the getEventOccupancy result; renders a grid of shadcn Cards:
- "Lotes vendidos": "X de Y (Z%)"
- "Área m² vendida": "Xm² de Ym² (Z%)"
- "Receita R$": "R$ X de R$ Y (Z%)"
- Each card with subtle color matching its metric

Create `src/components/dashboard/financial-cards.tsx` — recebido / a receber / comissão.

Create `src/components/dashboard/financial-by-vendor-table.tsx` — shadcn Table (need to install via `pnpm dlx shadcn@latest add table` — verify and add to package.json) with columns: Fornecedor, Pago R$, Pendente R$, Comissão R$. Sorted by pago desc.

Pages:
- `/[slug]/eventos/[eventId]/dashboard/page.tsx` — Server Component; fetches getEventOccupancy + getEventLotsForDashboard; renders `<PlantaEditor mode='dashboard' .../>` lado-a-lado com `<OccupancyCards />` em grid 2-col responsive
- `/[slug]/eventos/[eventId]/financeiro/page.tsx` — fetches getEventFinancials; renders `<FinancialCards />` + `<FinancialByVendorTable />`

Update navigation in `/[slug]/eventos/[eventId]/page.tsx` (Plan 01-02) to include tabs: Detalhes | Planta | Categorias | Dashboard | Financeiro.

Commit: `feat(01-07): Konva read-only dashboard mode + occupancy + financial pages`
</action>
<read_first>
- src/components/eventos/planta-editor.tsx (Plan 01-03 — current implementation; add mode prop)
- src/components/ui/{card,table,popover}.tsx (verify exists; add via shadcn if missing)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Konva read-only mode
</read_first>
<acceptance_criteria>
- Manual: navigate to dashboard with mixed-status lots → planta colored correctly + cards show correct numbers
- Click on a sold lot → popover shows vendor name + price + paid amount
- Navigate to financeiro → cards + by-vendor table populated
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
- `pnpm test` all pass (no regression)
- Playwright smoke check for dashboard page in tests/e2e (optional, light)
</acceptance_criteria>
</task>

<verification>
After 2 tasks: tests green; manual smoke through both dashboard pages. Plan 01-08 (notifications + walking-skeleton extension) is the final piece — it consumes everything from 01-02 through 01-07 and writes the D-14 gate E2E.
</verification>
