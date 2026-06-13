// FB_EVENTOS — External API mocks (Phase 1, Plan 01-01 — Wave 0 test infra).
//
// MSW (Mock Service Worker) Node-mode server pre-loaded with handlers for the
// four external HTTP surfaces Phase 1 talks to:
//
//   1. ZapSign        — POST sandbox.api.zapsign.com.br/api/v1/docs/  (e-sign)
//   2. Pagar.me v5    — POST api.pagar.me/core/v5/orders             (cobrança)
//   3. BrasilAPI      — GET  brasilapi.com.br/api/cnpj/v1/:cnpj      (CNPJ)
//   4. Resend         — POST api.resend.com/emails                   (notif)
//
// Why MSW (not nock / fetch-mock):
//   - MSW intercepts the global `fetch` (Node 18+/22 native) AND http/https.
//     Phase 1 lib wrappers (src/lib/zapsign.ts, src/lib/pagarme.ts,
//     src/lib/brasilapi.ts, src/lib/email.ts) all call fetch directly per
//     CLAUDE.md "no SDK" prescription. MSW is the canonical TS mock layer.
//   - MSW supports per-test override via `server.use(...)` so individual
//     tests can swap a handler to simulate 404 / 5xx / timeouts. The default
//     handlers below are HAPPY-PATH; tests opt into failure modes.
//
// Lifecycle (call from tests in beforeAll / afterEach / afterAll):
//
//   import { setupExternalMocks } from '@/test/external-mocks'
//   const mocks = setupExternalMocks()
//   beforeAll(() => mocks.listen())
//   afterEach(() => mocks.resetHandlers())
//   afterAll(() => mocks.close())
//
// Per-test override helpers (use inside `it`/`test`):
//
//   mocks.brasilapiReturn(cnpj, { situacao_cadastral: 8 })  // BAIXADA
//   mocks.brasilapiReturn(cnpj, 404)                        // 404 not found
//   mocks.brasilapiReturn(cnpj, 503)                        // 5xx degrade
//
// REFERENCES:
//   - ZapSign endpoints:  01-RESEARCH.md §A7 (sandbox + production URLs)
//   - Pagar.me endpoints: 01-RESEARCH.md §A8 (Basic Auth + orders REST)
//   - BrasilAPI:          01-RESEARCH.md §A10 (no auth + 24h cache)
//   - Resend:             Phase 0 src/lib/email.ts

import { HttpResponse, http, type RequestHandler } from 'msw'
import { setupServer } from 'msw/node'

// ────────────────────────────────────────────────────────────────────────────
// Fixture: canonical happy-path response shapes
// ────────────────────────────────────────────────────────────────────────────

/** ZapSign POST /docs response — the canonical happy-path shape. */
export const ZAPSIGN_CREATE_DOC_RESPONSE = {
  open_id: 12345,
  token: 'zs_test_token_abc123',
  status: 'pending',
  name: 'Contrato Fornecedor — Stand A-12',
  folder_path: '/',
  rejected_reason: null,
  lang: 'pt-br',
  signed_file: null,
  original_file: 'https://sandbox.api.zapsign.com.br/files/original.pdf',
  created_through: 'api',
  signature_order_active: true,
  signers: [
    {
      token: 'zs_signer_org_token',
      sign_url: 'https://sandbox.app.zapsign.com.br/sign/zs_signer_org_token',
      name: 'Organizadora Teste',
      email: 'org@example.com',
      order_group: 1,
      status: 'new',
    },
    {
      token: 'zs_signer_vendor_token',
      sign_url: 'https://sandbox.app.zapsign.com.br/sign/zs_signer_vendor_token',
      name: 'Fornecedor Teste',
      email: 'fornecedor@example.com',
      order_group: 2,
      status: 'new',
    },
  ],
}

/** ZapSign webhook payload for the doc_signed event (used by tests/contracts/zapsign-webhook). */
export const ZAPSIGN_WEBHOOK_DOC_SIGNED = {
  event_type: 'doc_signed',
  open_id: 12345,
  token: 'zs_test_token_abc123',
  status: 'signed',
  signers: [
    { token: 'zs_signer_org_token', status: 'signed', signed_at: '2026-06-14T10:00:00Z' },
    { token: 'zs_signer_vendor_token', status: 'signed', signed_at: '2026-06-14T11:00:00Z' },
  ],
  signed_file: 'https://sandbox.api.zapsign.com.br/files/signed.pdf',
}

/** Pagar.me POST /orders response — happy-path PIX. */
export const PAGARME_PIX_ORDER_RESPONSE = {
  id: 'or_test_abc123',
  code: 'PIX_ORDER_001',
  status: 'pending',
  amount: 100000, // R$ 1000.00 in cents
  currency: 'BRL',
  customer: { id: 'cus_test_abc', email: 'cliente@example.com' },
  charges: [
    {
      id: 'ch_test_abc123',
      status: 'pending',
      payment_method: 'pix',
      amount: 100000,
      last_transaction: {
        id: 'tran_test_abc123',
        transaction_type: 'pix',
        qr_code: '00020126...PIX_COPIA_COLA_TEST',
        qr_code_url: 'https://api.pagar.me/qr/test.png',
        expires_at: '2026-06-15T12:00:00Z',
      },
    },
  ],
  created_at: '2026-06-14T10:00:00Z',
}

/** Pagar.me webhook payload — order.paid (used to confirm payment). */
export const PAGARME_WEBHOOK_ORDER_PAID = {
  id: 'hook_test_abc',
  type: 'order.paid',
  data: {
    ...PAGARME_PIX_ORDER_RESPONSE,
    status: 'paid',
    charges: [
      {
        ...PAGARME_PIX_ORDER_RESPONSE.charges[0],
        status: 'paid',
        paid_at: '2026-06-14T10:05:00Z',
      },
    ],
  },
  created_at: '2026-06-14T10:05:01Z',
}

/** BrasilAPI happy-path response — situação ATIVA. */
export const BRASILAPI_CNPJ_ACTIVE = {
  cnpj: '12345678000190',
  razao_social: 'EMPRESA TESTE LTDA',
  nome_fantasia: 'Empresa Teste',
  situacao_cadastral: 2, // 2 = ATIVA
  descricao_situacao_cadastral: 'ATIVA',
  data_situacao_cadastral: '2020-01-01',
  cnae_fiscal: 4781400,
  cnae_fiscal_descricao: 'Comércio varejista de artigos do vestuário e acessórios',
  logradouro: 'AV TESTE',
  numero: '100',
  complemento: null,
  bairro: 'CENTRO',
  municipio: 'TRINDADE',
  uf: 'GO',
  cep: '75380000',
  ddd_telefone_1: '62999990000',
  email: 'contato@empresateste.com.br',
}

/** Resend happy-path send response. */
export const RESEND_SEND_RESPONSE = {
  id: 'resend_msg_test_abc',
}

// ────────────────────────────────────────────────────────────────────────────
// Per-CNPJ override registry — tests may seed specific responses
// ────────────────────────────────────────────────────────────────────────────

interface BrasilApiOverride {
  status: number
  body: unknown
}

const brasilApiOverrides = new Map<string, BrasilApiOverride>()

// ────────────────────────────────────────────────────────────────────────────
// MSW default handlers (happy-path)
// ────────────────────────────────────────────────────────────────────────────

function buildHandlers() {
  return [
    // ─── ZapSign sandbox + production ─────────────────────────────────────
    http.post('https://sandbox.api.zapsign.com.br/api/v1/docs/', async () => {
      return HttpResponse.json(ZAPSIGN_CREATE_DOC_RESPONSE, { status: 201 })
    }),
    http.post('https://api.zapsign.com.br/api/v1/docs/', async () => {
      return HttpResponse.json(ZAPSIGN_CREATE_DOC_RESPONSE, { status: 201 })
    }),

    // ─── Pagar.me v5 orders ────────────────────────────────────────────────
    http.post('https://api.pagar.me/core/v5/orders', async () => {
      return HttpResponse.json(PAGARME_PIX_ORDER_RESPONSE, { status: 200 })
    }),

    // ─── BrasilAPI CNPJ ────────────────────────────────────────────────────
    http.get('https://brasilapi.com.br/api/cnpj/v1/:cnpj', ({ params }) => {
      const cnpj = String(params.cnpj ?? '').replace(/\D/g, '')
      const override = brasilApiOverrides.get(cnpj)
      if (override) {
        return HttpResponse.json(override.body as Parameters<typeof HttpResponse.json>[0], {
          status: override.status,
        })
      }
      return HttpResponse.json({ ...BRASILAPI_CNPJ_ACTIVE, cnpj }, { status: 200 })
    }),

    // ─── Resend ────────────────────────────────────────────────────────────
    http.post('https://api.resend.com/emails', async () => {
      return HttpResponse.json(RESEND_SEND_RESPONSE, { status: 200 })
    }),
  ]
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — setupExternalMocks()
// ────────────────────────────────────────────────────────────────────────────

export interface ExternalMocks {
  /** Start the MSW interceptor. Call in beforeAll. */
  listen: () => void
  /** Reset overrides + re-install default handlers. Call in afterEach. */
  resetHandlers: () => void
  /** Stop the MSW interceptor. Call in afterAll. */
  close: () => void
  /** Per-test override: set BrasilAPI response for a CNPJ. */
  brasilapiReturn: (cnpj: string, response: number | Record<string, unknown>) => void
  /** Per-test override: install one or more MSW handlers (use `http.*` builders). */
  use: (...handlers: RequestHandler[]) => void
}

/**
 * Build and return an MSW server pre-configured with happy-path handlers for
 * every external API Phase 1 talks to. The returned object exposes
 * `listen / resetHandlers / close` for the standard test lifecycle plus
 * per-test override helpers.
 *
 * Usage:
 *
 *   import { setupExternalMocks } from '@/test/external-mocks'
 *
 *   const mocks = setupExternalMocks()
 *   beforeAll(() => mocks.listen())
 *   afterEach(() => mocks.resetHandlers())
 *   afterAll(() => mocks.close())
 *
 *   it('handles BrasilAPI 404', () => {
 *     mocks.brasilapiReturn('00000000000000', 404)
 *     // ... exercise code path that hits BrasilAPI ...
 *   })
 */
export function setupExternalMocks() {
  const server = setupServer(...buildHandlers())

  return {
    listen: () => server.listen({ onUnhandledRequest: 'bypass' }),
    resetHandlers: () => {
      brasilApiOverrides.clear()
      server.resetHandlers(...buildHandlers())
    },
    close: () => server.close(),

    /**
     * Seed a BrasilAPI override for a specific CNPJ.
     * @param cnpj  14-digit CNPJ (digits only or formatted — both accepted).
     * @param response Either:
     *   - a number → return that HTTP status with an error body
     *   - an object → merge into the default ACTIVE response and return 200
     */
    brasilapiReturn(cnpj: string, response: number | Record<string, unknown>): void {
      const cleaned = cnpj.replace(/\D/g, '')
      if (typeof response === 'number') {
        brasilApiOverrides.set(cleaned, {
          status: response,
          body:
            response === 404
              ? { type: 'cnpj_error', message: 'CNPJ não encontrado' }
              : { message: 'BrasilAPI unavailable' },
        })
      } else {
        brasilApiOverrides.set(cleaned, {
          status: 200,
          body: { ...BRASILAPI_CNPJ_ACTIVE, cnpj: cleaned, ...response },
        })
      }
    },

    /**
     * Install one or more custom handlers for this test. Pass-through to
     * msw's `server.use(...)`. Reset by `resetHandlers()` in afterEach.
     */
    use(...handlers: RequestHandler[]): void {
      server.use(...handlers)
    },
  }
}
