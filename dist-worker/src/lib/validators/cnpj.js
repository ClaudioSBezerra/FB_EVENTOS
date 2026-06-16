"use strict";
// FB_EVENTOS — CNPJ validators (Phase 1, Plan 01-04 — Task 1).
//
// Two-layer CNPJ validation (D-16):
//   Layer 1 — client-side regex + mod-11 check digits via `cnpjSchema` Zod
//             schema (FAST, no network round-trip; catches typos at form
//             submit time).
//   Layer 2 — Server Action `lookupCNPJ` in src/lib/actions/brasilapi.ts
//             calls BrasilAPI to confirm `situacao_cadastral === 2` (ATIVA)
//             with 7-day cache + degradation handling.
//
// FORMATS ACCEPTED at Layer 1:
//   - "XX.XXX.XXX/XXXX-XX" (formatted)
//   - "XXXXXXXXXXXXXX"     (14 raw digits)
//   Both normalize to 14 digits before persisting.
//
// CHECK-DIGITS ALGORITHM (mod-11 per Receita Federal):
//   - First DV uses weights [5,4,3,2,9,8,7,6,5,4,3,2] on positions 1-12.
//   - Second DV uses weights [6,5,4,3,2,9,8,7,6,5,4,3,2] on positions 1-13.
//   - sum modulo 11 < 2 → digit = 0, else digit = 11 - (sum mod 11).
//   - All-equal CNPJs (00000000000000, 11111111111111, …) are REJECTED
//     even though they pass mod-11 — they are obviously bogus.
//
// REFERENCES:
//   - 01-CONTEXT.md D-16 (2-layer validation)
//   - 01-RESEARCH.md §A3 / §A10 (BrasilAPI response shape; situacao_cadastral = 2 is ATIVA)
//   - Receita Federal CNPJ check-digits spec (mod-11)
Object.defineProperty(exports, "__esModule", { value: true });
exports.cnpjSchema = exports.cnpjRegex = exports.cnpjDigitsRegex = exports.cnpjFormattedRegex = void 0;
exports.normalizeCNPJ = normalizeCNPJ;
exports.formatCNPJ = formatCNPJ;
exports.redactCNPJ = redactCNPJ;
exports.validateCheckDigits = validateCheckDigits;
const zod_1 = require("zod");
// ────────────────────────────────────────────────────────────────────────────
// Regex — accepts both formatted and raw 14-digit forms
// ────────────────────────────────────────────────────────────────────────────
/** Matches "XX.XXX.XXX/XXXX-XX" exactly. */
exports.cnpjFormattedRegex = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
/** Matches 14 raw digits exactly. */
exports.cnpjDigitsRegex = /^\d{14}$/;
/** Matches either form (load-bearing for client-side fast-fail check). */
exports.cnpjRegex = /^(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})$/;
// ────────────────────────────────────────────────────────────────────────────
// Normalization
// ────────────────────────────────────────────────────────────────────────────
/** Strip non-digits from a CNPJ string. Returns the 14-digit form (or fewer if invalid). */
function normalizeCNPJ(cnpj) {
    return cnpj.replace(/\D/g, '');
}
/** Format a 14-digit CNPJ as "XX.XXX.XXX/XXXX-XX". Returns input unchanged if not 14 digits. */
function formatCNPJ(cnpj) {
    const d = normalizeCNPJ(cnpj);
    if (d.length !== 14)
        return cnpj;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}
/** Return only the last 4 digits + masked prefix — safe for audit / logs. */
function redactCNPJ(cnpj) {
    const d = normalizeCNPJ(cnpj);
    if (d.length !== 14)
        return '****';
    return `**.***.***/****-${d.slice(12, 14)}`;
}
// ────────────────────────────────────────────────────────────────────────────
// Mod-11 check-digit validation (pure function)
// ────────────────────────────────────────────────────────────────────────────
const DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
function calcDigit(digits, weights) {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
        const d = digits[i];
        const w = weights[i];
        if (d === undefined || w === undefined)
            continue;
        sum += Number(d) * w;
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
}
/**
 * Validate the mod-11 check digits of a CNPJ. Accepts either format —
 * normalizes internally. Returns false for:
 *   - non-string / non-14-digits input
 *   - all-equal sequences (00000000000000, 11111111111111, …)
 *   - invalid mod-11 check digits
 */
function validateCheckDigits(cnpj) {
    if (typeof cnpj !== 'string')
        return false;
    const d = normalizeCNPJ(cnpj);
    if (d.length !== 14)
        return false;
    if (!/^\d{14}$/.test(d))
        return false;
    // Reject the all-equal classic bogus sequences (they pass mod-11).
    if (/^(\d)\1{13}$/.test(d))
        return false;
    const dv1 = calcDigit(d.slice(0, 12), DV1_WEIGHTS);
    if (dv1 !== Number(d[12]))
        return false;
    const dv2 = calcDigit(d.slice(0, 13), DV2_WEIGHTS);
    if (dv2 !== Number(d[13]))
        return false;
    return true;
}
// ────────────────────────────────────────────────────────────────────────────
// Zod schema — accepts both formats, validates regex + check digits
// ────────────────────────────────────────────────────────────────────────────
/**
 * Zod schema accepting either "XX.XXX.XXX/XXXX-XX" or "XXXXXXXXXXXXXX".
 * On success the parsed value is normalized to 14 raw digits.
 */
exports.cnpjSchema = zod_1.z
    .string()
    .trim()
    .refine((v) => exports.cnpjRegex.test(v), {
    message: 'CNPJ deve estar no formato XX.XXX.XXX/XXXX-XX ou 14 dígitos',
})
    .refine((v) => validateCheckDigits(v), {
    message: 'CNPJ inválido (dígitos verificadores)',
})
    .transform((v) => normalizeCNPJ(v));
