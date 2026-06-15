// FB_EVENTOS — Pagar.me MSW mocks (Plan 02-01 Task 3, Wave 0).
//
// Stub handlers for Pagar.me v5 endpoints used by Plans 02-05..02-07.
// Downstream plans add realistic FSM transitions, webhook fixtures, and
// the HMAC header-name probe outcome (AM-02) wires in via setHmacHeader.
//
// Endpoints covered:
//   POST   /core/v5/orders           — create order (PIX + credit_card)
//   GET    /core/v5/orders/:id       — re-fetch defense (idempotent)
//   DELETE /core/v5/charges/:id      — refund (FORN-16, partial-amount AM-04)
//
// Intent: make tests/payments/*, tests/webhooks/*, tests/refunds/*
// importable without each test re-rolling its own handler set.

import { type HttpHandler, HttpResponse, http } from 'msw'

export type PagarmeMockOpts = {
  baseUrl?: string
  // Override individual endpoints. When omitted, the default stub responds 200.
  overrides?: {
    createOrder?: HttpHandler
    getOrder?: HttpHandler
    refundCharge?: HttpHandler
  }
}

const DEFAULT_BASE = 'https://api.pagar.me'

function pixOrderResponse(orderId: string) {
  return {
    id: orderId,
    status: 'pending',
    customer: { id: 'cust_test', name: 'Stub Vendor' },
    charges: [
      {
        id: `ch_${orderId}`,
        status: 'pending',
        payment_method: 'pix',
        last_transaction: {
          qr_code: '00020126580014br.gov.bcb.pix...',
          qr_code_url: 'https://api.pagar.me/qr/stub.png',
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
      },
    ],
  }
}

function creditCardOrderResponse(orderId: string, installments: number) {
  return {
    id: orderId,
    status: 'paid',
    charges: [
      {
        id: `ch_${orderId}`,
        status: 'paid',
        payment_method: 'credit_card',
        last_transaction: {
          installments,
          installment_amount: 0,
          installment_type: 'merchant',
          acquirer_message: 'Approved',
        },
      },
    ],
  }
}

export function createPagarmeMswHandlers(opts: PagarmeMockOpts = {}): HttpHandler[] {
  const base = opts.baseUrl ?? DEFAULT_BASE
  const handlers: HttpHandler[] = []

  handlers.push(
    opts.overrides?.createOrder ??
      http.post(`${base}/core/v5/orders`, async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
        const orderId = `or_${Math.random().toString(36).slice(2, 10)}`
        const payments = (body.payments ?? []) as Array<Record<string, unknown>>
        const first = payments[0] ?? {}
        if (first.payment_method === 'pix') {
          return HttpResponse.json(pixOrderResponse(orderId), { status: 200 })
        }
        const ccInfo = (first.credit_card ?? {}) as Record<string, unknown>
        const installments = Number(ccInfo.installments ?? 1)
        return HttpResponse.json(creditCardOrderResponse(orderId, installments), {
          status: 200,
        })
      }),
  )

  handlers.push(
    opts.overrides?.getOrder ??
      http.get(`${base}/core/v5/orders/:id`, ({ params }) => {
        const id = String(params.id)
        return HttpResponse.json(pixOrderResponse(id), { status: 200 })
      }),
  )

  handlers.push(
    opts.overrides?.refundCharge ??
      http.delete(`${base}/core/v5/charges/:id`, async ({ params, request }) => {
        const chargeId = String(params.id)
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
        return HttpResponse.json(
          {
            id: chargeId,
            status: 'refunded',
            amount: body.amount ?? null,
          },
          { status: 200 },
        )
      }),
  )

  return handlers
}

// HMAC signature header generation helper.
// Plan 02-05 probe-test (tests/probes/pagarme-hmac-header-probe.test.ts)
// pins the header name. Default 'X-Hub-Signature' is a placeholder until
// AM-02 probe resolves.
export type HmacAlgo = 'sha256'

export function signPagarmePayload(
  rawBody: string,
  secret: string,
  algo: HmacAlgo = 'sha256',
): string {
  // Lazy require to avoid bundling crypto in client tests that import this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('node:crypto') as typeof import('node:crypto')
  const mac = crypto.createHmac(algo, secret)
  mac.update(rawBody)
  return mac.digest('base64')
}

export const DEFAULT_HMAC_HEADER = 'X-Hub-Signature'
