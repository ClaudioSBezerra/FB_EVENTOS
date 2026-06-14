// FB_EVENTOS — Lot category Server Actions
// (Phase 1, Plan 01-03 — Task 3).
//
// Four Server Actions wrapped in `withTenantAction`:
//
//   - createLotCategory   — INSERT a lot_categories row + audit row.
//   - updateLotCategory   — UPDATE name / base_fixed / per_sqm_rate / color
//                           + audit row.
//   - deleteLotCategory   — soft-delete (deleted_at) + audit row. Rejects
//                           if any non-deleted lot still references the
//                           category (FK + business rule).
//   - listEventCategories — SELECT non-deleted categories for the event.
//
// SHAPE follows the pure-helper / thin-action split (Plan 01-02 pattern).

'use server'

import { and, asc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { lotCategories, lots } from '@/db/schema/lots'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import {
  type LotCategoryCreateInput,
  type LotCategoryEventScopeInput,
  type LotCategoryIdInput,
  type LotCategoryUpdateInput,
  lotCategoryCreateSchema,
  lotCategoryEventScopeSchema,
  lotCategoryIdSchema,
  lotCategoryUpdateSchema,
} from '@/lib/validators/lot-category'

// ────────────────────────────────────────────────────────────────────────────
// Persisted row shape
// ────────────────────────────────────────────────────────────────────────────

export interface PersistedLotCategoryRow {
  id: string
  tenantId: string
  eventId: string
  name: string
  baseFixed: number
  perSqmRate: number
  color: string | null
  createdAt: Date
  updatedAt: Date
}

// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers
// ────────────────────────────────────────────────────────────────────────────

export async function createLotCategoryInTenant(
  db: TenantDb,
  tenantId: string,
  input: LotCategoryCreateInput,
  userId: string,
): Promise<PersistedLotCategoryRow> {
  const rows = await db
    .insert(lotCategories)
    .values({
      tenantId,
      eventId: input.eventId,
      name: input.name,
      baseFixed: input.baseFixed.toFixed(2),
      perSqmRate: input.perSqmRate.toFixed(4),
      color: input.color ?? null,
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('createLotCategoryInTenant: insert returned no row')

  await recordAudit(db, {
    action: 'lot_category.created',
    entity: 'lot_category',
    entityId: row.id,
    userId,
    payload: {
      name: row.name,
      baseFixed: input.baseFixed,
      perSqmRate: input.perSqmRate,
    },
  })

  return toPersisted(row)
}

export async function updateLotCategoryInTenant(
  db: TenantDb,
  input: LotCategoryUpdateInput,
  userId: string,
): Promise<PersistedLotCategoryRow | null> {
  const patch: Partial<typeof lotCategories.$inferInsert> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.baseFixed !== undefined) patch.baseFixed = input.baseFixed.toFixed(2)
  if (input.perSqmRate !== undefined) patch.perSqmRate = input.perSqmRate.toFixed(4)
  if (input.color !== undefined) patch.color = input.color ?? null
  patch.updatedAt = new Date()

  const rows = await db
    .update(lotCategories)
    .set(patch)
    .where(and(eq(lotCategories.id, input.id), isNull(lotCategories.deletedAt)))
    .returning()

  const row = rows[0]
  if (!row) return null

  await recordAudit(db, {
    action: 'lot_category.updated',
    entity: 'lot_category',
    entityId: row.id,
    userId,
    payload: { changes: Object.keys(patch).filter((k) => k !== 'updatedAt') },
  })

  return toPersisted(row)
}

export async function deleteLotCategoryInTenant(
  db: TenantDb,
  input: LotCategoryIdInput,
  userId: string,
): Promise<boolean> {
  // Business rule: can't delete a category while non-deleted lots reference it.
  const referenced = await db
    .select({ id: lots.id })
    .from(lots)
    .where(and(eq(lots.categoryId, input.id), isNull(lots.deletedAt)))
    .limit(1)
  if (referenced.length > 0) {
    throw new Error('Não é possível excluir: existem lotes nesta categoria')
  }

  const rows = await db
    .update(lotCategories)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(lotCategories.id, input.id), isNull(lotCategories.deletedAt)))
    .returning({ id: lotCategories.id, name: lotCategories.name })

  const row = rows[0]
  if (!row) return false

  await recordAudit(db, {
    action: 'lot_category.deleted',
    entity: 'lot_category',
    entityId: row.id,
    userId,
    payload: { name: row.name },
  })
  return true
}

export async function listEventCategoriesInTenant(
  db: TenantDb,
  input: LotCategoryEventScopeInput,
): Promise<PersistedLotCategoryRow[]> {
  const rows = await db
    .select()
    .from(lotCategories)
    .where(and(eq(lotCategories.eventId, input.eventId), isNull(lotCategories.deletedAt)))
    .orderBy(asc(lotCategories.name))
  return rows.map(toPersisted)
}

function toPersisted(row: typeof lotCategories.$inferSelect): PersistedLotCategoryRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventId: row.eventId,
    name: row.name,
    baseFixed:
      typeof row.baseFixed === 'string' ? Number(row.baseFixed) : (row.baseFixed as number),
    perSqmRate:
      typeof row.perSqmRate === 'string' ? Number(row.perSqmRate) : (row.perSqmRate as number),
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions
// ────────────────────────────────────────────────────────────────────────────

export const createLotCategory = withTenantAction
  .inputSchema(lotCategoryCreateSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await createLotCategoryInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath(`/[slug]/eventos/${parsedInput.eventId}/categorias`, 'page')
    revalidatePath(`/[slug]/eventos/${parsedInput.eventId}/planta`, 'page')
    return row
  })

export const updateLotCategory = withTenantAction
  .inputSchema(lotCategoryUpdateSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await updateLotCategoryInTenant(ctx.db, parsedInput, ctx.userId)
    if (!row) throw new Error('Categoria não encontrada ou inacessível')
    revalidatePath(`/[slug]/eventos/${row.eventId}/categorias`, 'page')
    return row
  })

export const deleteLotCategory = withTenantAction
  .inputSchema(lotCategoryIdSchema)
  .action(async ({ ctx, parsedInput }) => {
    const ok = await deleteLotCategoryInTenant(ctx.db, parsedInput, ctx.userId)
    if (!ok) throw new Error('Categoria não encontrada ou inacessível')
    return { ok }
  })

export const listEventCategories = withTenantAction
  .inputSchema(lotCategoryEventScopeSchema)
  .action(async ({ ctx, parsedInput }) => {
    return listEventCategoriesInTenant(ctx.db, parsedInput)
  })
