"use strict";
// FB_EVENTOS — Dashboard aggregate Server Actions (Phase 1, Plan 01-07 Task 1).
//
// Three Server Actions wrapped in `withTenantAction` (consumed by Server
// Components — no TanStack Query in Phase 1; real-time via SSE is deferred
// to Phase 2):
//
//   - getEventOccupancy({eventId})       — occupancy stats (lots / m² / R$)
//   - getEventFinancials({eventId})      — financial stats (recebido / a receber
//                                           / comissão + by-vendor table)
//   - getEventLotsForDashboard({eventId})— lots + status + color_class for the
//                                           Konva read-only render
//
// PURE-HELPER / THIN-ACTION SPLIT (Phase 1 invariant):
//   Tests drive *InTenant helpers directly inside withTenant; the next-safe-
//   action wrappers just delegate. Identical pattern to Plans 01-03 / 04 / 05 / 06.
//
// RLS CONTRACT:
//   Every query goes through ctx.db (the withTenant transaction handle). The
//   lots / payments / contracts / lot_assignments / vendors tables all have
//   FORCE RLS + tenant_isolation policy — a cross-tenant eventId returns 0
//   rows, never a leak.
//
// PRICING FORMULA (ADR-0003):
//   lot.price = category.base_fixed + lot.area_m² × category.per_sqm_rate
//   Implemented identically here and in src/lib/lots/price.ts (computeLotPrice).
//
// COMMISSION FORMULA (Plan 01-07):
//   comissao_R$ = sum(paid_amount_R$) × tenant.platform_commission_pct
//   `platform_commission_pct` defaults to 5% (0.0500) per tenant; configurable.
//
// REFERENCES:
//   - 01-RESEARCH.md §Dashboard aggregates SQL + §Konva read-only mode
//   - 01-CONTEXT.md D-12 (mapa + cards lado-a-lado)
'use server';
// FB_EVENTOS — Dashboard aggregate Server Actions (Phase 1, Plan 01-07 Task 1).
//
// Three Server Actions wrapped in `withTenantAction` (consumed by Server
// Components — no TanStack Query in Phase 1; real-time via SSE is deferred
// to Phase 2):
//
//   - getEventOccupancy({eventId})       — occupancy stats (lots / m² / R$)
//   - getEventFinancials({eventId})      — financial stats (recebido / a receber
//                                           / comissão + by-vendor table)
//   - getEventLotsForDashboard({eventId})— lots + status + color_class for the
//                                           Konva read-only render
//
// PURE-HELPER / THIN-ACTION SPLIT (Phase 1 invariant):
//   Tests drive *InTenant helpers directly inside withTenant; the next-safe-
//   action wrappers just delegate. Identical pattern to Plans 01-03 / 04 / 05 / 06.
//
// RLS CONTRACT:
//   Every query goes through ctx.db (the withTenant transaction handle). The
//   lots / payments / contracts / lot_assignments / vendors tables all have
//   FORCE RLS + tenant_isolation policy — a cross-tenant eventId returns 0
//   rows, never a leak.
//
// PRICING FORMULA (ADR-0003):
//   lot.price = category.base_fixed + lot.area_m² × category.per_sqm_rate
//   Implemented identically here and in src/lib/lots/price.ts (computeLotPrice).
//
// COMMISSION FORMULA (Plan 01-07):
//   comissao_R$ = sum(paid_amount_R$) × tenant.platform_commission_pct
//   `platform_commission_pct` defaults to 5% (0.0500) per tenant; configurable.
//
// REFERENCES:
//   - 01-RESEARCH.md §Dashboard aggregates SQL + §Konva read-only mode
//   - 01-CONTEXT.md D-12 (mapa + cards lado-a-lado)
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEventLotsForDashboard = exports.getEventFinancials = exports.getEventOccupancy = void 0;
exports.getEventOccupancyInTenant = getEventOccupancyInTenant;
exports.getEventFinancialsInTenant = getEventFinancialsInTenant;
exports.getEventLotsForDashboardInTenant = getEventLotsForDashboardInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const contracts_1 = require("@/db/schema/contracts");
const lots_1 = require("@/db/schema/lots");
const payments_1 = require("@/db/schema/payments");
const tenants_1 = require("@/db/schema/tenants");
const vendors_1 = require("@/db/schema/vendors");
const safe_action_1 = require("@/lib/actions/safe-action");
const dashboard_1 = require("@/lib/validators/dashboard");
/**
 * Status → color tuple consumed by the Konva read-only render in
 * <PlantaEditor mode='dashboard' ... />. Stroke is the solid hex; the
 * fill is the same hex with the editor's standard 25%-alpha suffix ("40").
 *
 * NOT exported: Next.js Server Actions (`'use server'`) only allow async
 * function exports — sync helpers must stay module-private. Consumed only
 * by `getEventLotsForDashboardInTenant` below. If a Client Component ever
 * needs the same mapping, extract to `src/lib/lots/colors.ts` (a new
 * non-`'use server'` module) rather than re-exporting from here.
 */
function getLotColorForStatus(status) {
    switch (status) {
        case 'sold':
            return { fill: '#EF4444', stroke: '#EF4444' };
        case 'reserved':
            return { fill: '#F59E0B', stroke: '#F59E0B' };
        default:
            // available (and any unknown future status) → green default
            return { fill: '#10B981', stroke: '#10B981' };
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Pure helpers — tests drive these inside withTenant()
// ────────────────────────────────────────────────────────────────────────────
function roundPct(n) {
    return Math.round(n * 10) / 10;
}
function roundBRL(n) {
    return Math.round(n * 100) / 100;
}
/**
 * Aggregate lot occupancy + computed revenue for a single event.
 *
 * SQL: GROUP BY lots.status, summing count / area / price (base + area × rate).
 * Soft-deleted lots (lots.deleted_at IS NOT NULL) are excluded. Cross-tenant
 * eventId returns an empty group set (RLS hides the rows entirely).
 */
async function getEventOccupancyInTenant(db, input) {
    // Single GROUP BY query. We cast numerics to text in postgres.js path then
    // Number() them back — postgres.js returns numeric as string by default,
    // and SUM() over numeric is itself numeric. Using ::float8 keeps the
    // result as a JS number when postgres.js sees no scale hint.
    const rows = await db.execute((0, drizzle_orm_1.sql) `
    SELECT
      ${lots_1.lots.status} AS status,
      COUNT(*)::text AS n,
      COALESCE(SUM(${lots_1.lots.areaM2}), 0)::text AS sum_area,
      COALESCE(
        SUM(
          ${lots_1.lotCategories.baseFixed} +
          ${lots_1.lots.areaM2} * ${lots_1.lotCategories.perSqmRate}
        ),
        0
      )::text AS sum_price
    FROM ${lots_1.lots}
    JOIN ${lots_1.lotCategories} ON ${lots_1.lotCategories.id} = ${lots_1.lots.categoryId}
    WHERE ${lots_1.lots.eventId} = ${input.eventId}
      AND ${lots_1.lots.deletedAt} IS NULL
      AND ${lots_1.lotCategories.deletedAt} IS NULL
    GROUP BY ${lots_1.lots.status}
  `);
    const byStatus = { available: 0, reserved: 0, sold: 0 };
    let totalLots = 0;
    let totalAreaM2 = 0;
    let totalRevenueBRL = 0;
    let soldAreaM2 = 0;
    let soldRevenueBRL = 0;
    // db.execute returns a result-like object; for postgres-js the rows are
    // available as the iterable result itself. Use Array.from to be defensive
    // (Drizzle's PgRaw result is iterable across both array and result shapes).
    const resultRows = Array.from(rows);
    for (const r of resultRows) {
        const n = Number(r.n);
        const area = Number(r.sum_area ?? 0);
        const price = Number(r.sum_price ?? 0);
        totalLots += n;
        totalAreaM2 += area;
        totalRevenueBRL += price;
        if (r.status === 'sold') {
            soldAreaM2 += area;
            soldRevenueBRL += price;
        }
        if (r.status === 'available')
            byStatus.available = n;
        else if (r.status === 'reserved')
            byStatus.reserved = n;
        else if (r.status === 'sold')
            byStatus.sold = n;
    }
    return {
        totalLots,
        byStatus,
        percentLotsSold: totalLots === 0 ? 0 : roundPct((byStatus.sold / totalLots) * 100),
        percentM2Sold: totalAreaM2 === 0 ? 0 : roundPct((soldAreaM2 / totalAreaM2) * 100),
        percentRevenueSold: totalRevenueBRL === 0 ? 0 : roundPct((soldRevenueBRL / totalRevenueBRL) * 100),
        totalRevenueBRL: roundBRL(totalRevenueBRL),
        soldRevenueBRL: roundBRL(soldRevenueBRL),
        totalAreaM2: roundBRL(totalAreaM2),
        soldAreaM2: roundBRL(soldAreaM2),
    };
}
/**
 * Aggregate financial totals for a single event:
 *   - recebido_BRL   = sum(payments WHERE status='paid')
 *   - aReceber_BRL   = sum(payments WHERE status='pending')
 *   - comissao_BRL   = recebido_BRL × tenant.platform_commission_pct
 *   - byVendor[]     = same totals broken down per fornecedor
 *
 * 'refunded' / 'failed' statuses are excluded from recebido (RESEARCH §A8).
 *
 * The tenant commission rate is resolved by reading `tenants.platform_commission_pct`
 * for the current tenant — `tenants` is a GLOBAL lookup with NO RLS policy, so
 * the read works inside any withTenant transaction.
 */
async function getEventFinancialsInTenant(db, tenantId, input) {
    // Resolve commission rate for this tenant. tenants has NO RLS so this
    // SELECT is unconditional.
    const tenantRows = await db
        .select({ rate: tenants_1.tenants.platformCommissionPct })
        .from(tenants_1.tenants)
        .where((0, drizzle_orm_1.eq)(tenants_1.tenants.id, tenantId))
        .limit(1);
    const rateStr = tenantRows[0]?.rate;
    const commissionRate = rateStr != null ? Number(rateStr) : 0.05;
    // Aggregate paid + pending sums per vendor in one query.
    // payments → contracts → vendor / lot.eventId.
    const rows = await db.execute((0, drizzle_orm_1.sql) `
    SELECT
      ${vendors_1.vendors.id} AS vendor_id,
      ${vendors_1.vendors.legalName} AS vendor_legal_name,
      COALESCE(SUM(${payments_1.payments.amountBrlCents}) FILTER (WHERE ${payments_1.payments.status} = 'paid'), 0)::text
        AS total_paid_cents,
      COALESCE(SUM(${payments_1.payments.amountBrlCents}) FILTER (WHERE ${payments_1.payments.status} = 'pending'), 0)::text
        AS total_pending_cents
    FROM ${payments_1.payments}
    JOIN ${contracts_1.contracts} ON ${contracts_1.contracts.id} = ${payments_1.payments.contractId}
    JOIN ${lots_1.lots} ON ${lots_1.lots.id} = ${contracts_1.contracts.lotId}
    JOIN ${vendors_1.vendors} ON ${vendors_1.vendors.id} = ${contracts_1.contracts.vendorId}
    WHERE ${lots_1.lots.eventId} = ${input.eventId}
      AND ${payments_1.payments.deletedAt} IS NULL
      AND ${contracts_1.contracts.deletedAt} IS NULL
    GROUP BY ${vendors_1.vendors.id}, ${vendors_1.vendors.legalName}
  `);
    const resultRows = Array.from(rows);
    let recebidoCents = 0;
    let aReceberCents = 0;
    const byVendor = [];
    for (const r of resultRows) {
        const paid = Number(r.total_paid_cents ?? 0);
        const pending = Number(r.total_pending_cents ?? 0);
        recebidoCents += paid;
        aReceberCents += pending;
        const totalPaidBRL = roundBRL(paid / 100);
        const totalPendingBRL = roundBRL(pending / 100);
        byVendor.push({
            vendorId: r.vendor_id,
            vendorLegalName: r.vendor_legal_name,
            totalPaidBRL,
            totalPendingBRL,
            comissaoBRL: roundBRL(totalPaidBRL * commissionRate),
        });
    }
    // Stable order: highest paid first, then alphabetical by name.
    byVendor.sort((a, b) => {
        if (b.totalPaidBRL !== a.totalPaidBRL)
            return b.totalPaidBRL - a.totalPaidBRL;
        return a.vendorLegalName.localeCompare(b.vendorLegalName, 'pt-BR');
    });
    const recebidoBRL = roundBRL(recebidoCents / 100);
    return {
        recebidoBRL,
        aReceberBRL: roundBRL(aReceberCents / 100),
        comissaoBRL: roundBRL(recebidoBRL * commissionRate),
        commissionRate,
        byVendor,
    };
}
/**
 * Lots for the dashboard Konva read-only render. Returns lot metadata +
 * computed price + status-derived color + assigned vendor (if any).
 *
 * Soft-deleted lots are excluded. Lot assignment join is LEFT (unassigned
 * lots still render — they appear green/available).
 */
async function getEventLotsForDashboardInTenant(db, input) {
    // Use Drizzle query builder so types flow. The LEFT JOIN on lot_assignments
    // is filtered to active (deleted_at IS NULL) rows.
    const rows = await db
        .select({
        id: lots_1.lots.id,
        code: lots_1.lots.code,
        status: lots_1.lots.status,
        geometry: lots_1.lots.geometry,
        areaM2: lots_1.lots.areaM2,
        categoryId: lots_1.lotCategories.id,
        categoryName: lots_1.lotCategories.name,
        baseFixed: lots_1.lotCategories.baseFixed,
        perSqmRate: lots_1.lotCategories.perSqmRate,
        vendorId: vendors_1.vendors.id,
        vendorLegalName: vendors_1.vendors.legalName,
    })
        .from(lots_1.lots)
        .innerJoin(lots_1.lotCategories, (0, drizzle_orm_1.eq)(lots_1.lotCategories.id, lots_1.lots.categoryId))
        .leftJoin(vendors_1.lotAssignments, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.lotAssignments.lotId, lots_1.lots.id), (0, drizzle_orm_1.isNull)(vendors_1.lotAssignments.deletedAt)))
        .leftJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, vendors_1.lotAssignments.vendorId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.eventId, input.eventId), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)));
    return rows.map((r) => {
        const area = typeof r.areaM2 === 'string' ? Number(r.areaM2) : r.areaM2;
        const base = typeof r.baseFixed === 'string' ? Number(r.baseFixed) : r.baseFixed;
        const rate = typeof r.perSqmRate === 'string' ? Number(r.perSqmRate) : r.perSqmRate;
        const priceBRL = roundBRL(base + area * rate);
        const color = getLotColorForStatus(r.status);
        return {
            id: r.id,
            code: r.code,
            status: r.status,
            geometry: r.geometry,
            categoryId: r.categoryId,
            categoryName: r.categoryName,
            areaM2: area,
            priceBRL,
            colorFill: color.fill,
            colorStroke: color.stroke,
            vendorId: r.vendorId,
            vendorLegalName: r.vendorLegalName,
        };
    });
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (thin wrappers over the *InTenant helpers)
// ────────────────────────────────────────────────────────────────────────────
exports.getEventOccupancy = safe_action_1.withTenantAction
    .inputSchema(dashboard_1.dashboardEventScopeSchema)
    .action(async ({ ctx, parsedInput }) => {
    return getEventOccupancyInTenant(ctx.db, parsedInput);
});
exports.getEventFinancials = safe_action_1.withTenantAction
    .inputSchema(dashboard_1.dashboardEventScopeSchema)
    .action(async ({ ctx, parsedInput }) => {
    return getEventFinancialsInTenant(ctx.db, ctx.tenantId, parsedInput);
});
exports.getEventLotsForDashboard = safe_action_1.withTenantAction
    .inputSchema(dashboard_1.dashboardEventScopeSchema)
    .action(async ({ ctx, parsedInput }) => {
    return getEventLotsForDashboardInTenant(ctx.db, parsedInput);
});
