// FB_EVENTOS — Reservation input validators (Phase 2, Plan 02-03).
//
// Zod schema for the reserveLot Server Action input. Three UUID fields:
//   - eventId  — the event the lot belongs to
//   - lotId    — the specific lot the vendor wants to reserve
//   - vendorId — the vendor's own ID (cross-checked against session in the action)
//
// REFERENCES:
//   - 02-03-PLAN.md Task 1 <action>
//   - src/lib/actions/reservations.ts (consumer)

import { z } from 'zod'

export const reserveLotSchema = z.object({
  eventId: z.string().uuid(),
  lotId: z.string().uuid(),
  vendorId: z.string().uuid(),
})

export type ReserveLotInput = z.infer<typeof reserveLotSchema>
