"use strict";
// FB_EVENTOS — Pagar.me v5 webhook HMAC signature verification (Plan 02-05, Task 2).
//
// ─────────────────────────────────────────────────────────────────────────
// LOAD-BEARING COMMENT BLOCK: HMAC Contract (AM-02)
// ─────────────────────────────────────────────────────────────────────────
//
// Header name: X-Hub-Signature
//   ⚠️ PROBE STATUS: AUTO_MODE default — NOT verified against sandbox.
//   Run tests/probes/pagarme-hmac-header-probe.test.ts with a real
//   PAGARME_WEBHOOK_SIGNING_SECRET to confirm.
//   Reference: docs/adr/0005-webhook-hmac-strategy.md §Decision
//
// Algorithm: HMAC-SHA256
//   Standard HMAC with SHA-256, key = PAGARME_WEBHOOK_SIGNING_SECRET.
//
// Encoding: base64
//   ⚠️ PROBE STATUS: AUTO_MODE default — NOT verified against sandbox.
//   Pagar.me v5 docs indicate base64. If the probe reveals hex, change
//   Buffer.from(signatureHeader, 'base64') → Buffer.from(signatureHeader, 'hex').
//
// Raw bytes CRITICAL (Pitfall 1 from 02-RESEARCH.md):
//   The Route Handler MUST read `req.arrayBuffer()` BEFORE `JSON.parse()`.
//   Any JSON normalisation (whitespace, key order) BEFORE computing the HMAC
//   will cause false-negative verification failures.
//
// timingSafeEqual CRITICAL (threat T-02-05-01):
//   Never use `==` or `===` for comparing HMAC signatures. Timing-safe
//   comparison prevents timing-oracle attacks that could leak the secret.
//
// Belt-and-suspenders (D-13, Phase 1 preserved):
//   The worker also re-fetches the order from Pagar.me API to confirm status.
//   HMAC protects the inbox; the re-fetch defends against a compromised secret.
//
// REFERENCES:
//   - 02-RESEARCH.md §Pattern 4 (webhook HMAC implementation)
//   - 02-CONTEXT.md AM-02, D-13, D-14
//   - tests/probes/pagarme-hmac-header-probe.test.ts (sandbox verification probe)
//   - docs/adr/0005-webhook-hmac-strategy.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGARME_HMAC_HEADER_NAME = void 0;
exports.verifyWebhookSignature = verifyWebhookSignature;
const node_crypto_1 = require("node:crypto");
// ────────────────────────────────────────────────────────────────────────────
// Constants — probe-pinned per AM-02
// ────────────────────────────────────────────────────────────────────────────
/**
 * HTTP header name Pagar.me v5 uses for HMAC webhook signatures.
 *
 * PROBE STATUS: AUTO_MODE default (X-Hub-Signature) — unverified against sandbox.
 * Run tests/probes/pagarme-hmac-header-probe.test.ts to confirm.
 *
 * Usage in Route Handler:
 *   const sig = req.headers.get(PAGARME_HMAC_HEADER_NAME.toLowerCase())
 */
exports.PAGARME_HMAC_HEADER_NAME = 'X-Hub-Signature';
// ────────────────────────────────────────────────────────────────────────────
// verifyWebhookSignature
// ────────────────────────────────────────────────────────────────────────────
/**
 * Verify a Pagar.me v5 webhook HMAC-SHA256 signature using timing-safe
 * comparison.
 *
 * @param rawBody         Raw request body as a Buffer — read via
 *                        `Buffer.from(await req.arrayBuffer())` BEFORE
 *                        any JSON parsing (Pitfall 1).
 * @param signatureHeader The header value from PAGARME_HMAC_HEADER_NAME
 *                        (base64-encoded HMAC-SHA256 per Pagar.me docs).
 *                        Pass null/undefined → returns false (not throw).
 * @param secret          PAGARME_WEBHOOK_SIGNING_SECRET (from env; never log).
 *
 * @returns true if the signature is valid; false otherwise.
 *          NEVER throws — invalid inputs return false.
 */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader)
        return false;
    try {
        // Compute expected HMAC.
        const expectedBytes = (0, node_crypto_1.createHmac)('sha256', secret).update(rawBody).digest();
        // Decode the received signature.
        // PROBE NOTE: Using base64 per AM-02 default. If sandbox probe reveals
        // hex encoding, change 'base64' → 'hex' here AND update the comment block.
        const receivedBytes = Buffer.from(signatureHeader, 'base64');
        // Length mismatch check: timingSafeEqual requires equal-length buffers.
        if (expectedBytes.length !== receivedBytes.length)
            return false;
        // Timing-safe comparison — critical for preventing timing oracle attacks.
        return (0, node_crypto_1.timingSafeEqual)(expectedBytes, receivedBytes);
    }
    catch {
        // Any error (bad base64, crypto failure) → reject.
        return false;
    }
}
