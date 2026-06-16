"use strict";
// FB_EVENTOS — Aditivo pricing helper (Phase 1, Plan 01-03 — Task 3).
//
// Single source of truth for the ADR-0003 formula:
//
//   lot.price = category.base_fixed + lot.area_m² × category.per_sqm_rate
//
// Both `base_fixed` and `per_sqm_rate` are persisted as numeric and may
// arrive as string (postgres.js default mapping) or number (already coerced
// by our actions). This helper accepts either and always returns a JS number
// rounded to centavos (2 dp).
//
// REFERENCES:
//   - docs/adr/0003-pricing-model.md
//   - 01-CONTEXT.md D-09
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeLotPrice = computeLotPrice;
exports.formatBRL = formatBRL;
function toNumber(v) {
    return typeof v === 'string' ? Number(v) : v;
}
/**
 * Aditivo lot pricing. Returns the price in BRL (R$) rounded to 2 dp.
 *
 * Edge cases:
 *   - base=0 + per_sqm=R$50/m² + area=4m² → R$200.00
 *   - base=R$1000 + per_sqm=0           → R$1000.00 (area ignored)
 *   - base=R$500 + per_sqm=R$30 + area=10m² → R$800.00 (500 + 300)
 *   - base=0 + per_sqm=0                → R$0.00 (free lot)
 */
function computeLotPrice(category, lot) {
    const base = toNumber(category.baseFixed);
    const rate = toNumber(category.perSqmRate);
    const area = toNumber(lot.areaM2);
    const total = base + area * rate;
    // Round to centavos (2 dp) to avoid 0.1 + 0.2 drift surfacing in UI.
    return Math.round(total * 100) / 100;
}
/**
 * Format a BRL number for UI display: "R$ 1.234,56" (pt-BR locale).
 */
function formatBRL(value) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value);
}
