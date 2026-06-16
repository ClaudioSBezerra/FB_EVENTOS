"use strict";
// FB_EVENTOS — Pagar.me v5 API types + Zod schemas (Phase 1, Plan 01-06 Task 1).
//
// Phase 2 additions (Plan 02-05):
//   - installments (1..12) in pagarmeCardPaymentSchema.credit_card
//   - statement_descriptor optional in credit_card
//   - pagarmeRefundResponseSchema (DELETE /charges/:id)
//   - REMOVED boleto schema (AM-01 — boleto deferred to Phase 3+)
//   - Extended webhook event types: charge.partial_canceled, order.payment_failed
//
// REFERENCES:
//   - 01-RESEARCH.md §A8 (Pagar.me v5 Simple Charge — Orders/Charges shape +
//     Basic Auth + Webhook event types)
//   - docs.pagar.me/reference (Orders, Charges, eventos-de-webhook-1)
//   - 02-CONTEXT.md AM-01 (boleto deferred), AM-04 (cancelCharge)
//   - 02-PATTERNS.md lines 108-161 (client extensions)
//
// Phase 1 deliberately models the SIMPLE shape:
//   - PIX (with expires_in seconds) — primary path
//   - credit_card with `card_token` (transparent checkout — fornecedor pays
//     in our UI, the form posts to Pagar.me to tokenize, browser receives
//     card_token, then Server Action passes it through)
//   - NO split, NO subscriptions, NO recipients — those land in Phase 2/3
//   - NO boleto — deferred per AM-01
//
// CHARGE STATUS ENUM (per docs.pagar.me):
//   pending → paid | failed | canceled | chargedback | refunded
//
// WEBHOOK EVENT TYPES we care about:
//   order.paid          — order fully paid (every charge paid)
//   charge.paid         — individual charge paid (we have 1 charge/order)
//   charge.payment_failed
//   order.canceled / charge.refunded — terminal failure / refund
//   charge.partial_canceled — partial refund (AM-04)
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagarmeApiError = exports.PagarmeNotConfiguredError = exports.pagarmeWebhookEventSchema = exports.PAGARME_WEBHOOK_EVENT_TYPES = exports.pagarmeRefundResponseSchema = exports.pagarmeOrderResponseSchema = exports.pagarmeChargeSchema = exports.pagarmeLastTransactionSchema = exports.PAGARME_ORDER_STATUSES = exports.PAGARME_CHARGE_STATUSES = exports.pagarmeOrderCreateRequestSchema = exports.pagarmePaymentSchema = exports.pagarmeCardPaymentSchema = exports.pagarmePixPaymentSchema = exports.pagarmeItemSchema = exports.pagarmeCustomerSchema = void 0;
const zod_1 = require("zod");
// ────────────────────────────────────────────────────────────────────────────
// Request — POST /core/v5/orders
// ────────────────────────────────────────────────────────────────────────────
exports.pagarmeCustomerSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    email: zod_1.z.email(),
    /** CPF/CNPJ digits only. */
    document: zod_1.z.string().min(11).max(14),
    type: zod_1.z.enum(['individual', 'company']),
});
exports.pagarmeItemSchema = zod_1.z.object({
    /** Amount in centavos (R$ × 100). Pagar.me ALWAYS expects cents. */
    amount: zod_1.z.number().int().positive(),
    description: zod_1.z.string().min(1).max(255),
    quantity: zod_1.z.number().int().positive(),
});
exports.pagarmePixPaymentSchema = zod_1.z.object({
    payment_method: zod_1.z.literal('pix'),
    pix: zod_1.z.object({
        /** PIX expiry in seconds — 3600 = 1h is the Phase 1 default. */
        expires_in: zod_1.z.number().int().positive(),
    }),
});
exports.pagarmeCardPaymentSchema = zod_1.z.object({
    payment_method: zod_1.z.literal('credit_card'),
    credit_card: zod_1.z.object({
        /**
         * Token obtained client-side via Pagar.me Tokenize API (the browser
         * POSTs raw card data directly to Pagar.me; our app never touches it).
         * Phase 1 simple path: trust the token + pass through.
         */
        card_token: zod_1.z.string().min(1),
        /**
         * Number of installments (1..12). Phase 2 support (FORN-09).
         * Default 1 (single charge) when omitted.
         */
        installments: zod_1.z.number().int().min(1).max(12).optional(),
        /**
         * Statement descriptor shown on the cardholder's bill. Optional — if
         * omitted, Pagar.me uses the merchant account name. Max 22 chars.
         */
        statement_descriptor: zod_1.z.string().max(22).optional(),
    }),
});
exports.pagarmePaymentSchema = zod_1.z.discriminatedUnion('payment_method', [
    exports.pagarmePixPaymentSchema,
    exports.pagarmeCardPaymentSchema,
]);
exports.pagarmeOrderCreateRequestSchema = zod_1.z.object({
    customer: exports.pagarmeCustomerSchema,
    items: zod_1.z.array(exports.pagarmeItemSchema).min(1),
    payments: zod_1.z.array(exports.pagarmePaymentSchema).min(1),
    /** Free-form internal code — we set this to the payment.id. */
    code: zod_1.z.string().optional(),
});
// ────────────────────────────────────────────────────────────────────────────
// Response — POST /core/v5/orders (and GET /core/v5/orders/:id)
// ────────────────────────────────────────────────────────────────────────────
exports.PAGARME_CHARGE_STATUSES = [
    'pending',
    'paid',
    'failed',
    'canceled',
    'chargedback',
    'refunded',
];
exports.PAGARME_ORDER_STATUSES = ['pending', 'paid', 'canceled', 'failed'];
/** Last-transaction shape — contains PIX QR for PIX charges. */
exports.pagarmeLastTransactionSchema = zod_1.z
    .object({
    id: zod_1.z.string().optional(),
    transaction_type: zod_1.z.string().optional(),
    /** PIX copia-cola string. Present on PIX charges. */
    qr_code: zod_1.z.string().optional(),
    /** PIX QR code image URL. Present on PIX charges. */
    qr_code_url: zod_1.z.string().optional(),
    expires_at: zod_1.z.string().optional(),
})
    .passthrough();
exports.pagarmeChargeSchema = zod_1.z
    .object({
    id: zod_1.z.string(),
    status: zod_1.z.string(),
    payment_method: zod_1.z.string().optional(),
    amount: zod_1.z.number().int().optional(),
    last_transaction: exports.pagarmeLastTransactionSchema.optional(),
    paid_at: zod_1.z.string().nullable().optional(),
})
    .passthrough();
exports.pagarmeOrderResponseSchema = zod_1.z
    .object({
    id: zod_1.z.string(),
    code: zod_1.z.string().optional(),
    status: zod_1.z.string(),
    amount: zod_1.z.number().int().optional(),
    currency: zod_1.z.string().optional(),
    customer: zod_1.z
        .object({
        id: zod_1.z.string().optional(),
        email: zod_1.z.email().optional(),
    })
        .passthrough()
        .optional(),
    charges: zod_1.z.array(exports.pagarmeChargeSchema).min(1),
    created_at: zod_1.z.string().optional(),
})
    .passthrough();
// ────────────────────────────────────────────────────────────────────────────
// Webhook — POST /api/webhooks/pagarme
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// Refund / Cancel — DELETE /core/v5/charges/:id (AM-04)
// ────────────────────────────────────────────────────────────────────────────
/**
 * Response shape for DELETE /core/v5/charges/:id (cancel or partial refund).
 * Pagar.me v5 returns the charge with updated status.
 *
 * For full cancellations: status → 'canceled'
 * For partial refunds: status → 'partial_canceled' or 'refunded'
 */
exports.pagarmeRefundResponseSchema = zod_1.z
    .object({
    id: zod_1.z.string(),
    status: zod_1.z.string(),
    amount: zod_1.z.number().int().optional(),
    /** Amount that was actually refunded, in centavos. */
    amount_refunded: zod_1.z.number().int().optional(),
})
    .passthrough();
exports.PAGARME_WEBHOOK_EVENT_TYPES = [
    'order.paid',
    'order.payment_failed',
    'order.canceled',
    'charge.paid',
    'charge.payment_failed',
    'charge.refunded',
    'charge.partial_canceled',
];
exports.pagarmeWebhookEventSchema = zod_1.z
    .object({
    /** Webhook event id — we use it as the dedup key. */
    id: zod_1.z.string(),
    type: zod_1.z.string(),
    /** Order or charge payload, depending on event type. */
    data: zod_1.z
        .object({
        id: zod_1.z.string().optional(),
        status: zod_1.z.string().optional(),
        code: zod_1.z.string().optional(),
    })
        .passthrough()
        .optional(),
    created_at: zod_1.z.string().optional(),
})
    .passthrough();
// ────────────────────────────────────────────────────────────────────────────
// Domain errors
// ────────────────────────────────────────────────────────────────────────────
class PagarmeNotConfiguredError extends Error {
    constructor() {
        super('PAGARME_SECRET_KEY is not configured — set it via .env.local or Coolify env');
        this.name = 'PagarmeNotConfiguredError';
    }
}
exports.PagarmeNotConfiguredError = PagarmeNotConfiguredError;
class PagarmeApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`Pagar.me API ${status}: ${body}`);
        this.status = status;
        this.body = body;
        this.name = 'PagarmeApiError';
    }
}
exports.PagarmeApiError = PagarmeApiError;
