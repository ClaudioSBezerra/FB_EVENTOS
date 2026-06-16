"use strict";
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
'use server';
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEventLots = exports.deleteLot = exports.updateLotStatus = exports.updateLotGeometry = exports.createLot = void 0;
exports.createLotInTenant = createLotInTenant;
exports.updateLotGeometryInTenant = updateLotGeometryInTenant;
exports.updateLotStatusInTenant = updateLotStatusInTenant;
exports.deleteLotInTenant = deleteLotInTenant;
exports.listEventLotsInTenant = listEventLotsInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const lots_1 = require("@/db/schema/lots");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const geometry_1 = require("@/lib/validators/geometry");
const lot_1 = require("@/lib/validators/lot");
// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers — tests call these inside withTenant directly
// ────────────────────────────────────────────────────────────────────────────
/**
 * INSERT a new lot row. The caller MUST already be inside withTenant().
 * area_m² is computed server-side from the polygon points (shoelace) so the
 * client cannot poison the pricing input by sending a fabricated area.
 */
async function createLotInTenant(db, tenantId, input, userId) {
    const areaM2 = (0, geometry_1.computeGeometryAreaM2)(input.geometry);
    const rows = await db
        .insert(lots_1.lots)
        .values({
        tenantId,
        eventId: input.eventId,
        categoryId: input.categoryId,
        code: input.code,
        // numeric columns accept string in postgres.js mapping — pass formatted.
        areaM2: areaM2.toFixed(2),
        // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts a JSON-serializable object
        geometry: input.geometry,
    })
        .returning();
    const row = rows[0];
    if (!row)
        throw new Error('createLotInTenant: insert returned no row');
    await (0, audit_1.recordAudit)(db, {
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
    });
    return toPersistedLot(row);
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
async function updateLotGeometryInTenant(db, input) {
    const areaM2 = (0, geometry_1.computeGeometryAreaM2)(input.geometry);
    const rows = await db
        .update(lots_1.lots)
        .set({
        // biome-ignore lint/suspicious/noExplicitAny: jsonb column accepts a JSON-serializable object
        geometry: input.geometry,
        areaM2: areaM2.toFixed(2),
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.id, input.lotId), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .returning();
    const row = rows[0];
    return row ? toPersistedLot(row) : null;
}
/**
 * UPDATE lot status (available → sold | reserved). Audited.
 */
async function updateLotStatusInTenant(db, input, userId) {
    // Fetch current status for the audit payload (defensive read inside the
    // same withTenant transaction — RLS gates it).
    const existing = await db
        .select({ status: lots_1.lots.status })
        .from(lots_1.lots)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.id, input.lotId), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .limit(1);
    const prevStatus = existing[0]?.status ?? null;
    const rows = await db
        .update(lots_1.lots)
        .set({ status: input.status, updatedAt: new Date() })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.id, input.lotId), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .returning();
    const row = rows[0];
    if (!row)
        return null;
    await (0, audit_1.recordAudit)(db, {
        action: 'lot.status_changed',
        entity: 'lot',
        entityId: row.id,
        userId,
        payload: { from: prevStatus, to: row.status },
    });
    return toPersistedLot(row);
}
/**
 * Soft-delete a lot (stamps deleted_at). Audited.
 */
async function deleteLotInTenant(db, input, userId) {
    const rows = await db
        .update(lots_1.lots)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.id, input.lotId), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .returning({ id: lots_1.lots.id, code: lots_1.lots.code });
    const row = rows[0];
    if (!row)
        return false;
    await (0, audit_1.recordAudit)(db, {
        action: 'lot.deleted',
        entity: 'lot',
        entityId: row.id,
        userId,
        payload: { code: row.code },
    });
    return true;
}
/**
 * SELECT all non-deleted lots for an event (RLS-scoped). Ordered by code for
 * a stable editor + dashboard render.
 */
async function listEventLotsInTenant(db, input) {
    const rows = await db
        .select()
        .from(lots_1.lots)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.eventId, input.eventId), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .orderBy((0, drizzle_orm_1.asc)(lots_1.lots.code));
    return rows.map(toPersistedLot);
}
function toPersistedLot(row) {
    return {
        id: row.id,
        tenantId: row.tenantId,
        eventId: row.eventId,
        categoryId: row.categoryId,
        code: row.code,
        areaM2: typeof row.areaM2 === 'string' ? Number(row.areaM2) : row.areaM2,
        geometry: row.geometry,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8)
// ────────────────────────────────────────────────────────────────────────────
exports.createLot = safe_action_1.withTenantAction
    .inputSchema(lot_1.lotCreateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await createLotInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)(`/[slug]/eventos/${parsedInput.eventId}/planta`, 'page');
    return row;
});
exports.updateLotGeometry = safe_action_1.withTenantAction
    .inputSchema(lot_1.lotUpdateGeometrySchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await updateLotGeometryInTenant(ctx.db, parsedInput);
    // Auto-save: no revalidatePath — the editor manages its own optimistic
    // state, and a server-driven refresh during drag would clobber the UI.
    return row;
});
exports.updateLotStatus = safe_action_1.withTenantAction
    .inputSchema(lot_1.lotUpdateStatusSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await updateLotStatusInTenant(ctx.db, parsedInput, ctx.userId);
    if (!row)
        throw new Error('Lote não encontrado ou inacessível');
    return row;
});
exports.deleteLot = safe_action_1.withTenantAction
    .inputSchema(lot_1.lotIdSchema)
    .action(async ({ ctx, parsedInput }) => {
    const ok = await deleteLotInTenant(ctx.db, parsedInput, ctx.userId);
    if (!ok)
        throw new Error('Lote não encontrado ou inacessível');
    return { ok };
});
exports.listEventLots = safe_action_1.withTenantAction
    .inputSchema(lot_1.lotEventScopeSchema)
    .action(async ({ ctx, parsedInput }) => {
    return listEventLotsInTenant(ctx.db, parsedInput);
});
