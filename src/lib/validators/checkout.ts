// FB_EVENTOS — Checkout Zod validators (Phase 2, Plan 02-05, Task 3).
//
// Server Action input schemas for the FORN-09 checkout flow.
//
// NO boleto branch — AM-01 deferred to Phase 3+.
// PIX: no extra fields beyond reservationId + method.
// credit_card: requires card_token + optional installments (1..12).

import { z } from 'zod'

/** Start checkout for a lot reservation. */
export const checkoutCartSchema = z.object({
  reservationId: z.uuid('Id de reserva inválido'),
  method: z.enum(['pix', 'credit_card']),
  /** Required for credit_card. Client-side token from Pagar.me Tokenize API. */
  cardToken: z.string().optional(),
  /** Number of installments (1..12). Default 1. Only for credit_card. */
  installments: z.number().int().min(1).max(12).optional(),
})
export type CheckoutCartInput = z.infer<typeof checkoutCartSchema>
