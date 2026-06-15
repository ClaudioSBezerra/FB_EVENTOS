// FB_EVENTOS — Cart add-on Zod validators (Phase 2, Plan 02-05, Task 2).
//
// Server Action input schemas for cart add-on management.
// Business rules:
//   - addAddonToCart: vendor selects an add-on for their reservation.
//     max_qty enforced at action level.
//     price snapshot stored at add time.
//   - removeAddonFromCart: vendor removes an add-on line from their cart.

import { z } from 'zod'

/** Add an event add-on to a lot reservation's cart. */
export const addAddonSchema = z.object({
  reservationId: z.uuid('Id de reserva inválido'),
  addonId: z.uuid('Id de add-on inválido'),
  /** Quantity to add. Defaults to 1. Must be ≥ 1 and ≤ addon.max_qty. */
  quantity: z.number().int().min(1).default(1),
})
export type AddAddonInput = z.infer<typeof addAddonSchema>

/** Remove a specific add-on line from a lot reservation's cart. */
export const removeAddonSchema = z.object({
  reservationId: z.uuid('Id de reserva inválido'),
  cartAddonLineId: z.uuid('Id de linha de add-on inválido'),
})
export type RemoveAddonInput = z.infer<typeof removeAddonSchema>
