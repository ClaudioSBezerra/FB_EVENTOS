"use strict";
// FB_EVENTOS — Cart add-on Zod validators (Phase 2, Plan 02-05, Task 2).
//
// Server Action input schemas for cart add-on management.
// Business rules:
//   - addAddonToCart: vendor selects an add-on for their reservation.
//     max_qty enforced at action level.
//     price snapshot stored at add time.
//   - removeAddonFromCart: vendor removes an add-on line from their cart.
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeAddonSchema = exports.addAddonSchema = void 0;
const zod_1 = require("zod");
/** Add an event add-on to a lot reservation's cart. */
exports.addAddonSchema = zod_1.z.object({
    reservationId: zod_1.z.uuid('Id de reserva inválido'),
    addonId: zod_1.z.uuid('Id de add-on inválido'),
    /** Quantity to add. Defaults to 1. Must be ≥ 1 and ≤ addon.max_qty. */
    quantity: zod_1.z.number().int().min(1).default(1),
});
/** Remove a specific add-on line from a lot reservation's cart. */
exports.removeAddonSchema = zod_1.z.object({
    reservationId: zod_1.z.uuid('Id de reserva inválido'),
    cartAddonLineId: zod_1.z.uuid('Id de linha de add-on inválido'),
});
