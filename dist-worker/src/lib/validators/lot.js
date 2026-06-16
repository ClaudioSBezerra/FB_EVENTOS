"use strict";
// FB_EVENTOS — Lot Zod validators (Phase 1, Plan 01-03 — Task 1).
//
// Schemas:
//   - lotCreateSchema       — create a lot (caller supplies eventId, categoryId,
//                             code, geometry; area_m² is RE-COMPUTED server-side
//                             from polygon points via shoelace — never trust
//                             client-supplied area).
//   - lotUpdateGeometrySchema — auto-save partial: { lotId, geometry }.
//   - lotIdSchema           — uuid identifier (for delete + assignment lookups).
//
// Code uniqueness: enforced per-event in DB layer; Zod just validates shape
// (1..40 chars, ascii printable). Empty / blank codes rejected.
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotUpdateStatusSchema = exports.lotEventScopeSchema = exports.lotIdSchema = exports.lotUpdateGeometrySchema = exports.lotCreateSchema = void 0;
const zod_1 = require("zod");
const geometry_1 = require("./geometry");
const lotCode = zod_1.z
    .string()
    .trim()
    .min(1, 'Código do lote é obrigatório')
    .max(40, 'Código do lote deve ter no máximo 40 caracteres')
    .regex(/^[\w\- ./]+$/, 'Código do lote contém caracteres inválidos');
const lotStatus = zod_1.z.enum(['available', 'reserved', 'sold']);
exports.lotCreateSchema = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
    categoryId: zod_1.z.uuid('Id de categoria inválido'),
    code: lotCode,
    geometry: geometry_1.geometrySchema,
});
exports.lotUpdateGeometrySchema = zod_1.z.object({
    lotId: zod_1.z.uuid('Id de lote inválido'),
    geometry: geometry_1.geometrySchema,
});
exports.lotIdSchema = zod_1.z.object({
    lotId: zod_1.z.uuid('Id de lote inválido'),
});
exports.lotEventScopeSchema = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
});
exports.lotUpdateStatusSchema = zod_1.z.object({
    lotId: zod_1.z.uuid('Id de lote inválido'),
    status: lotStatus,
});
