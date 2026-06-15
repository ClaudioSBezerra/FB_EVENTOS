// FB_EVENTOS — Pagar.me v5 REST client (Phase 1, Plan 01-06 Task 1).
//
// Raw `fetch` + Zod-validated responses per CLAUDE.md "no SDK" prescription.
// Phase 1 needs two operations:
//
//   1. createOrder(payload, idempotencyKey)
//        → POST /core/v5/orders with `X-Idempotency-Key` header
//
//   2. getOrder(orderId)
//        → GET  /core/v5/orders/:id
//        → used by the webhook handler as belt-and-suspenders re-fetch
//          defense (trust the API status over the webhook payload)
//
// Phase 2 additions (Plan 02-05):
//
//   3. cancelCharge(chargeId, opts?)
//        → DELETE /core/v5/charges/:id
//        → cancel or partial-refund a charge (AM-04)
//
// AUTH (Pagar.me v5 documented contract — RESEARCH §A8 + §Pitfall):
//   - HTTP Basic Auth header.
//   - Username = secret key (sk_test_* sandbox / sk_* production).
//   - Password = empty string.
//   - **The trailing colon is load-bearing.** `${secret}:` not just `${secret}`.
//
// ENVIRONMENT SWITCH:
//   Sandbox and production share the SAME base URL — `https://api.pagar.me/core/v5`.
//   The API key prefix (sk_test_* vs sk_*) selects the environment server-side.
//   We expose getPagarmeEnv() / getPagarmeBaseUrl() for diagnostics but the
//   URL never changes.
//
// We read `process.env` directly (mirroring src/lib/zapsign/client.ts) so a
// test or job harness that mutates PAGARME_SECRET_KEY / PAGARME_ENV BEFORE
// invoking the client sees the new values without re-importing the module.

import {
  PagarmeApiError,
  PagarmeNotConfiguredError,
  type PagarmeOrderCreateRequest,
  type PagarmeOrderResponse,
  type PagarmeRefundResponse,
  pagarmeOrderResponseSchema,
  pagarmeRefundResponseSchema,
} from './types'

// ────────────────────────────────────────────────────────────────────────────
// Base URL — same for sandbox and production (per Pagar.me v5 docs)
// ────────────────────────────────────────────────────────────────────────────

const PAGARME_BASE = 'https://api.pagar.me/core/v5'

export function getPagarmeBaseUrl(): string {
  return PAGARME_BASE
}

export function getPagarmeEnv(): 'sandbox' | 'production' {
  return process.env.PAGARME_ENV === 'production' ? 'production' : 'sandbox'
}

function getSecretKey(): string {
  const k = process.env.PAGARME_SECRET_KEY
  if (!k) throw new PagarmeNotConfiguredError()
  return k
}

function buildAuthHeader(): string {
  const secret = getSecretKey()
  // Trailing colon is LOAD-BEARING per Pagar.me v5 Basic Auth contract
  // (RESEARCH §A8 + §Pitfall). Stripping it breaks auth silently → 401.
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`
}

// ────────────────────────────────────────────────────────────────────────────
// createOrder
// ────────────────────────────────────────────────────────────────────────────

/**
 * POST /core/v5/orders — create an Order with one Charge (PIX or
 * credit_card). Returns the parsed Order response with the Charge inline
 * (PIX QR + copia-cola live at `charges[0].last_transaction`).
 *
 * Idempotency: pass `idempotencyKey` to add the `X-Idempotency-Key` header
 * — Pagar.me deduplicates on this header within a 24h window. The same
 * key is ALSO persisted in `pagarme_orders.idempotency_key` UNIQUE column
 * so our DB-side dedup catches the duplicate even before the API call.
 *
 * @throws PagarmeNotConfiguredError when PAGARME_SECRET_KEY is missing.
 * @throws PagarmeApiError on non-2xx response (carries status + body).
 */
export async function createOrder(
  payload: PagarmeOrderCreateRequest,
  idempotencyKey: string,
): Promise<PagarmeOrderResponse> {
  const res = await fetch(`${getPagarmeBaseUrl()}/orders`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new PagarmeApiError(res.status, text)
  }
  const json = await res.json()
  return pagarmeOrderResponseSchema.parse(json)
}

// ────────────────────────────────────────────────────────────────────────────
// getOrder — used by the webhook handler as "re-fetch defense"
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /core/v5/orders/:id — the webhook handler re-fetches the order
 * after receiving an event so the source of truth for status is Pagar.me's
 * own state, not the webhook payload (defends against spoofed webhooks).
 *
 * @throws PagarmeNotConfiguredError when PAGARME_SECRET_KEY is missing.
 * @throws PagarmeApiError on non-2xx response.
 */
export async function getOrder(orderId: string): Promise<PagarmeOrderResponse> {
  const res = await fetch(`${getPagarmeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(),
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new PagarmeApiError(res.status, text)
  }
  const json = await res.json()
  return pagarmeOrderResponseSchema.parse(json)
}

// ────────────────────────────────────────────────────────────────────────────
// cancelCharge — DELETE /core/v5/charges/:id (AM-04)
// ────────────────────────────────────────────────────────────────────────────

/**
 * DELETE /core/v5/charges/:id — cancel or partially refund a charge.
 *
 * - Full cancel: call without `opts.amount`.
 * - Partial refund: pass `opts.amount` in centavos (R$ × 100).
 *
 * Both full and partial variants hit the same DELETE endpoint. Pagar.me v5
 * docs confirm: partial refund = DELETE with `{ amount: N }` body.
 *
 * @throws PagarmeNotConfiguredError when PAGARME_SECRET_KEY is missing.
 * @throws PagarmeApiError on non-2xx response.
 */
export async function cancelCharge(
  chargeId: string,
  opts?: { amount?: number },
): Promise<PagarmeRefundResponse> {
  const hasBody = typeof opts?.amount === 'number'
  const res = await fetch(`${getPagarmeBaseUrl()}/charges/${encodeURIComponent(chargeId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: buildAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: hasBody ? JSON.stringify({ amount: opts!.amount }) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new PagarmeApiError(res.status, text)
  }
  const json = await res.json()
  return pagarmeRefundResponseSchema.parse(json)
}
