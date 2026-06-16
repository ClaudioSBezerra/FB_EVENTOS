"use strict";
// FB_EVENTOS — Dashboard Zod validators (Phase 1, Plan 01-07 Task 1).
//
// Server Action input schemas for the occupancy + financial dashboards.
// Every read action is scoped by `eventId` — the dashboard is per-event.
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardEventScopeSchema = void 0;
const zod_1 = require("zod");
exports.dashboardEventScopeSchema = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
});
