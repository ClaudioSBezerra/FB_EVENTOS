// FB_EVENTOS — D-14 gate Playwright fixtures (Phase 1, Plan 01-08 Task 2).
//
// These fixtures seed the trindade tenant + an approved vendor BEFORE the
// D-14 4-step gate spec runs. They also expose:
//
//   - SAMPLE_PLANTA_PDF_PATH — a tiny inline PDF we generate at fixture
//     init time and write to disk. The spec uses page.setInputFiles() with
//     this path to drive the "upload planta" step without requiring a
//     real PDF committed to the repo.
//   - simulateZapsignWebhook(contractId, signerOrderGroup) — posts a
//     valid Basic-Auth-signed payload to the local Next.js webhook route
//     and waits for FSM transition. Replaces a manual curl call.
//   - simulatePagarmeWebhook(orderId) — same shape for Pagar.me order.paid.
//   - tearDownTrindadeTenant() — wipes the trindade tenant + all FK rows
//     so the spec is repeatable without external cleanup.
//
// Sandbox-mode env vars are set at process level in beforeAll so the
// app code paths exercised by the spec hit ZapSign sandbox + Pagar.me
// sandbox endpoints (via MSW or via real sandbox APIs depending on
// E2E_USE_SANDBOX env var).
//
// PRODUCTION FLIP NOTE: the D-14 gate runs in SANDBOX mode. Flipping to
// production is an operator action documented in docs/RUNBOOK.md
// "Phase 1 — D-14 Gate Sandbox→Production Flip". DO NOT toggle
// PAGARME_ENV=production or ZAPSIGN_ENV=production from inside this
// fixture or the spec — that would bypass the operator gate.

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import postgres from 'postgres'

const TRINDADE_SLUG = 'trindade-d14'
const TRINDADE_NAME = 'Festa de Trindade — D-14 Gate'

/**
 * The smallest valid PDF we can generate inline — used as the planta
 * upload fixture in Step 2 of the gate. Real PDFs would live in fixtures/
 * but this byte sequence is sufficient to satisfy the upload flow's
 * Content-Type check + MinIO putObject + statObject confirmation.
 *
 * Source: minimal one-page PDF spec (PDF/A header + xref + trailer).
 */
const MINIMAL_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000054 00000 n\n0000000101 00000 n\n' +
    'trailer<</Size 4/Root 1 0 R>>\nstartxref\n156\n%%EOF',
  'utf8',
)

let SAMPLE_PLANTA_PDF_PATH = ''

export function ensureSamplePlantaPdf(): string {
  if (SAMPLE_PLANTA_PDF_PATH) return SAMPLE_PLANTA_PDF_PATH
  SAMPLE_PLANTA_PDF_PATH = `${tmpdir()}/d14-planta-trindade-sample.pdf`
  writeFileSync(SAMPLE_PLANTA_PDF_PATH, MINIMAL_PDF_BYTES)
  return SAMPLE_PLANTA_PDF_PATH
}

// ────────────────────────────────────────────────────────────────────────────
// Sandbox env vars — set before spec runs so the Next.js dev server picks
// them up. The spec is gated on PLAYWRIGHT_BROWSERS_READY|CI so a missing
// sandbox key in this env doesn't break the test (spec is skipped instead).
// ────────────────────────────────────────────────────────────────────────────

export function ensureSandboxEnv(): void {
  // Idempotent — only set if not already set.
  process.env.ZAPSIGN_ENV ??= 'sandbox'
  process.env.ZAPSIGN_TOKEN ??= 'sandbox-test-token-d14'
  process.env.PAGARME_ENV ??= 'sandbox'
  process.env.PAGARME_SECRET_KEY ??= 'sk_test_sandbox_d14'
  // ZapSign + Pagar.me webhook Basic Auth — used by simulate* helpers.
  process.env.ZAPSIGN_WEBHOOK_USER ??= 'zapsign'
  process.env.ZAPSIGN_WEBHOOK_PASSWORD ??= 'zapsign-pw'
  process.env.PAGARME_WEBHOOK_USER ??= 'pagarme'
  process.env.PAGARME_WEBHOOK_PASSWORD ??= 'pagarme-pw'
}

// ────────────────────────────────────────────────────────────────────────────
// Trindade tenant seed + teardown
// ────────────────────────────────────────────────────────────────────────────

function getMigratorPool() {
  const url = process.env.DATABASE_MIGRATOR_URL
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATOR_URL required for D-14 gate fixtures (set in .env.local or CI env).',
    )
  }
  return postgres(url, { max: 2 })
}

export interface SeededTenant {
  tenantId: string
  slug: string
  vendorId: string
  vendorEmail: string
  cleanup: () => Promise<void>
}

/**
 * Seed the trindade-d14 tenant + a single approved vendor. Returns the
 * ids + slug so the spec can navigate to /trindade-d14/... and find the
 * pre-existing vendor for the lot-assignment step.
 *
 * Note: organization + member rows are NOT seeded here — the spec drives
 * /signup which creates them through Better Auth. That keeps the
 * authentication path real.
 */
export async function seedTrindadeTenant(): Promise<SeededTenant> {
  const pool = getMigratorPool()
  const stamp = Date.now()
  const slug = `${TRINDADE_SLUG}-${stamp}`
  try {
    // 1. tenants row (no RLS).
    const tenantRows = await pool<Array<{ id: string }>>`
      INSERT INTO tenants (slug, name) VALUES (${slug}, ${TRINDADE_NAME})
      RETURNING id
    `
    const tenantId = tenantRows[0]?.id
    if (!tenantId) throw new Error('seedTrindadeTenant: no tenant row returned')

    // 2. vendor row via app pool + SET LOCAL (FORCE RLS).
    const appUrl = process.env.DATABASE_URL
    if (!appUrl) throw new Error('DATABASE_URL required for seedTrindadeTenant')
    const appPool = postgres(appUrl, { max: 2 })
    let vendorId = ''
    let vendorEmail = ''
    try {
      const vendorRows = await appPool.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
        return tx<Array<{ id: string; email: string }>>`
          INSERT INTO vendors (
            tenant_id, cnpj, legal_name, trade_name, email, phone, status,
            cnpj_verified
          ) VALUES (
            ${tenantId}, '12345678000195', 'Fornecedor Aprovado LTDA',
            'Stand Trindade', ${'vendor-d14-' + stamp + '@example.test'},
            '+5562999990000', 'approved', true
          )
          RETURNING id, email
        `
      })
      vendorId = vendorRows[0]?.id ?? ''
      vendorEmail = vendorRows[0]?.email ?? ''
    } finally {
      await appPool.end({ timeout: 5 })
    }

    return {
      tenantId,
      slug,
      vendorId,
      vendorEmail,
      cleanup: async () => {
        const cleanup = getMigratorPool()
        try {
          // Cascades: deleting the tenant cascades through every tenant-
          // scoped FK in our schema (events → lots, contracts, vendors,
          // payments). All `references => tenants(id)` are ON DELETE
          // CASCADE per Plan 01-01 schema.
          await cleanup`DELETE FROM tenants WHERE id = ${tenantId}`
        } finally {
          await cleanup.end({ timeout: 5 })
        }
      },
    }
  } finally {
    await pool.end({ timeout: 5 })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Webhook simulators — POST sandbox payloads to local Next.js routes
// ────────────────────────────────────────────────────────────────────────────

const NEXT_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

export interface ZapsignWebhookSimulation {
  contractId: string
  zapsignDocId: string
  orderGroup: 1 | 2
  apiStatus: 'pending' | 'signed' | 'refused'
}

export async function simulateZapsignWebhook(
  sim: ZapsignWebhookSimulation,
): Promise<{ status: number; body: unknown }> {
  const payload = {
    event_type: 'doc_signed',
    sandbox: true,
    token: sim.zapsignDocId,
    external_id: sim.contractId,
    status: sim.apiStatus,
    signers: [
      {
        token: `s${sim.orderGroup}`,
        name: sim.orderGroup === 1 ? 'Org User' : 'Fornecedor User',
        email: sim.orderGroup === 1 ? 'org@example.test' : 'forn@example.test',
        order_group: sim.orderGroup,
        status: sim.apiStatus,
      },
    ],
  }
  const res = await fetch(`${NEXT_BASE_URL}/api/webhooks/zapsign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(
        process.env.ZAPSIGN_WEBHOOK_USER ?? 'zapsign',
        process.env.ZAPSIGN_WEBHOOK_PASSWORD ?? 'zapsign-pw',
      ),
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

export interface PagarmeWebhookSimulation {
  orderId: string
  paymentId: string
  apiStatus: 'paid' | 'failed' | 'pending'
}

export async function simulatePagarmeWebhook(
  sim: PagarmeWebhookSimulation,
): Promise<{ status: number; body: unknown }> {
  const payload = {
    type: 'order.paid',
    data: {
      id: sim.orderId,
      status: sim.apiStatus,
      metadata: { payment_id: sim.paymentId },
    },
  }
  const res = await fetch(`${NEXT_BASE_URL}/api/webhooks/pagarme`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(
        process.env.PAGARME_WEBHOOK_USER ?? 'pagarme',
        process.env.PAGARME_WEBHOOK_PASSWORD ?? 'pagarme-pw',
      ),
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
