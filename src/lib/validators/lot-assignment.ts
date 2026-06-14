// FB_EVENTOS — Lot assignment Zod validators (Phase 1, Plan 01-03 — Task 3).
//
// Schemas for assigning an approved vendor to a lot (one ACTIVE assignment
// per lot — enforced by partial UNIQUE index on lot_assignments(lot_id)
// WHERE deleted_at IS NULL — see migration 0011).

import { z } from 'zod'

export const lotAssignmentCreateSchema = z.object({
  lotId: z.uuid('Id de lote inválido'),
  vendorId: z.uuid('Id de fornecedor inválido'),
})
export type LotAssignmentCreateInput = z.infer<typeof lotAssignmentCreateSchema>

export const lotAssignmentDeleteSchema = z.object({
  lotId: z.uuid('Id de lote inválido'),
})
export type LotAssignmentDeleteInput = z.infer<typeof lotAssignmentDeleteSchema>

export const lotAssignmentEventScopeSchema = z.object({
  eventId: z.uuid('Id de evento inválido'),
})
export type LotAssignmentEventScopeInput = z.infer<typeof lotAssignmentEventScopeSchema>
