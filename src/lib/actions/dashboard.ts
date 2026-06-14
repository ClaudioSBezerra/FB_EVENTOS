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

'use server'

import { and, eq, isNull, sql } from 'drizzle-orm'

import { contracts } from '@/db/schema/contracts'
import { lotCategories, lots } from '@/db/schema/lots'
import { payments } from '@/db/schema/payments'
import { tenants } from '@/db/schema/tenants'
import { lotAssignments, vendors } from '@/db/schema/vendors'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import {
  type DashboardEventScopeInput,
  dashboardEventScopeSchema,
} from '@/lib/validators/dashboard'

// ────────────────────────────────────────────────────────────────────────────
// Status → color mapping (Konva read-only render uses fill/stroke hex)
// ────────────────────────────────────────────────────────────────────────────

export type LotStatus = 'available' | 'reserved' | 'sold'

/**
 * Status → color tuple consumed by the Konva read-only render in
 * <PlantaEditor mode='dashboard' ... />. Stroke is the solid hex; the
 * fill is the same hex with the editor's standard 25%-alpha suffix ("40").
 */
export function getLotColorForStatus(status: string): { fill: string; stroke: string } {
  switch (status) {
    case 'sold':
      return { fill: '#EF4444', stroke: '#EF4444' }
    case 'reserved':
      return { fill: '#F59E0B', stroke: '#F59E0B' }
    default:
      // available (and any unknown future status) → green default
      return { fill: '#10B981', stroke: '#10B981' }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Result shapes
// ────────────────────────────────────────────────────────────────────────────

export interface OccupancyByStatus {
  available: number
  reserved: number
  sold: number
}

export interface EventOccupancyResult {
  totalLots: number
  byStatus: OccupancyByStatus
  /** Whole-number percent (0..100), rounded to 1 decimal — 0 when no lots. */
  percentLotsSold: number
  percentM2Sold: number
  percentRevenueSold: number
  /** R$ (BRL) — sum of all non-deleted lots' computed price. */
  totalRevenueBRL: number
  /** R$ (BRL) — sum of sold lots' computed price. */
  soldRevenueBRL: number
  /** Total area (m²) across all non-deleted lots. */
  totalAreaM2: number
  /** Sold area (m²). */
  soldAreaM2: number
}

export interface ByVendorRow {
  vendorId: string
  vendorLegalName: string
  totalPaidBRL: number
  totalPendingBRL: number
  comissaoBRL: number
}

export interface EventFinancialsResult {
  recebidoBRL: number
  aReceberBRL: number
  comissaoBRL: number
  /** Resolved commission rate (0..1) used to compute comissaoBRL above. */
  commissionRate: number
  byVendor: ByVendorRow[]
}

export interface DashboardLotItem {
  id: string
  code: string
  status: string
  geometry: unknown
  categoryId: string
  categoryName: string
  areaM2: number
  priceBRL: number
  /** Hex color the Konva read-only render fills with. */
  colorFill: string
  colorStroke: string
  /** Active vendor (if assigned), null otherwise. */
  vendorId: string | null
  vendorLegalName: string | null
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers — tests drive these inside withTenant()
// ────────────────────────────────────────────────────────────────────────────

function roundPct(n: number): number {
  return Math.round(n * 10) / 10
}

function roundBRL(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Aggregate lot occupancy + computed revenue for a single event.
 *
 * SQL: GROUP BY lots.status, summing count / area / price (base + area × rate).
 * Soft-deleted lots (lots.deleted_at IS NOT NULL) are excluded. Cross-tenant
 * eventId returns an empty group set (RLS hides the rows entirely).
 */
export async function getEventOccupancyInTenant(
  db: TenantDb,
  input: DashboardEventScopeInput,
): Promise<EventOccupancyResult> {
  // Single GROUP BY query. We cast numerics to text in postgres.js path then
  // Number() them back — postgres.js returns numeric as string by default,
  // and SUM() over numeric is itself numeric. Using ::float8 keeps the
  // result as a JS number when postgres.js sees no scale hint.
  const rows = await db.execute<{
    status: string
    n: string
    sum_area: string | null
    sum_price: string | null
  }>(sql`
    SELECT
      ${lots.status} AS status,
      COUNT(*)::text AS n,
      COALESCE(SUM(${lots.areaM2}), 0)::text AS sum_area,
      COALESCE(
        SUM(
          ${lotCategories.baseFixed} +
          ${lots.areaM2} * ${lotCategories.perSqmRate}
        ),
        0
      )::text AS sum_price
    FROM ${lots}
    JOIN ${lotCategories} ON ${lotCategories.id} = ${lots.categoryId}
    WHERE ${lots.eventId} = ${input.eventId}
      AND ${lots.deletedAt} IS NULL
      AND ${lotCategories.deletedAt} IS NULL
    GROUP BY ${lots.status}
  `)

  const byStatus: OccupancyByStatus = { available: 0, reserved: 0, sold: 0 }
  let totalLots = 0
  let totalAreaM2 = 0
  let totalRevenueBRL = 0
  let soldAreaM2 = 0
  let soldRevenueBRL = 0

  // db.execute returns a result-like object; for postgres-js the rows are
  // available as the iterable result itself. Use Array.from to be defensive
  // (Drizzle's PgRaw result is iterable across both array and result shapes).
  const resultRows = Array.from(
    rows as Iterable<{
      status: string
      n: string
      sum_area: string | null
      sum_price: string | null
    }>,
  )

  for (const r of resultRows) {
    const n = Number(r.n)
    const area = Number(r.sum_area ?? 0)
    const price = Number(r.sum_price ?? 0)
    totalLots += n
    totalAreaM2 += area
    totalRevenueBRL += price
    if (r.status === 'sold') {
      soldAreaM2 += area
      soldRevenueBRL += price
    }
    if (r.status === 'available') byStatus.available = n
    else if (r.status === 'reserved') byStatus.reserved = n
    else if (r.status === 'sold') byStatus.sold = n
  }

  return {
    totalLots,
    byStatus,
    percentLotsSold: totalLots === 0 ? 0 : roundPct((byStatus.sold / totalLots) * 100),
    percentM2Sold: totalAreaM2 === 0 ? 0 : roundPct((soldAreaM2 / totalAreaM2) * 100),
    percentRevenueSold:
      totalRevenueBRL === 0 ? 0 : roundPct((soldRevenueBRL / totalRevenueBRL) * 100),
    totalRevenueBRL: roundBRL(totalRevenueBRL),
    soldRevenueBRL: roundBRL(soldRevenueBRL),
    totalAreaM2: roundBRL(totalAreaM2),
    soldAreaM2: roundBRL(soldAreaM2),
  }
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
export async function getEventFinancialsInTenant(
  db: TenantDb,
  tenantId: string,
  input: DashboardEventScopeInput,
): Promise<EventFinancialsResult> {
  // Resolve commission rate for this tenant. tenants has NO RLS so this
  // SELECT is unconditional.
  const tenantRows = await db
    .select({ rate: tenants.platformCommissionPct })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  const rateStr = tenantRows[0]?.rate
  const commissionRate = rateStr != null ? Number(rateStr) : 0.05

  // Aggregate paid + pending sums per vendor in one query.
  // payments → contracts → vendor / lot.eventId.
  const rows = await db.execute<{
    vendor_id: string
    vendor_legal_name: string
    total_paid_cents: string | null
    total_pending_cents: string | null
  }>(sql`
    SELECT
      ${vendors.id} AS vendor_id,
      ${vendors.legalName} AS vendor_legal_name,
      COALESCE(SUM(${payments.amountBrlCents}) FILTER (WHERE ${payments.status} = 'paid'), 0)::text
        AS total_paid_cents,
      COALESCE(SUM(${payments.amountBrlCents}) FILTER (WHERE ${payments.status} = 'pending'), 0)::text
        AS total_pending_cents
    FROM ${payments}
    JOIN ${contracts} ON ${contracts.id} = ${payments.contractId}
    JOIN ${lots} ON ${lots.id} = ${contracts.lotId}
    JOIN ${vendors} ON ${vendors.id} = ${contracts.vendorId}
    WHERE ${lots.eventId} = ${input.eventId}
      AND ${payments.deletedAt} IS NULL
      AND ${contracts.deletedAt} IS NULL
    GROUP BY ${vendors.id}, ${vendors.legalName}
  `)

  const resultRows = Array.from(
    rows as Iterable<{
      vendor_id: string
      vendor_legal_name: string
      total_paid_cents: string | null
      total_pending_cents: string | null
    }>,
  )

  let recebidoCents = 0
  let aReceberCents = 0
  const byVendor: ByVendorRow[] = []

  for (const r of resultRows) {
    const paid = Number(r.total_paid_cents ?? 0)
    const pending = Number(r.total_pending_cents ?? 0)
    recebidoCents += paid
    aReceberCents += pending
    const totalPaidBRL = roundBRL(paid / 100)
    const totalPendingBRL = roundBRL(pending / 100)
    byVendor.push({
      vendorId: r.vendor_id,
      vendorLegalName: r.vendor_legal_name,
      totalPaidBRL,
      totalPendingBRL,
      comissaoBRL: roundBRL(totalPaidBRL * commissionRate),
    })
  }

  // Stable order: highest paid first, then alphabetical by name.
  byVendor.sort((a, b) => {
    if (b.totalPaidBRL !== a.totalPaidBRL) return b.totalPaidBRL - a.totalPaidBRL
    return a.vendorLegalName.localeCompare(b.vendorLegalName, 'pt-BR')
  })

  const recebidoBRL = roundBRL(recebidoCents / 100)
  return {
    recebidoBRL,
    aReceberBRL: roundBRL(aReceberCents / 100),
    comissaoBRL: roundBRL(recebidoBRL * commissionRate),
    commissionRate,
    byVendor,
  }
}

/**
 * Lots for the dashboard Konva read-only render. Returns lot metadata +
 * computed price + status-derived color + assigned vendor (if any).
 *
 * Soft-deleted lots are excluded. Lot assignment join is LEFT (unassigned
 * lots still render — they appear green/available).
 */
export async function getEventLotsForDashboardInTenant(
  db: TenantDb,
  input: DashboardEventScopeInput,
): Promise<DashboardLotItem[]> {
  // Use Drizzle query builder so types flow. The LEFT JOIN on lot_assignments
  // is filtered to active (deleted_at IS NULL) rows.
  const rows = await db
    .select({
      id: lots.id,
      code: lots.code,
      status: lots.status,
      geometry: lots.geometry,
      areaM2: lots.areaM2,
      categoryId: lotCategories.id,
      categoryName: lotCategories.name,
      baseFixed: lotCategories.baseFixed,
      perSqmRate: lotCategories.perSqmRate,
      vendorId: vendors.id,
      vendorLegalName: vendors.legalName,
    })
    .from(lots)
    .innerJoin(lotCategories, eq(lotCategories.id, lots.categoryId))
    .leftJoin(
      lotAssignments,
      and(eq(lotAssignments.lotId, lots.id), isNull(lotAssignments.deletedAt)),
    )
    .leftJoin(vendors, eq(vendors.id, lotAssignments.vendorId))
    .where(and(eq(lots.eventId, input.eventId), isNull(lots.deletedAt)))

  return rows.map((r) => {
    const area = typeof r.areaM2 === 'string' ? Number(r.areaM2) : (r.areaM2 as number)
    const base = typeof r.baseFixed === 'string' ? Number(r.baseFixed) : (r.baseFixed as number)
    const rate = typeof r.perSqmRate === 'string' ? Number(r.perSqmRate) : (r.perSqmRate as number)
    const priceBRL = roundBRL(base + area * rate)
    const color = getLotColorForStatus(r.status)
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
    }
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions (thin wrappers over the *InTenant helpers)
// ────────────────────────────────────────────────────────────────────────────

export const getEventOccupancy = withTenantAction
  .inputSchema(dashboardEventScopeSchema)
  .action(async ({ ctx, parsedInput }) => {
    return getEventOccupancyInTenant(ctx.db, parsedInput)
  })

export const getEventFinancials = withTenantAction
  .inputSchema(dashboardEventScopeSchema)
  .action(async ({ ctx, parsedInput }) => {
    return getEventFinancialsInTenant(ctx.db, ctx.tenantId, parsedInput)
  })

export const getEventLotsForDashboard = withTenantAction
  .inputSchema(dashboardEventScopeSchema)
  .action(async ({ ctx, parsedInput }) => {
    return getEventLotsForDashboardInTenant(ctx.db, parsedInput)
  })
