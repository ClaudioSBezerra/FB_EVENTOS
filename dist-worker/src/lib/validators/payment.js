"use strict";
// FB_EVENTOS — Payment Zod validators (Phase 1, Plan 01-06 Task 1).
//
// Server Action input schemas. The Pagar.me API request bodies live in
// src/lib/pagarme/types.ts — these schemas are the BUSINESS-LEVEL inputs
// the organizadora sees through createCharge() / listPayments().
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentIdSchema = exports.listPaymentsSchema = exports.createChargeSchema = void 0;
const zod_1 = require("zod");
exports.createChargeSchema = zod_1.z
    .object({
    contractId: zod_1.z.uuid('Id de contrato inválido'),
    method: zod_1.z.enum(['pix', 'credit_card'], {
        error: 'Método de pagamento inválido (use "pix" ou "credit_card")',
    }),
    /** Amount in centavos (R$ × 100). Pagar.me expects cents. */
    amount_brl_cents: zod_1.z
        .number()
        .int('Valor deve ser um inteiro em centavos')
        .positive('Valor deve ser positivo'),
    /** REQUIRED when method=credit_card; obtained client-side via Pagar.me tokenize. */
    card_token: zod_1.z.string().min(1).optional(),
})
    .refine((v) => v.method !== 'credit_card' || (v.card_token && v.card_token.length > 0), {
    message: 'card_token é obrigatório para pagamento com cartão de crédito',
    path: ['card_token'],
});
exports.listPaymentsSchema = zod_1.z.object({
    contractId: zod_1.z.uuid().optional(),
});
exports.paymentIdSchema = zod_1.z.object({
    paymentId: zod_1.z.uuid('Id de pagamento inválido'),
});
