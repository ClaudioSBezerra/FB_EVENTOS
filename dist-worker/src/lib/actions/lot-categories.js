"use strict";
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
'use server';
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEventCategories = exports.deleteLotCategory = exports.updateLotCategory = exports.createLotCategory = void 0;
exports.createLotCategoryInTenant = createLotCategoryInTenant;
exports.updateLotCategoryInTenant = updateLotCategoryInTenant;
exports.deleteLotCategoryInTenant = deleteLotCategoryInTenant;
exports.listEventCategoriesInTenant = listEventCategoriesInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const lots_1 = require("@/db/schema/lots");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const lot_category_1 = require("@/lib/validators/lot-category");
// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers
// ────────────────────────────────────────────────────────────────────────────
async function createLotCategoryInTenant(db, tenantId, input, userId) {
    const rows = await db
        .insert(lots_1.lotCategories)
        .values({
        tenantId,
        eventId: input.eventId,
        name: input.name,
        baseFixed: input.baseFixed.toFixed(2),
        perSqmRate: input.perSqmRate.toFixed(4),
        color: input.color ?? null,
    })
        .returning();
    const row = rows[0];
    if (!row)
        throw new Error('createLotCategoryInTenant: insert returned no row');
    await (0, audit_1.recordAudit)(db, {
        action: 'lot_category.created',
        entity: 'lot_category',
        entityId: row.id,
        userId,
        payload: {
            name: row.name,
            baseFixed: input.baseFixed,
            perSqmRate: input.perSqmRate,
        },
    });
    return toPersisted(row);
}
async function updateLotCategoryInTenant(db, input, userId) {
    const patch = {};
    if (input.name !== undefined)
        patch.name = input.name;
    if (input.baseFixed !== undefined)
        patch.baseFixed = input.baseFixed.toFixed(2);
    if (input.perSqmRate !== undefined)
        patch.perSqmRate = input.perSqmRate.toFixed(4);
    if (input.color !== undefined)
        patch.color = input.color ?? null;
    patch.updatedAt = new Date();
    const rows = await db
        .update(lots_1.lotCategories)
        .set(patch)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lotCategories.id, input.id), (0, drizzle_orm_1.isNull)(lots_1.lotCategories.deletedAt)))
        .returning();
    const row = rows[0];
    if (!row)
        return null;
    await (0, audit_1.recordAudit)(db, {
        action: 'lot_category.updated',
        entity: 'lot_category',
        entityId: row.id,
        userId,
        payload: { changes: Object.keys(patch).filter((k) => k !== 'updatedAt') },
    });
    return toPersisted(row);
}
async function deleteLotCategoryInTenant(db, input, userId) {
    // Business rule: can't delete a category while non-deleted lots reference it.
    const referenced = await db
        .select({ id: lots_1.lots.id })
        .from(lots_1.lots)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.categoryId, input.id), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .limit(1);
    if (referenced.length > 0) {
        throw new Error('Não é possível excluir: existem lotes nesta categoria');
    }
    const rows = await db
        .update(lots_1.lotCategories)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lotCategories.id, input.id), (0, drizzle_orm_1.isNull)(lots_1.lotCategories.deletedAt)))
        .returning({ id: lots_1.lotCategories.id, name: lots_1.lotCategories.name });
    const row = rows[0];
    if (!row)
        return false;
    await (0, audit_1.recordAudit)(db, {
        action: 'lot_category.deleted',
        entity: 'lot_category',
        entityId: row.id,
        userId,
        payload: { name: row.name },
    });
    return true;
}
async function listEventCategoriesInTenant(db, input) {
    const rows = await db
        .select()
        .from(lots_1.lotCategories)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lotCategories.eventId, input.eventId), (0, drizzle_orm_1.isNull)(lots_1.lotCategories.deletedAt)))
        .orderBy((0, drizzle_orm_1.asc)(lots_1.lotCategories.name));
    return rows.map(toPersisted);
}
function toPersisted(row) {
    return {
        id: row.id,
        tenantId: row.tenantId,
        eventId: row.eventId,
        name: row.name,
        baseFixed: typeof row.baseFixed === 'string' ? Number(row.baseFixed) : row.baseFixed,
        perSqmRate: typeof row.perSqmRate === 'string' ? Number(row.perSqmRate) : row.perSqmRate,
        color: row.color,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions
// ────────────────────────────────────────────────────────────────────────────
exports.createLotCategory = safe_action_1.withTenantAction
    .inputSchema(lot_category_1.lotCategoryCreateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await createLotCategoryInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)(`/[slug]/eventos/${parsedInput.eventId}/categorias`, 'page');
    (0, cache_1.revalidatePath)(`/[slug]/eventos/${parsedInput.eventId}/planta`, 'page');
    return row;
});
exports.updateLotCategory = safe_action_1.withTenantAction
    .inputSchema(lot_category_1.lotCategoryUpdateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await updateLotCategoryInTenant(ctx.db, parsedInput, ctx.userId);
    if (!row)
        throw new Error('Categoria não encontrada ou inacessível');
    (0, cache_1.revalidatePath)(`/[slug]/eventos/${row.eventId}/categorias`, 'page');
    return row;
});
exports.deleteLotCategory = safe_action_1.withTenantAction
    .inputSchema(lot_category_1.lotCategoryIdSchema)
    .action(async ({ ctx, parsedInput }) => {
    const ok = await deleteLotCategoryInTenant(ctx.db, parsedInput, ctx.userId);
    if (!ok)
        throw new Error('Categoria não encontrada ou inacessível');
    return { ok };
});
exports.listEventCategories = safe_action_1.withTenantAction
    .inputSchema(lot_category_1.lotCategoryEventScopeSchema)
    .action(async ({ ctx, parsedInput }) => {
    return listEventCategoriesInTenant(ctx.db, parsedInput);
});
