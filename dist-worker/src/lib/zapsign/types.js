"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZapsignApiError = exports.ZapsignNotConfiguredError = exports.zapsignWebhookPayloadSchema = exports.ZAPSIGN_WEBHOOK_EVENT_TYPES = exports.zapsignCreateDocResponseSchema = exports.zapsignSignerResponseSchema = exports.zapsignCreateDocRequestSchema = exports.zapsignSignerInputSchema = void 0;
const zod_1 = require("zod");
// ────────────────────────────────────────────────────────────────────────────
// Request — POST /api/v1/docs/
// ────────────────────────────────────────────────────────────────────────────
exports.zapsignSignerInputSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    email: zod_1.z.string().email(),
    order_group: zod_1.z.number().int().positive(),
    /**
     * `send_automatic_email`: tells ZapSign whether to fire the invite email
     * for this signer. With `signature_order_active=true`, ZapSign fires the
     * email for order_group=2 only after order_group=1 completes — so the
     * flag is effectively informational past the first signer.
     */
    send_automatic_email: zod_1.z.boolean().default(true),
});
exports.zapsignCreateDocRequestSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255),
    /** Public/signed URL to the source PDF — we pass a MinIO pre-signed GET. */
    url_pdf: zod_1.z.string().url(),
    signers: zod_1.z.array(exports.zapsignSignerInputSchema).min(1),
    /** D-02 sequential — always true in Phase 1. */
    signature_order_active: zod_1.z.literal(true),
    lang: zod_1.z.literal('pt-br').default('pt-br'),
    /** Echoed back on every webhook — we use contracts.id so we can correlate. */
    external_id: zod_1.z.string().uuid(),
});
// ────────────────────────────────────────────────────────────────────────────
// Response — POST /api/v1/docs/ (and GET /api/v1/docs/:token/)
// ────────────────────────────────────────────────────────────────────────────
exports.zapsignSignerResponseSchema = zod_1.z
    .object({
    token: zod_1.z.string(),
    sign_url: zod_1.z.string().url().nullable().optional(),
    status: zod_1.z.string(),
    name: zod_1.z.string(),
    email: zod_1.z.string().email().nullable().optional(),
    order_group: zod_1.z.number().int().optional(),
    signed_at: zod_1.z.string().nullable().optional(),
})
    .passthrough();
exports.zapsignCreateDocResponseSchema = zod_1.z
    .object({
    open_id: zod_1.z.number().int(),
    token: zod_1.z.string(),
    status: zod_1.z.string(),
    name: zod_1.z.string(),
    original_file: zod_1.z.string().url().nullable().optional(),
    signed_file: zod_1.z.string().url().nullable().optional(),
    signers: zod_1.z.array(exports.zapsignSignerResponseSchema),
})
    .passthrough();
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
exports.ZAPSIGN_WEBHOOK_EVENT_TYPES = [
    'doc_signed',
    'doc_refused',
    'doc_expired',
    'doc_deleted',
    'viewed',
    'doc_created',
    'email_bounce',
];
exports.zapsignWebhookPayloadSchema = zod_1.z
    .object({
    event_type: zod_1.z.string(),
    open_id: zod_1.z.number().int().optional(),
    token: zod_1.z.string(),
    status: zod_1.z.string().optional(),
    external_id: zod_1.z.string().nullable().optional(),
    signed_file: zod_1.z.string().url().nullable().optional(),
    signers: zod_1.z.array(exports.zapsignSignerResponseSchema).optional(),
    sandbox: zod_1.z.boolean().optional(),
})
    .passthrough();
// ────────────────────────────────────────────────────────────────────────────
// Domain errors
// ────────────────────────────────────────────────────────────────────────────
class ZapsignNotConfiguredError extends Error {
    constructor() {
        super('ZAPSIGN_TOKEN is not configured — set it via .env.local or Coolify env');
        this.name = 'ZapsignNotConfiguredError';
    }
}
exports.ZapsignNotConfiguredError = ZapsignNotConfiguredError;
class ZapsignApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`ZapSign API ${status}: ${body}`);
        this.status = status;
        this.body = body;
        this.name = 'ZapsignApiError';
    }
}
exports.ZapsignApiError = ZapsignApiError;
