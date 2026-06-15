// FB_EVENTOS — FORN-11: Pagar.me webhook HMAC verification (Plan 02-05, Task 2).
//
// Tests (pure unit — no DB):
//   1. Valid HMAC-SHA256 base64 signature → verifyWebhookSignature returns true.
//   2. Tampered body → false (timingSafeEqual catches it).
//   3. Wrong secret → false.
//   4. Hex-encoded signature (wrong encoding for our base64 impl) → false.
//   5. Empty string signature → false (not throw).
//   6. Null signature header → false (not throw).
//   7. Garbage input → false (not throw).
//
// PAGARME_HMAC_HEADER_NAME constant also asserted (AM-02 default).

import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'

import { PAGARME_HMAC_HEADER_NAME, verifyWebhookSignature } from '@/lib/pagarme/hmac'

const TEST_SECRET = 'test-hmac-secret-at-least-16-chars'

function makeSignature(
  body: string | Buffer,
  secret: string,
  encoding: 'base64' | 'hex' = 'base64',
): string {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  return createHmac('sha256', secret).update(buf).digest(encoding)
}

describe('HMAC header name (AM-02)', () => {
  test('PAGARME_HMAC_HEADER_NAME is X-Hub-Signature (probe-pending default)', () => {
    // ⚠️ PROBE NOTE: This constant is the AUTO_MODE default (unverified against sandbox).
    // Run tests/probes/pagarme-hmac-header-probe.test.ts with a real sandbox
    // key to confirm. If the probe reveals a different header name, update
    // PAGARME_HMAC_HEADER_NAME in src/lib/pagarme/hmac.ts.
    expect(PAGARME_HMAC_HEADER_NAME).toBe('X-Hub-Signature')
  })
})

describe('verifyWebhookSignature — happy path', () => {
  test('valid HMAC-SHA256 base64 signature → returns true', () => {
    const body = Buffer.from('{"id":"evt_123","type":"order.paid"}', 'utf8')
    const sig = makeSignature(body, TEST_SECRET, 'base64')

    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(true)
  })

  test('verifies with realistic webhook payload', () => {
    const body = Buffer.from(
      JSON.stringify({ id: 'hook_xyz', type: 'charge.paid', data: { id: 'or_abc' } }),
      'utf8',
    )
    const sig = makeSignature(body, TEST_SECRET, 'base64')

    expect(verifyWebhookSignature(body, sig, TEST_SECRET)).toBe(true)
  })
})

describe('verifyWebhookSignature — tamper detection', () => {
  test('one byte changed in body → returns false (timingSafeEqual)', () => {
    const originalBody = Buffer.from('{"id":"evt_tamper","type":"order.paid"}', 'utf8')
    const sig = makeSignature(originalBody, TEST_SECRET, 'base64')

    // Tamper: flip one bit in the body
    const tamperedBody = Buffer.from(originalBody)
    tamperedBody[5] = (tamperedBody[5]! ^ 0x01)

    expect(verifyWebhookSignature(tamperedBody, sig, TEST_SECRET)).toBe(false)
  })

  test('wrong secret → returns false', () => {
    const body = Buffer.from('{"id":"evt_secret"}', 'utf8')
    const sig = makeSignature(body, TEST_SECRET, 'base64')

    expect(verifyWebhookSignature(body, sig, 'completely-wrong-secret')).toBe(false)
  })

  test('hex-encoded signature (wrong encoding) → returns false', () => {
    const body = Buffer.from('{"id":"evt_hex"}', 'utf8')
    const hexSig = makeSignature(body, TEST_SECRET, 'hex') // hex, not base64

    // Implementation uses base64 decoding; hex-encoded sig will not match.
    expect(verifyWebhookSignature(body, hexSig, TEST_SECRET)).toBe(false)
  })
})

describe('verifyWebhookSignature — invalid input handling (must not throw)', () => {
  test('empty string signature → returns false', () => {
    const body = Buffer.from('{"id":"evt_empty_sig"}', 'utf8')
    expect(verifyWebhookSignature(body, '', TEST_SECRET)).toBe(false)
  })

  test('null signature header → returns false', () => {
    const body = Buffer.from('{"id":"evt_null_sig"}', 'utf8')
    expect(verifyWebhookSignature(body, null, TEST_SECRET)).toBe(false)
  })

  test('undefined signature header → returns false', () => {
    const body = Buffer.from('{"id":"evt_undef_sig"}', 'utf8')
    expect(verifyWebhookSignature(body, undefined, TEST_SECRET)).toBe(false)
  })

  test('empty body with correct sig for non-empty body → false', () => {
    const originalBody = Buffer.from('{"id":"evt_body"}', 'utf8')
    const sig = makeSignature(originalBody, TEST_SECRET, 'base64')
    const emptyBody = Buffer.from('')

    expect(verifyWebhookSignature(emptyBody, sig, TEST_SECRET)).toBe(false)
  })
})
