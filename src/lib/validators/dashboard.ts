// FB_EVENTOS — Dashboard Zod validators (Phase 1, Plan 01-07 Task 1).
//
// Server Action input schemas for the occupancy + financial dashboards.
// Every read action is scoped by `eventId` — the dashboard is per-event.

import { z } from 'zod'

export const dashboardEventScopeSchema = z.object({
  eventId: z.uuid('Id de evento inválido'),
})
export type DashboardEventScopeInput = z.infer<typeof dashboardEventScopeSchema>
