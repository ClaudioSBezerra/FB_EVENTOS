// FB_EVENTOS — ZapSign REST client (Phase 1, Plan 01-05 Task 2).
//
// Raw `fetch` + Zod-validated responses per CLAUDE.md "no SDK" prescription.
// Three operations Phase 1 needs:
//
//   1. createDocument(payload)  — POST /api/v1/docs/
//   2. getDocument(token)       — GET  /api/v1/docs/:token/   (webhook re-fetch)
//   3. downloadSignedPdf(token) — GET  /api/v1/docs/:token/  → fetch(signed_file)
//
// Environment switch (D-03):
//   - ZAPSIGN_ENV=sandbox     → https://sandbox.api.zapsign.com.br/api/v1
//   - ZAPSIGN_ENV=production  → https://api.zapsign.com.br/api/v1
//
// Auth: Bearer token via ZAPSIGN_TOKEN env.

import {
  ZapsignApiError,
  type ZapsignCreateDocRequest,
  type ZapsignCreateDocResponse,
  ZapsignNotConfiguredError,
  zapsignCreateDocResponseSchema,
} from './types'

// ────────────────────────────────────────────────────────────────────────────
// Base URL
// ────────────────────────────────────────────────────────────────────────────
//
// We read `process.env` directly (not the cached `env` object from
// src/lib/env.ts) so a test or job harness that mutates ZAPSIGN_TOKEN /
// ZAPSIGN_ENV BEFORE invoking the client sees the new values without
// re-importing the module. The env.ts cache is appropriate for boot-time
// config; this client deliberately re-reads on every call (cheap — only
// at job execution).

const SANDBOX_BASE = 'https://sandbox.api.zapsign.com.br/api/v1'
const PRODUCTION_BASE = 'https://api.zapsign.com.br/api/v1'

export function getZapsignBaseUrl(): string {
  return process.env.ZAPSIGN_ENV === 'production' ? PRODUCTION_BASE : SANDBOX_BASE
}

function getToken(): string {
  const t = process.env.ZAPSIGN_TOKEN
  if (!t) throw new ZapsignNotConfiguredError()
  return t
}

// ────────────────────────────────────────────────────────────────────────────
// createDocument
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a document at ZapSign. Returns the parsed response including
 * `token` (the document's primary key on ZapSign's side) + per-signer
 * `sign_url` URLs.
 *
 * @throws ZapsignNotConfiguredError when ZAPSIGN_TOKEN is missing.
 * @throws ZapsignApiError on non-2xx response (carries status + body).
 */
export async function createDocument(
  payload: ZapsignCreateDocRequest,
): Promise<ZapsignCreateDocResponse> {
  const token = getToken()
  const res = await fetch(`${getZapsignBaseUrl()}/docs/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ZapsignApiError(res.status, text)
  }
  const json = await res.json()
  return zapsignCreateDocResponseSchema.parse(json)
}

// ────────────────────────────────────────────────────────────────────────────
// getDocument — used by the webhook handler as "re-fetch defense"
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/docs/:token/ — the webhook handler re-fetches the document
 * after receiving an event so the source of truth for status is ZapSign's
 * own state, not the webhook payload (defends against spoofed webhooks).
 */
export async function getDocument(zapsignToken: string): Promise<ZapsignCreateDocResponse> {
  const token = getToken()
  const res = await fetch(`${getZapsignBaseUrl()}/docs/${zapsignToken}/`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ZapsignApiError(res.status, text)
  }
  const json = await res.json()
  return zapsignCreateDocResponseSchema.parse(json)
}

// ────────────────────────────────────────────────────────────────────────────
// downloadSignedPdf
// ────────────────────────────────────────────────────────────────────────────

/**
 * Download the signed PDF binary for a fully-signed document. The
 * `signed_file` URL on the document response is a public/signed URL we
 * can fetch directly (no auth — ZapSign signs the link).
 *
 * Returns a Buffer ready for MinIO `putObject`.
 *
 * @throws ZapsignApiError if signed_file is missing OR the fetch fails.
 */
export async function downloadSignedPdf(zapsignToken: string): Promise<Buffer> {
  const doc = await getDocument(zapsignToken)
  if (!doc.signed_file) {
    throw new ZapsignApiError(
      409,
      `Document ${zapsignToken} has no signed_file (status=${doc.status})`,
    )
  }
  const res = await fetch(doc.signed_file, { method: 'GET' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ZapsignApiError(res.status, text)
  }
  const ab = await res.arrayBuffer()
  return Buffer.from(ab)
}
