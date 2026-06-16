"use strict";
// FB_EVENTOS — Lot assignment Zod validators (Phase 1, Plan 01-03 — Task 3).
//
// Schemas for assigning an approved vendor to a lot (one ACTIVE assignment
// per lot — enforced by partial UNIQUE index on lot_assignments(lot_id)
// WHERE deleted_at IS NULL — see migration 0011).
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotAssignmentEventScopeSchema = exports.lotAssignmentDeleteSchema = exports.lotAssignmentCreateSchema = void 0;
const zod_1 = require("zod");
exports.lotAssignmentCreateSchema = zod_1.z.object({
    lotId: zod_1.z.uuid('Id de lote inválido'),
    vendorId: zod_1.z.uuid('Id de fornecedor inválido'),
});
exports.lotAssignmentDeleteSchema = zod_1.z.object({
    lotId: zod_1.z.uuid('Id de lote inválido'),
});
exports.lotAssignmentEventScopeSchema = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
});
