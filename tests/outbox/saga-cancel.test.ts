// FB_EVENTOS — FORN-14: payment.failed → reservation release SAGA (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-06. See VALIDATION.md row FORN-14.
//
// TODO (Plan 02-06): import the payment-failed outbox handler.

import { describe, it } from 'vitest'

describe('FORN-14: payment.failed SAGA cancel', () => {
  it.todo('payment.failed outbox handler sets lot_reservations.released_at')
  it.todo('payment.failed outbox handler emits lot.released event in same tx')
  it.todo('payment.failed → SSE clients see lot turn available within 1s')
  it.todo('idempotent: replay of payment.failed does not double-release')
})
