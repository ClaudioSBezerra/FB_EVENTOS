// FB_EVENTOS — Payment simulator (piloto pré-credencial Pagar.me, 2026-06-17).
//
// When env.PAYMENT_SIMULATOR_ENABLED is true, checkout.ts swaps the real
// Pagar.me API call for `createSimulatedOrder`. The function returns a
// PagarmeOrderResponse-shaped object with id = `SIM_<uuid>` so downstream
// code (DB persistence, page rendering, audit) treats it as a normal order
// and just shows the simulator panel instead of the PIX QR.
//
// The simulator stays completely OFF the Pagar.me network — no API call,
// no idempotency leak, nothing that could break a real account once it's
// configured.
//
// 🔴 PRODUCTION SAFETY:
//   Once Fabricia (GoTo/GRU) issues the real PAGARME_SECRET_KEY, set
//   PAYMENT_SIMULATOR_ENABLED=false (or unset). Logs emit a SIMULATOR=ON
//   warning at every createSimulatedOrder call so the operator can grep
//   for accidental leftover-flag state.

import { logger } from '@/lib/logger'
import type { PagarmeOrderCreateRequest, PagarmeOrderResponse } from './types'

export const SIMULATOR_PREFIX = 'SIM_'

export function isSimulatedOrderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(SIMULATOR_PREFIX)
}

export function shouldUseSimulator(): boolean {
  // Read process.env directly (not env.PAYMENT_SIMULATOR_ENABLED) so this
  // function stays callable from environments where env.ts may not be
  // fully loaded yet (worker boot, migration scripts).
  const raw = process.env.PAYMENT_SIMULATOR_ENABLED
  return raw === 'true' || raw === '1'
}

/**
 * Returns a Pagar.me-shaped Order response with the IDs prefixed `SIM_`.
 *
 * The PIX `qr_code` / `qr_code_url` fields carry simulator-specific
 * placeholder strings — the checkout page detects the prefix and shows
 * its simulator panel instead of trying to render a real QR.
 */
export function createSimulatedOrder(
  payload: PagarmeOrderCreateRequest,
  idempotencyKey: string,
): PagarmeOrderResponse {
  const orderId = `${SIMULATOR_PREFIX}${crypto.randomUUID()}`
  const chargeId = `${SIMULATOR_PREFIX}${crypto.randomUUID()}`

  const totalAmount = payload.items.reduce((s, it) => s + it.amount * it.quantity, 0)
  const method = payload.payments[0]?.payment_method ?? 'pix'

  logger.warn(
    {
      component: 'payment-simulator',
      orderId,
      chargeId,
      method,
      amountCents: totalAmount,
      idempotencyKey,
    },
    'SIMULATOR=ON — Pagar.me API NOT called. Set PAYMENT_SIMULATOR_ENABLED=false in prod once real keys land.',
  )

  const nowIso = new Date().toISOString()
  const expiresIso = new Date(Date.now() + 60 * 60 * 1000).toISOString() // +1h

  const lastTransaction =
    method === 'pix'
      ? {
          id: `${SIMULATOR_PREFIX}tx_${crypto.randomUUID()}`,
          transaction_type: 'pix',
          qr_code: `SIMULADO|pagamento|${orderId}`,
          qr_code_url: null,
          expires_at: expiresIso,
        }
      : {
          id: `${SIMULATOR_PREFIX}tx_${crypto.randomUUID()}`,
          transaction_type: 'credit_card',
        }

  return {
    id: orderId,
    code: orderId,
    status: 'pending',
    amount: totalAmount,
    currency: 'BRL',
    customer: {
      id: `${SIMULATOR_PREFIX}cus_${crypto.randomUUID()}`,
      email: payload.customer.email,
    },
    charges: [
      {
        id: chargeId,
        status: 'pending',
        payment_method: method,
        amount: totalAmount,
        last_transaction:
          lastTransaction as unknown as PagarmeOrderResponse['charges'][0]['last_transaction'],
        paid_at: null,
      },
    ],
    created_at: nowIso,
  } as PagarmeOrderResponse
}
