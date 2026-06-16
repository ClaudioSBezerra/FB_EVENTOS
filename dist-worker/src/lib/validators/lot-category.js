"use strict";
// FB_EVENTOS — Lot category Zod validators
// (Phase 1, Plan 01-03 — Task 3).
//
// Aditivo pricing model (ADR-0003 + D-09):
//   lot.price = base_fixed + lot.area_m² × per_sqm_rate
//
// Both numerics are NOT NULL DEFAULT 0 in the DB — either or both can be
// zero. Validation accepts:
//   - base_fixed only (R$ flat per lot, ignores area)
//   - per_sqm_rate only (R$/m², scales with polygon area)
//   - both (hybrid)
//   - neither (a "free" category — useful for prestadores who don't pay)
Object.defineProperty(exports, "__esModule", { value: true });
exports.lotCategoryEventScopeSchema = exports.lotCategoryIdSchema = exports.lotCategoryUpdateSchema = exports.lotCategoryCreateSchema = void 0;
const zod_1 = require("zod");
const categoryName = zod_1.z
    .string()
    .trim()
    .min(1, 'Nome da categoria é obrigatório')
    .max(80, 'Nome da categoria deve ter no máximo 80 caracteres');
// numeric in postgres maps to string; we accept number for ergonomics
// and coerce. Zod 4 union with z.coerce gives a clean DX in RHF.
const moneyNumeric = zod_1.z
    .union([zod_1.z.number(), zod_1.z.string()])
    .transform((v) => (typeof v === 'string' ? Number(v) : v))
    .refine((v) => Number.isFinite(v), 'Valor inválido')
    .refine((v) => v >= 0, 'Valor não pode ser negativo')
    .refine((v) => v <= 9_999_999.99, 'Valor excede o limite de R$ 9.999.999,99');
const hexColor = zod_1.z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve ser hex #RRGGBB')
    .optional()
    .nullable();
exports.lotCategoryCreateSchema = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
    name: categoryName,
    baseFixed: moneyNumeric,
    perSqmRate: moneyNumeric,
    color: hexColor,
});
exports.lotCategoryUpdateSchema = zod_1.z.object({
    id: zod_1.z.uuid('Id de categoria inválido'),
    name: categoryName.optional(),
    baseFixed: moneyNumeric.optional(),
    perSqmRate: moneyNumeric.optional(),
    color: hexColor,
});
exports.lotCategoryIdSchema = zod_1.z.object({
    id: zod_1.z.uuid('Id de categoria inválido'),
});
exports.lotCategoryEventScopeSchema = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
});
