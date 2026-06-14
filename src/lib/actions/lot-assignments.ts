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

'use server'

import { and, asc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { lots } from '@/db/schema/lots'
import { lotAssignments, vendors } from '@/db/schema/vendors'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import {
  type LotAssignmentCreateInput,
  type LotAssignmentDeleteInput,
  type LotAssignmentEventScopeInput,
  lotAssignmentCreateSchema,
  lotAssignmentDeleteSchema,
  lotAssignmentEventScopeSchema,
} from '@/lib/validators/lot-assignment'

// ────────────────────────────────────────────────────────────────────────────
// Persisted shapes
// ────────────────────────────────────────────────────────────────────────────

export interface PersistedAssignment {
  id: string
  tenantId: string
  vendorId: string
  lotId: string
  assignedAt: Date
  assignedBy: string | null
}

export interface AssignedLotListItem {
  assignmentId: string
  lotId: string
  lotCode: string
  vendorId: string
  vendorLegalName: string
  vendorStatus: string
  assignedAt: Date
}

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
export async function assignLotToVendorInTenant(
  db: TenantDb,
  tenantId: string,
  input: LotAssignmentCreateInput,
  userId: string,
): Promise<PersistedAssignment> {
  // 1. Verify vendor exists, is in our tenant (RLS), AND has status='approved'.
  const vendorRows = await db
    .select({ id: vendors.id, status: vendors.status, legalName: vendors.legalName })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), isNull(vendors.deletedAt)))
    .limit(1)
  const vendor = vendorRows[0]
  if (!vendor) {
    throw new Error('Fornecedor não encontrado ou inacessível')
  }
  if (vendor.status !== 'approved') {
    throw new Error(
      `Fornecedor precisa estar aprovado para receber atribuição (status atual: ${vendor.status})`,
    )
  }

  // 2. Verify lot exists in our tenant (RLS gate).
  const lotRows = await db
    .select({ id: lots.id, code: lots.code })
    .from(lots)
    .where(and(eq(lots.id, input.lotId), isNull(lots.deletedAt)))
    .limit(1)
  const lot = lotRows[0]
  if (!lot) {
    throw new Error('Lote não encontrado ou inacessível')
  }

  // 3. INSERT — partial UNIQUE (lot_id WHERE deleted_at IS NULL) catches the
  // double-assign race. We wrap in try/catch to surface a UX-quality
  // message instead of the raw Postgres unique-violation.
  let inserted: typeof lotAssignments.$inferSelect | undefined
  try {
    const rows = await db
      .insert(lotAssignments)
      .values({
        tenantId,
        vendorId: input.vendorId,
        lotId: input.lotId,
        assignedBy: userId,
      })
      .returning()
    inserted = rows[0]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/lot_assignments_lot_id_active_unique/.test(msg) || /duplicate key/.test(msg)) {
      throw new Error('Lote já está atribuído a outro fornecedor')
    }
    throw err
  }
  if (!inserted) throw new Error('assignLotToVendorInTenant: insert returned no row')

  await recordAudit(db, {
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
  })

  return {
    id: inserted.id,
    tenantId: inserted.tenantId,
    vendorId: inserted.vendorId,
    lotId: inserted.lotId,
    assignedAt: inserted.assignedAt,
    assignedBy: inserted.assignedBy,
  }
}

/**
 * Soft-delete the active assignment for `lotId`. A second assign on the
 * same lot is then unblocked (the partial UNIQUE only catches rows where
 * deleted_at IS NULL).
 */
export async function unassignLotInTenant(
  db: TenantDb,
  input: LotAssignmentDeleteInput,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .update(lotAssignments)
    .set({ deletedAt: new Date() })
    .where(and(eq(lotAssignments.lotId, input.lotId), isNull(lotAssignments.deletedAt)))
    .returning({
      id: lotAssignments.id,
      lotId: lotAssignments.lotId,
      vendorId: lotAssignments.vendorId,
    })
  const row = rows[0]
  if (!row) return false

  await recordAudit(db, {
    action: 'lot_assignment.deleted',
    entity: 'lot_assignment',
    entityId: row.id,
    userId,
    payload: { lotId: row.lotId, vendorId: row.vendorId },
  })
  return true
}

/**
 * SELECT all active assignments for an event, joined to vendor + lot for the
 * dashboard 01-07 + the planta editor's read-side display.
 */
export async function listAssignedLotsInTenant(
  db: TenantDb,
  input: LotAssignmentEventScopeInput,
): Promise<AssignedLotListItem[]> {
  const rows = await db
    .select({
      assignmentId: lotAssignments.id,
      lotId: lots.id,
      lotCode: lots.code,
      vendorId: vendors.id,
      vendorLegalName: vendors.legalName,
      vendorStatus: vendors.status,
      assignedAt: lotAssignments.assignedAt,
    })
    .from(lotAssignments)
    .innerJoin(lots, eq(lots.id, lotAssignments.lotId))
    .innerJoin(vendors, eq(vendors.id, lotAssignments.vendorId))
    .where(
      and(
        eq(lots.eventId, input.eventId),
        isNull(lotAssignments.deletedAt),
        isNull(lots.deletedAt),
      ),
    )
    .orderBy(asc(lots.code))
  return rows
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions
// ────────────────────────────────────────────────────────────────────────────

export const assignLotToVendor = withTenantAction
  .inputSchema(lotAssignmentCreateSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await assignLotToVendorInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath(`/[slug]/eventos`, 'page')
    return row
  })

export const unassignLot = withTenantAction
  .inputSchema(lotAssignmentDeleteSchema)
  .action(async ({ ctx, parsedInput }) => {
    const ok = await unassignLotInTenant(ctx.db, parsedInput, ctx.userId)
    if (!ok) throw new Error('Atribuição não encontrada')
    return { ok }
  })

export const listAssignedLots = withTenantAction
  .inputSchema(lotAssignmentEventScopeSchema)
  .action(async ({ ctx, parsedInput }) => {
    return listAssignedLotsInTenant(ctx.db, parsedInput)
  })
