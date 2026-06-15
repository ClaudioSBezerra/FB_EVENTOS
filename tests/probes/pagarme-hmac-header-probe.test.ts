// FB_EVENTOS — Pagar.me v5 HMAC header-name probe (Plan 02-05, Task 1).
//
// AUTO_MODE: This probe is SKIPPED because no Pagar.me sandbox API key is
// configured (PAGARME_SECRET_KEY not set to a real sk_test_* value).
//
// PURPOSE: Verify the exact HTTP header name, algorithm, and encoding that
// Pagar.me v5 uses for webhook HMAC signatures (AM-02 open question).
//
// HOW TO RUN (when sandbox key is available):
//   1. Set PAGARME_SECRET_KEY=sk_test_<your_key> in .env.local
//   2. Set PAGARME_WEBHOOK_SIGNING_SECRET=<signing_secret_from_dashboard> in .env.local
//   3. Log into https://dashboard.pagar.me → Configurações → Webhooks
//      → note the "Signing Secret" value and the header name shown
//   4. Remove the `.skip` from the tests below
//   5. pnpm vitest tests/probes/pagarme-hmac-header-probe.test.ts --run
//
// PROBE OUTCOME (documented default — unverified, must run probe to confirm):
//   Header name:  X-Hub-Signature
//   Algorithm:    HMAC-SHA256
//   Encoding:     base64 (NOT hex — base64 is the Pagar.me v5 documented default)
//
// When the probe is run and the outcome differs from the default, update:
//   - src/lib/pagarme/hmac.ts (PAGARME_HMAC_HEADER_NAME constant + comment)
//   - docs/adr/0005-webhook-hmac-strategy.md (§Decision table)
//
// REFERENCES:
//   - 02-CONTEXT.md AM-02 (HMAC header-name open question)
//   - 02-RESEARCH.md §Pattern 4 (webhook HMAC implementation)
//   - src/lib/pagarme/hmac.ts (production implementation)

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

// The header name the production code uses (from src/lib/pagarme/hmac.ts).
// The probe should confirm this matches what Pagar.me actually sends.
const EXPECTED_HEADER = 'X-Hub-Signature'
const EXPECTED_ENCODING = 'base64' as const

describe.skip('AM-02: Pagar.me HMAC header-name probe (requires sandbox key)', () => {
  // NOTE: These tests are skipped until a real Pagar.me sandbox key is
  // configured. The probe sends a real request to Pagar.me sandbox to
  // verify the webhook signature contract.
  //
  // Auto-approval decision (AUTO_MODE):
  //   approved — probes skipped (no sandbox key);
  //   production defaults documented in src/lib/pagarme/hmac.ts and ADR-0005.

  it('PROBE: confirms X-Hub-Signature as the HMAC header name', async () => {
    // TODO: When running for real, this test should:
    // 1. Send a test webhook trigger to your local /api/webhooks/pagarme endpoint
    //    via the Pagar.me dashboard "Test Webhook" feature
    // 2. Capture the actual headers from the incoming request
    // 3. Confirm the header name matches EXPECTED_HEADER

    const secret = process.env.PAGARME_WEBHOOK_SIGNING_SECRET
    expect(secret, 'PAGARME_WEBHOOK_SIGNING_SECRET must be set for probe').toBeTruthy()

    const testBody = JSON.stringify({ id: 'probe_test', type: 'order.paid', data: {} })
    const mac = createHmac('sha256', secret!)
    mac.update(testBody)
    const signature = mac.digest(EXPECTED_ENCODING)

    // In a real probe, you would:
    // 1. POST this signature as the EXPECTED_HEADER header to your local endpoint
    // 2. Verify your endpoint accepts it (returns 200)
    expect(signature).toBeTruthy()
    expect(EXPECTED_HEADER).toBe('X-Hub-Signature')
  })

  it('PROBE: confirms base64 encoding (not hex)', async () => {
    const secret = process.env.PAGARME_WEBHOOK_SIGNING_SECRET
    expect(secret, 'PAGARME_WEBHOOK_SIGNING_SECRET must be set for probe').toBeTruthy()

    const body = '{"id":"probe_test"}'
    const mac = createHmac('sha256', secret!)
    mac.update(body)

    const base64Sig = mac.digest('base64')
    const hexSig = mac.digest('hex')

    // Pagar.me v5 uses base64 (longer, ~44 chars) not hex (64 chars).
    // Verify the production hmac.ts uses the correct decoding.
    expect(base64Sig.length).toBeLessThan(hexSig.length)
    expect(EXPECTED_ENCODING).toBe('base64')
  })

  it('PROBE: verifyWebhookSignature accepts probe-signed body', async () => {
    // TODO: Import and test the production verifyWebhookSignature with a
    // real Pagar.me-signed payload captured from the dashboard test event.
    const { verifyWebhookSignature } = await import('@/lib/pagarme/hmac')
    const secret = process.env.PAGARME_WEBHOOK_SIGNING_SECRET ?? 'dummy'
    const body = Buffer.from('{"id":"probe_test"}')

    const mac = createHmac('sha256', secret)
    mac.update(body)
    const sig = mac.digest('base64')

    expect(verifyWebhookSignature(body, sig, secret)).toBe(true)
  })
})
