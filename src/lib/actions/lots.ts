// FB_EVENTOS — Lot CRUD Server Actions (Phase 1, Plan 01-03 — Task 1).
//
// Five Server Actions wrapped in `withTenantAction`:
//
//   - createLot          — INSERT a lot row, server-computes area_m² from
//                          polygon points (shoelace), recordAudit.
//   - updateLotGeometry  — UPDATE geometry + recompute area_m². NO audit row
//                          per call (Phase 1 deliberately quiet — D-11 +
//                          RESEARCH §A5 pitfall 7). create + delete + status
//                          changes DO audit; per-drag persistence does not.
//   - updateLotStatus    — change status (available → sold etc.) + recordAudit.
//   - deleteLot          — soft-delete (deleted_at) + recordAudit.
//   - listEventLots      — SELECT non-deleted lots for an event (editor +
//                          dashboard share this read path).
//
// SHAPE (testability):
//   Each Server Action is a thin wrapper around a pure helper that takes
//   (db: TenantDb, input, userId) — tests call helpers directly inside
//   withTenant() without a Better Auth session.
//
// RLS CONTRACT:
//   Every query goes through ctx.db (the withTenant transaction handle).
//   FORCE RLS on lots + lot_categories ensures cross-tenant attempts return
//   0 rows. Cross-tenant UPDATE/DELETE silently affects 0 rows (no error)
//   by design — callers MUST inspect the returning row count.
//
// AREA RECOMPUTATION:
//   The client MAY pass a stale or fabricated area; we recompute via
//   shoelace from the polygon points before persisting. This closes the
//   trust gap on a client-supplied numeric that feeds into the aditivo
//   pricing formula (ADR-0003).

'use server'

import { and, asc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { lots } from '@/db/schema/lots'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import { computeGeometryAreaM2, type Geometry } from '@/lib/validators/geometry'
import {
  type LotCreateInput,
  type LotEventScopeInput,
  type LotIdInput,
  type LotUpdateGeometryInput,
  type LotUpdateStatusInput,
  lotCreateSchema,
  lotEventScopeSchema,
  lotIdSchema,
  lotUpdateGeometrySchema,
  lotUpdateStatusSchema,
} from '@/lib/validators/lot'

// ────────────────────────────────────────────────────────────────────────────
// Persisted row shape
// ────────────────────────────────────────────────────────────────────────────

export interface PersistedLotRow {
  id: string
  tenantId: string
  eventId: string
  categoryId: string
  code: string
  areaM2: number
  geometry: Geometry
  status: string
  createdAt: Date
  updatedAt: Date
}

// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers — tests call these inside withTenant directly
// ────────────────────────────────────────────────────────────────────────────

/**
 * INSERT a new lot row. The caller MUST already be inside withTenant().
 * area_m² is computed server-side from the polygon points (shoelace) so the
 * client cannot poison the pricing input by sending a fabricated area.
 */
export async function createLotInTenant(
  db: TenantDb,
  tenantId: string,
  input: LotCreateInput,
  userId: string,
): Promise<PersistedLotRow> {
  const areaM2 = computeGeometryAreaM2(input.geometry)

  const rows = await db
    .insert(lots)
    .values({
      tenantId,
      eventId: input.eventId,
      categoryId: input.categoryId,
      code: input.code,
      // numeric columns accept string in postgres.js mapping — pass formatted.
      areaM2: areaM2.toFixed(2),
      // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts a JSON-serializable object
      geometry: input.geometry as any,
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('createLotInTenant: insert returned no row')

  await recordAudit(db, {
    action: 'lot.created',
    entity: 'lot',
    entityId: row.id,
    userId,
    payload: {
      code: row.code,
      categoryId: row.categoryId,
      areaM2,
      vertexCount: input.geometry.type === 'polygon2d' ? input.geometry.points.length : null,
    },
  })

  return toPersistedLot(row)
}

/**
 * UPDATE lot geometry + recompute area_m². Returns null if no row affected
 * (lot not found OR cross-tenant — RLS hides the row).
 *
 * IMPORTANT (D-11 + RESEARCH §A5 pitfall 7): per-drag persistence is
 * deliberately NOT audited. Each Konva drag fires the debounced auto-save;
 * a typical edit session emits dozens of geometry updates. Auditing each
 * one would (a) explode audit_log volume and (b) lose the signal in the
 * noise. We audit create + delete + status changes; geometry changes are
 * idempotent state restorable from the lots row itself.
 */
export async function updateLotGeometryInTenant(
  db: TenantDb,
  input: LotUpdateGeometryInput,
): Promise<PersistedLotRow | null> {
  const areaM2 = computeGeometryAreaM2(input.geometry)

  const rows = await db
    .update(lots)
    .set({
      // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts a JSON-serializable object
      geometry: input.geometry as any,
      areaM2: areaM2.toFixed(2),
      updatedAt: new Date(),
    })
    .where(and(eq(lots.id, input.lotId), isNull(lots.deletedAt)))
    .returning()

  const row = rows[0]
  return row ? toPersistedLot(row) : null
}

/**
 * UPDATE lot status (available → sold | reserved). Audited.
 */
export async function updateLotStatusInTenant(
  db: TenantDb,
  input: LotUpdateStatusInput,
  userId: string,
): Promise<PersistedLotRow | null> {
  // Fetch current status for the audit payload (defensive read inside the
  // same withTenant transaction — RLS gates it).
  const existing = await db
    .select({ status: lots.status })
    .from(lots)
    .where(and(eq(lots.id, input.lotId), isNull(lots.deletedAt)))
    .limit(1)
  const prevStatus = existing[0]?.status ?? null

  const rows = await db
    .update(lots)
    .set({ status: input.status, updatedAt: new Date() })
    .where(and(eq(lots.id, input.lotId), isNull(lots.deletedAt)))
    .returning()

  const row = rows[0]
  if (!row) return null

  await recordAudit(db, {
    action: 'lot.status_changed',
    entity: 'lot',
    entityId: row.id,
    userId,
    payload: { from: prevStatus, to: row.status },
  })

  return toPersistedLot(row)
}

/**
 * Soft-delete a lot (stamps deleted_at). Audited.
 */
export async function deleteLotInTenant(
  db: TenantDb,
  input: LotIdInput,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .update(lots)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(lots.id, input.lotId), isNull(lots.deletedAt)))
    .returning({ id: lots.id, code: lots.code })

  const row = rows[0]
  if (!row) return false

  await recordAudit(db, {
    action: 'lot.deleted',
    entity: 'lot',
    entityId: row.id,
    userId,
    payload: { code: row.code },
  })
  return true
}

/**
 * SELECT all non-deleted lots for an event (RLS-scoped). Ordered by code for
 * a stable editor + dashboard render.
 */
export async function listEventLotsInTenant(
  db: TenantDb,
  input: LotEventScopeInput,
): Promise<PersistedLotRow[]> {
  const rows = await db
    .select()
    .from(lots)
    .where(and(eq(lots.eventId, input.eventId), isNull(lots.deletedAt)))
    .orderBy(asc(lots.code))
  return rows.map(toPersistedLot)
}

function toPersistedLot(row: typeof lots.$inferSelect): PersistedLotRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventId: row.eventId,
    categoryId: row.categoryId,
    code: row.code,
    areaM2: typeof row.areaM2 === 'string' ? Number(row.areaM2) : (row.areaM2 as number),
    geometry: row.geometry as Geometry,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8)
// ────────────────────────────────────────────────────────────────────────────

export const createLot = withTenantAction
  .inputSchema(lotCreateSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await createLotInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath(`/[slug]/eventos/${parsedInput.eventId}/planta`, 'page')
    return row
  })

export const updateLotGeometry = withTenantAction
  .inputSchema(lotUpdateGeometrySchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await updateLotGeometryInTenant(ctx.db, parsedInput)
    // Auto-save: no revalidatePath — the editor manages its own optimistic
    // state, and a server-driven refresh during drag would clobber the UI.
    return row
  })

export const updateLotStatus = withTenantAction
  .inputSchema(lotUpdateStatusSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await updateLotStatusInTenant(ctx.db, parsedInput, ctx.userId)
    if (!row) throw new Error('Lote não encontrado ou inacessível')
    return row
  })

export const deleteLot = withTenantAction
  .inputSchema(lotIdSchema)
  .action(async ({ ctx, parsedInput }) => {
    const ok = await deleteLotInTenant(ctx.db, parsedInput, ctx.userId)
    if (!ok) throw new Error('Lote não encontrado ou inacessível')
    return { ok }
  })

export const listEventLots = withTenantAction
  .inputSchema(lotEventScopeSchema)
  .action(async ({ ctx, parsedInput }) => {
    return listEventLotsInTenant(ctx.db, parsedInput)
  })
