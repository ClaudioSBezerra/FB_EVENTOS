// FB_EVENTOS — Pagar.me v5 installments-shape probe (Plan 02-05, Task 1 / AM-06).
//
// AUTO_MODE: This probe is SKIPPED because no Pagar.me sandbox API key is
// configured (PAGARME_SECRET_KEY not set to a real sk_test_* value).
//
// PURPOSE: Probe the exact credit_card installments response shape from
// Pagar.me v5 sandbox to pin the AM-06 open question:
//   - Does Pagar.me echo per-installment amounts in the response?
//   - What field key holds them ('installments_table', 'installment_plan', etc.)?
//   - What does 'interest_type' actually map to?
//
// HOW TO RUN (when sandbox key is available):
//   1. Set PAGARME_SECRET_KEY=sk_test_<your_key> in .env.local
//   2. pnpm vitest tests/probes/pagarme-installments-shape-probe.test.ts --run
//   3. Inspect output and update src/lib/pagarme/installments-shape.generated.ts
//
// PROBE OUTCOME (documented default — unverified, based on Pagar.me v5 docs):
//   PAGARME_INSTALLMENTS_RESPONSE_KEY: null
//     → Pagar.me v5 does NOT echo per-installment amounts in the response.
//     → The checkout UI computes installment_amount = total / n client-side
//       using a static juros rate (default 3.5% per month, compound).
//   interest_type field: absent from request → Pagar.me uses 'compound' default.
//
// When the probe is run and the outcome differs from the default, update:
//   - src/lib/pagarme/installments-shape.generated.ts (constants)
//   - docs/adr/0005-webhook-hmac-strategy.md (§Installments shape section)
//
// REFERENCES:
//   - 02-CONTEXT.md AM-06 (installments shape open question)
//   - 02-RESEARCH.md §Open Q3 (installments echo verified at sandbox)
//   - src/lib/pagarme/installments-shape.generated.ts (pinned outcome)

import { describe, expect, it } from 'vitest'

describe.skip('AM-06: Pagar.me installments-shape probe (requires sandbox key)', () => {
  // NOTE: These tests are skipped until a real Pagar.me sandbox key is
  // configured. The probe creates a real sandbox charge to inspect the
  // installments response shape.
  //
  // Auto-approval decision (AUTO_MODE):
  //   approved — probes skipped (no sandbox key);
  //   production defaults documented in installments-shape.generated.ts and ADR-0005.

  it('PROBE: inspects response shape for 6x R$1200 credit_card charge', async () => {
    const secretKey = process.env.PAGARME_SECRET_KEY
    expect(secretKey, 'PAGARME_SECRET_KEY must be sk_test_* for probe').toMatch(/^sk_test_/)

    const authHeader = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`

    const payload = {
      customer: {
        name: 'Probe Test',
        email: 'probe@test.com',
        document: '12345678901',
        type: 'individual',
      },
      items: [{ amount: 120000, description: 'Probe Test Item', quantity: 1 }],
      payments: [
        {
          payment_method: 'credit_card',
          credit_card: {
            card_token: 'card_token_sandbox_probe_CHANGE_ME',
            installments: 6,
            // Try both 'compound' and omit to detect default:
            // interest_type: 'compound',
          },
        },
      ],
    }

    const res = await fetch('https://api.pagar.me/core/v5/orders', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Idempotency-Key': `probe-installments-${Date.now()}`,
      },
      body: JSON.stringify(payload),
    })

    expect(res.ok, `Pagar.me API returned ${res.status}: ${await res.text()}`).toBe(true)
    const json = (await res.json()) as Record<string, unknown>

    // Capture the charge response for installments shape inspection.
    const charges = (json.charges as Array<Record<string, unknown>>) ?? []
    const firstCharge = charges[0] ?? {}
    const lastTx = (firstCharge.last_transaction ?? {}) as Record<string, unknown>

    // Log the actual response shape for updating the generated file.
    console.log('PROBE RESULT — full charge.last_transaction:', JSON.stringify(lastTx, null, 2))
    console.log('PROBE: installments_table key exists:', 'installments_table' in lastTx)
    console.log('PROBE: installment_plan key exists:', 'installment_plan' in lastTx)
    console.log('PROBE: interest_type value:', lastTx.interest_type)
    console.log('PROBE: installment_amount value:', lastTx.installment_amount)

    // The probe result should be used to update PAGARME_INSTALLMENTS_RESPONSE_KEY
    // in src/lib/pagarme/installments-shape.generated.ts.
    expect(typeof json.id).toBe('string')
  })

  it('PROBE: checks if interest_type field is accepted in request', async () => {
    // TODO: When running for real, compare two charges:
    // 1. Without interest_type field (test default behavior)
    // 2. With interest_type: 'compound'
    // Document whether they produce different response shapes.
    expect(true).toBe(true) // placeholder
  })
})
