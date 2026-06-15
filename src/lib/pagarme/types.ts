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

import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────────────
// Request — POST /core/v5/orders
// ────────────────────────────────────────────────────────────────────────────

export const pagarmeCustomerSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  /** CPF/CNPJ digits only. */
  document: z.string().min(11).max(14),
  type: z.enum(['individual', 'company']),
})
export type PagarmeCustomer = z.infer<typeof pagarmeCustomerSchema>

export const pagarmeItemSchema = z.object({
  /** Amount in centavos (R$ × 100). Pagar.me ALWAYS expects cents. */
  amount: z.number().int().positive(),
  description: z.string().min(1).max(255),
  quantity: z.number().int().positive(),
})
export type PagarmeItem = z.infer<typeof pagarmeItemSchema>

export const pagarmePixPaymentSchema = z.object({
  payment_method: z.literal('pix'),
  pix: z.object({
    /** PIX expiry in seconds — 3600 = 1h is the Phase 1 default. */
    expires_in: z.number().int().positive(),
  }),
})

export const pagarmeCardPaymentSchema = z.object({
  payment_method: z.literal('credit_card'),
  credit_card: z.object({
    /**
     * Token obtained client-side via Pagar.me Tokenize API (the browser
     * POSTs raw card data directly to Pagar.me; our app never touches it).
     * Phase 1 simple path: trust the token + pass through.
     */
    card_token: z.string().min(1),
    /**
     * Number of installments (1..12). Phase 2 support (FORN-09).
     * Default 1 (single charge) when omitted.
     */
    installments: z.number().int().min(1).max(12).optional(),
    /**
     * Statement descriptor shown on the cardholder's bill. Optional — if
     * omitted, Pagar.me uses the merchant account name. Max 22 chars.
     */
    statement_descriptor: z.string().max(22).optional(),
  }),
})

export const pagarmePaymentSchema = z.discriminatedUnion('payment_method', [
  pagarmePixPaymentSchema,
  pagarmeCardPaymentSchema,
])
export type PagarmePayment = z.infer<typeof pagarmePaymentSchema>

export const pagarmeOrderCreateRequestSchema = z.object({
  customer: pagarmeCustomerSchema,
  items: z.array(pagarmeItemSchema).min(1),
  payments: z.array(pagarmePaymentSchema).min(1),
  /** Free-form internal code — we set this to the payment.id. */
  code: z.string().optional(),
})
export type PagarmeOrderCreateRequest = z.infer<typeof pagarmeOrderCreateRequestSchema>

// ────────────────────────────────────────────────────────────────────────────
// Response — POST /core/v5/orders (and GET /core/v5/orders/:id)
// ────────────────────────────────────────────────────────────────────────────

export const PAGARME_CHARGE_STATUSES = [
  'pending',
  'paid',
  'failed',
  'canceled',
  'chargedback',
  'refunded',
] as const
export type PagarmeChargeStatus = (typeof PAGARME_CHARGE_STATUSES)[number]

export const PAGARME_ORDER_STATUSES = ['pending', 'paid', 'canceled', 'failed'] as const
export type PagarmeOrderStatus = (typeof PAGARME_ORDER_STATUSES)[number]

/** Last-transaction shape — contains PIX QR for PIX charges. */
export const pagarmeLastTransactionSchema = z
  .object({
    id: z.string().optional(),
    transaction_type: z.string().optional(),
    /** PIX copia-cola string. Present on PIX charges. */
    qr_code: z.string().optional(),
    /** PIX QR code image URL. Present on PIX charges. */
    qr_code_url: z.string().optional(),
    expires_at: z.string().optional(),
  })
  .passthrough()
export type PagarmeLastTransaction = z.infer<typeof pagarmeLastTransactionSchema>

export const pagarmeChargeSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    payment_method: z.string().optional(),
    amount: z.number().int().optional(),
    last_transaction: pagarmeLastTransactionSchema.optional(),
    paid_at: z.string().nullable().optional(),
  })
  .passthrough()
export type PagarmeCharge = z.infer<typeof pagarmeChargeSchema>

export const pagarmeOrderResponseSchema = z
  .object({
    id: z.string(),
    code: z.string().optional(),
    status: z.string(),
    amount: z.number().int().optional(),
    currency: z.string().optional(),
    customer: z
      .object({
        id: z.string().optional(),
        email: z.email().optional(),
      })
      .passthrough()
      .optional(),
    charges: z.array(pagarmeChargeSchema).min(1),
    created_at: z.string().optional(),
  })
  .passthrough()
export type PagarmeOrderResponse = z.infer<typeof pagarmeOrderResponseSchema>

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
export const pagarmeRefundResponseSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    amount: z.number().int().optional(),
    /** Amount that was actually refunded, in centavos. */
    amount_refunded: z.number().int().optional(),
  })
  .passthrough()
export type PagarmeRefundResponse = z.infer<typeof pagarmeRefundResponseSchema>

export const PAGARME_WEBHOOK_EVENT_TYPES = [
  'order.paid',
  'order.payment_failed',
  'order.canceled',
  'charge.paid',
  'charge.payment_failed',
  'charge.refunded',
  'charge.partial_canceled',
] as const
export type PagarmeWebhookEventType = (typeof PAGARME_WEBHOOK_EVENT_TYPES)[number]

export const pagarmeWebhookEventSchema = z
  .object({
    /** Webhook event id — we use it as the dedup key. */
    id: z.string(),
    type: z.string(),
    /** Order or charge payload, depending on event type. */
    data: z
      .object({
        id: z.string().optional(),
        status: z.string().optional(),
        code: z.string().optional(),
      })
      .passthrough()
      .optional(),
    created_at: z.string().optional(),
  })
  .passthrough()
export type PagarmeWebhookEvent = z.infer<typeof pagarmeWebhookEventSchema>

// ────────────────────────────────────────────────────────────────────────────
// Domain errors
// ────────────────────────────────────────────────────────────────────────────

export class PagarmeNotConfiguredError extends Error {
  constructor() {
    super('PAGARME_SECRET_KEY is not configured — set it via .env.local or Coolify env')
    this.name = 'PagarmeNotConfiguredError'
  }
}

export class PagarmeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Pagar.me API ${status}: ${body}`)
    this.name = 'PagarmeApiError'
  }
}
