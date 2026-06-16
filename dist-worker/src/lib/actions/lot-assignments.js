"use strict";
// FB_EVENTOS — Lot assignment Server Actions
// (Phase 1, Plan 01-03 — Task 3).
//
// Three Server Actions wrapped in `withTenantAction`:
//
//   - assignLotToVendor   — INSERT lot_assignments after asserting the
//                           vendor.status === 'approved'. The DB partial
//                           UNIQUE index (lot_id WHERE deleted_at IS NULL)
//                           enforces "one ACTIVE assignment per lot"; a
//                           second attempt while an existing assignment is
//                           active raises a clean error.
//   - unassignLot         — soft-delete the active assignment for lotId
//                           (stamps deleted_at) + audit row.
//   - listAssignedLots    — returns the active assignments + the vendor
//                           label for the dashboard 01-07.
//
// SHAPE follows the pure-helper / thin-action split.
'use server';
// FB_EVENTOS — Lot assignment Server Actions
// (Phase 1, Plan 01-03 — Task 3).
//
// Three Server Actions wrapped in `withTenantAction`:
//
//   - assignLotToVendor   — INSERT lot_assignments after asserting the
//                           vendor.status === 'approved'. The DB partial
//                           UNIQUE index (lot_id WHERE deleted_at IS NULL)
//                           enforces "one ACTIVE assignment per lot"; a
//                           second attempt while an existing assignment is
//                           active raises a clean error.
//   - unassignLot         — soft-delete the active assignment for lotId
//                           (stamps deleted_at) + audit row.
//   - listAssignedLots    — returns the active assignments + the vendor
//                           label for the dashboard 01-07.
//
// SHAPE follows the pure-helper / thin-action split.
Object.defineProperty(exports, "__esModule", { value: true });
exports.listAssignedLots = exports.unassignLot = exports.assignLotToVendor = void 0;
exports.assignLotToVendorInTenant = assignLotToVendorInTenant;
exports.unassignLotInTenant = unassignLotInTenant;
exports.listAssignedLotsInTenant = listAssignedLotsInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const lots_1 = require("@/db/schema/lots");
const vendors_1 = require("@/db/schema/vendors");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const lot_assignment_1 = require("@/lib/validators/lot-assignment");
// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers
// ────────────────────────────────────────────────────────────────────────────
/**
 * Assign an approved vendor to a lot. Throws (with a UX-quality message) if:
 *   - the vendor doesn't exist OR cross-tenant (RLS returns 0 rows)
 *   - the vendor is not status='approved'
 *   - the lot doesn't exist OR cross-tenant
 *   - the lot already has an active assignment (DB-level UNIQUE
 *     "lot_assignments_lot_id_active_unique" partial index)
 *
 * NOTE: the lot vs vendor RLS check happens via SELECT inside withTenant
 * BEFORE the INSERT. The partial UNIQUE catch is belt-and-suspenders against
 * a race; in practice the SELECT-then-INSERT inside the same withTenant
 * transaction keeps the window tight.
 */
async function assignLotToVendorInTenant(db, tenantId, input, userId) {
    // 1. Verify vendor exists, is in our tenant (RLS), AND has status='approved'.
    const vendorRows = await db
        .select({ id: vendors_1.vendors.id, status: vendors_1.vendors.status, legalName: vendors_1.vendors.legalName })
        .from(vendors_1.vendors)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, input.vendorId), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
        .limit(1);
    const vendor = vendorRows[0];
    if (!vendor) {
        throw new Error('Fornecedor não encontrado ou inacessível');
    }
    if (vendor.status !== 'approved') {
        throw new Error(`Fornecedor precisa estar aprovado para receber atribuição (status atual: ${vendor.status})`);
    }
    // 2. Verify lot exists in our tenant (RLS gate).
    const lotRows = await db
        .select({ id: lots_1.lots.id, code: lots_1.lots.code })
        .from(lots_1.lots)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.id, input.lotId), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .limit(1);
    const lot = lotRows[0];
    if (!lot) {
        throw new Error('Lote não encontrado ou inacessível');
    }
    // 3. INSERT — partial UNIQUE (lot_id WHERE deleted_at IS NULL) catches the
    // double-assign race. We wrap in try/catch to surface a UX-quality
    // message instead of the raw Postgres unique-violation.
    let inserted;
    try {
        const rows = await db
            .insert(vendors_1.lotAssignments)
            .values({
            tenantId,
            vendorId: input.vendorId,
            lotId: input.lotId,
            assignedBy: userId,
        })
            .returning();
        inserted = rows[0];
    }
    catch (err) {
        // Walk the error chain — Drizzle wraps the original postgres.js error
        // as `{message: "Failed query: ...", cause: <PostgresError>}`. The
        // constraint name + code 23505 live on `cause`.
        let cur = err;
        let matched = false;
        for (let i = 0; i < 4 && cur != null; i++) {
            const msg = cur instanceof Error ? cur.message : String(cur);
            const code = cur.code;
            if (/lot_assignments_lot_id_active_unique/.test(msg) ||
                /duplicate key/.test(msg) ||
                code === '23505') {
                matched = true;
                break;
            }
            cur = cur.cause;
        }
        if (matched)
            throw new Error('Lote já está atribuído a outro fornecedor');
        throw err;
    }
    if (!inserted)
        throw new Error('assignLotToVendorInTenant: insert returned no row');
    await (0, audit_1.recordAudit)(db, {
        action: 'lot_assignment.created',
        entity: 'lot_assignment',
        entityId: inserted.id,
        userId,
        payload: {
            lotId: input.lotId,
            lotCode: lot.code,
            vendorId: input.vendorId,
            vendorLegalName: vendor.legalName,
        },
    });
    return {
        id: inserted.id,
        tenantId: inserted.tenantId,
        vendorId: inserted.vendorId,
        lotId: inserted.lotId,
        assignedAt: inserted.assignedAt,
        assignedBy: inserted.assignedBy,
    };
}
/**
 * Soft-delete the active assignment for `lotId`. A second assign on the
 * same lot is then unblocked (the partial UNIQUE only catches rows where
 * deleted_at IS NULL).
 */
async function unassignLotInTenant(db, input, userId) {
    const rows = await db
        .update(vendors_1.lotAssignments)
        .set({ deletedAt: new Date() })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.lotAssignments.lotId, input.lotId), (0, drizzle_orm_1.isNull)(vendors_1.lotAssignments.deletedAt)))
        .returning({
        id: vendors_1.lotAssignments.id,
        lotId: vendors_1.lotAssignments.lotId,
        vendorId: vendors_1.lotAssignments.vendorId,
    });
    const row = rows[0];
    if (!row)
        return false;
    await (0, audit_1.recordAudit)(db, {
        action: 'lot_assignment.deleted',
        entity: 'lot_assignment',
        entityId: row.id,
        userId,
        payload: { lotId: row.lotId, vendorId: row.vendorId },
    });
    return true;
}
/**
 * SELECT all active assignments for an event, joined to vendor + lot for the
 * dashboard 01-07 + the planta editor's read-side display.
 */
async function listAssignedLotsInTenant(db, input) {
    const rows = await db
        .select({
        assignmentId: vendors_1.lotAssignments.id,
        lotId: lots_1.lots.id,
        lotCode: lots_1.lots.code,
        vendorId: vendors_1.vendors.id,
        vendorLegalName: vendors_1.vendors.legalName,
        vendorStatus: vendors_1.vendors.status,
        assignedAt: vendors_1.lotAssignments.assignedAt,
    })
        .from(vendors_1.lotAssignments)
        .innerJoin(lots_1.lots, (0, drizzle_orm_1.eq)(lots_1.lots.id, vendors_1.lotAssignments.lotId))
        .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, vendors_1.lotAssignments.vendorId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.eventId, input.eventId), (0, drizzle_orm_1.isNull)(vendors_1.lotAssignments.deletedAt), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .orderBy((0, drizzle_orm_1.asc)(lots_1.lots.code));
    return rows;
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions
// ────────────────────────────────────────────────────────────────────────────
exports.assignLotToVendor = safe_action_1.withTenantAction
    .inputSchema(lot_assignment_1.lotAssignmentCreateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await assignLotToVendorInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)(`/[slug]/eventos`, 'page');
    return row;
});
exports.unassignLot = safe_action_1.withTenantAction
    .inputSchema(lot_assignment_1.lotAssignmentDeleteSchema)
    .action(async ({ ctx, parsedInput }) => {
    const ok = await unassignLotInTenant(ctx.db, parsedInput, ctx.userId);
    if (!ok)
        throw new Error('Atribuição não encontrada');
    return { ok };
});
exports.listAssignedLots = safe_action_1.withTenantAction
    .inputSchema(lot_assignment_1.lotAssignmentEventScopeSchema)
    .action(async ({ ctx, parsedInput }) => {
    return listAssignedLotsInTenant(ctx.db, parsedInput);
});
