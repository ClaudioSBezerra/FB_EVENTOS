"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reserveLotSchema = void 0;
const zod_1 = require("zod");
exports.reserveLotSchema = zod_1.z.object({
    eventId: zod_1.z.string().uuid(),
    lotId: zod_1.z.string().uuid(),
    vendorId: zod_1.z.string().uuid(),
});
