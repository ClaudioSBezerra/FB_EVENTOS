// FB_EVENTOS — Payment Zod validators (Phase 1, Plan 01-06 Task 1).
//
// Server Action input schemas. The Pagar.me API request bodies live in
// src/lib/pagarme/types.ts — these schemas are the BUSINESS-LEVEL inputs
// the organizadora sees through createCharge() / listPayments().

import { z } from 'zod'

export const createChargeSchema = z
  .object({
    contractId: z.uuid('Id de contrato inválido'),
    method: z.enum(['pix', 'credit_card'], {
      error: 'Método de pagamento inválido (use "pix" ou "credit_card")',
    }),
    /** Amount in centavos (R$ × 100). Pagar.me expects cents. */
    amount_brl_cents: z
      .number()
      .int('Valor deve ser um inteiro em centavos')
      .positive('Valor deve ser positivo'),
    /** REQUIRED when method=credit_card; obtained client-side via Pagar.me tokenize. */
    card_token: z.string().min(1).optional(),
  })
  .refine((v) => v.method !== 'credit_card' || (v.card_token && v.card_token.length > 0), {
    message: 'card_token é obrigatório para pagamento com cartão de crédito',
    path: ['card_token'],
  })
export type CreateChargeInput = z.infer<typeof createChargeSchema>

export const listPaymentsSchema = z.object({
  contractId: z.uuid().optional(),
})
export type ListPaymentsInput = z.infer<typeof listPaymentsSchema>

export const paymentIdSchema = z.object({
  paymentId: z.uuid('Id de pagamento inválido'),
})
export type PaymentIdInput = z.infer<typeof paymentIdSchema>
