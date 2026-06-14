// FB_EVENTOS — ZapSign API types + Zod schemas (Phase 1, Plan 01-05 Task 2).
//
// REFERENCES:
//   - 01-RESEARCH.md §A7 (ZapSign REST + Sequential Sign)
//   - docs.zapsign.com.br/english/documentos/criar-documento
//   - docs.zapsign.com.br/ambiente-de-testes (sandbox via URL only)
//
// Sequential signature contract (D-02):
//   - signature_order_active = true
//   - order_group: 1 (organizadora) signs first; ZapSign automatically
//     fires email to order_group=2 (fornecedor) only after the first signer
//     completes — eliminating the "wrong contract sent to fornecedor" risk.
//   - send_automatic_email: true on organizadora (immediate). The fornecedor
//     row carries true as well; ZapSign honors order_group for actual send
//     timing regardless of this flag (per RESEARCH §A7 verification).

import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────────────
// Request — POST /api/v1/docs/
// ────────────────────────────────────────────────────────────────────────────

export const zapsignSignerInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  order_group: z.number().int().positive(),
  /**
   * `send_automatic_email`: tells ZapSign whether to fire the invite email
   * for this signer. With `signature_order_active=true`, ZapSign fires the
   * email for order_group=2 only after order_group=1 completes — so the
   * flag is effectively informational past the first signer.
   */
  send_automatic_email: z.boolean().default(true),
})
export type ZapsignSignerInput = z.infer<typeof zapsignSignerInputSchema>

export const zapsignCreateDocRequestSchema = z.object({
  name: z.string().min(1).max(255),
  /** Public/signed URL to the source PDF — we pass a MinIO pre-signed GET. */
  url_pdf: z.string().url(),
  signers: z.array(zapsignSignerInputSchema).min(1),
  /** D-02 sequential — always true in Phase 1. */
  signature_order_active: z.literal(true),
  lang: z.literal('pt-br').default('pt-br'),
  /** Echoed back on every webhook — we use contracts.id so we can correlate. */
  external_id: z.string().uuid(),
})
export type ZapsignCreateDocRequest = z.infer<typeof zapsignCreateDocRequestSchema>

// ────────────────────────────────────────────────────────────────────────────
// Response — POST /api/v1/docs/ (and GET /api/v1/docs/:token/)
// ────────────────────────────────────────────────────────────────────────────

export const zapsignSignerResponseSchema = z
  .object({
    token: z.string(),
    sign_url: z.string().url().nullable().optional(),
    status: z.string(),
    name: z.string(),
    email: z.string().email().nullable().optional(),
    order_group: z.number().int().optional(),
    signed_at: z.string().nullable().optional(),
  })
  .passthrough()
export type ZapsignSignerResponse = z.infer<typeof zapsignSignerResponseSchema>

export const zapsignCreateDocResponseSchema = z
  .object({
    open_id: z.number().int(),
    token: z.string(),
    status: z.string(),
    name: z.string(),
    original_file: z.string().url().nullable().optional(),
    signed_file: z.string().url().nullable().optional(),
    signers: z.array(zapsignSignerResponseSchema),
  })
  .passthrough()
export type ZapsignCreateDocResponse = z.infer<typeof zapsignCreateDocResponseSchema>

// ────────────────────────────────────────────────────────────────────────────
// Webhook — POST /api/webhooks/zapsign
// ────────────────────────────────────────────────────────────────────────────

/**
 * ZapSign webhook event types (subset Phase 1 cares about). Other event
 * types (`viewed`, `email_bounce`, `doc_created`, etc.) are accepted by
 * the route handler but routed to a no-op state transition.
 *
 * Per RESEARCH §A7 the doc_signed event fires both for individual
 * signer-completions AND for the final all-signed completion. The handler
 * differentiates by inspecting the re-fetched document status.
 */
export const ZAPSIGN_WEBHOOK_EVENT_TYPES = [
  'doc_signed',
  'doc_refused',
  'doc_expired',
  'doc_deleted',
  'viewed',
  'doc_created',
  'email_bounce',
] as const
export type ZapsignWebhookEventType = (typeof ZAPSIGN_WEBHOOK_EVENT_TYPES)[number]

export const zapsignWebhookPayloadSchema = z
  .object({
    event_type: z.string(),
    open_id: z.number().int().optional(),
    token: z.string(),
    status: z.string().optional(),
    external_id: z.string().nullable().optional(),
    signed_file: z.string().url().nullable().optional(),
    signers: z.array(zapsignSignerResponseSchema).optional(),
    sandbox: z.boolean().optional(),
  })
  .passthrough()
export type ZapsignWebhookPayload = z.infer<typeof zapsignWebhookPayloadSchema>

// ────────────────────────────────────────────────────────────────────────────
// Domain errors
// ────────────────────────────────────────────────────────────────────────────

export class ZapsignNotConfiguredError extends Error {
  constructor() {
    super('ZAPSIGN_TOKEN is not configured — set it via .env.local or Coolify env')
    this.name = 'ZapsignNotConfiguredError'
  }
}

export class ZapsignApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`ZapSign API ${status}: ${body}`)
    this.name = 'ZapsignApiError'
  }
}
