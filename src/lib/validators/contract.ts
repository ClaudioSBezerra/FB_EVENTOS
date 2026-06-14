// FB_EVENTOS — Contract Zod validators (Phase 1, Plan 01-05 Task 2).

import { z } from 'zod'

export const emitContractSchema = z.object({
  lotAssignmentId: z.uuid('Id de atribuição inválido'),
})
export type EmitContractInput = z.infer<typeof emitContractSchema>

export const listContractsSchema = z.object({
  eventId: z.uuid().optional(),
  status: z
    .enum(['draft', 'awaiting_org', 'awaiting_fornecedor', 'signed', 'expired', 'cancelled'])
    .optional(),
})
export type ListContractsInput = z.infer<typeof listContractsSchema>

export const contractIdSchema = z.object({
  contractId: z.uuid('Id de contrato inválido'),
})
export type ContractIdInput = z.infer<typeof contractIdSchema>
