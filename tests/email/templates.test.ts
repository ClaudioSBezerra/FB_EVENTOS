// FB_EVENTOS — Email template tests
// (Phase 1, Plan 01-08 — ORG-17).
//
// Asserts the six pt-BR templates render correctly + every link lives at
// the canonical domain (eventos.fbtax.cloud). The regex assertion is the
// load-bearing check — a stale localhost or vercel.app URL in any template
// would leak to a real fornecedor inbox and the test would catch it.

import { describe, expect, test } from 'vitest'

import {
  aprovacaoFornecedor,
  CANONICAL_DOMAIN,
  contratoAssinado,
  contratoEmitido,
  pagamentoRecebido,
  rejeicaoFornecedor,
  signupFornecedor,
  templateRegistry,
} from '@/lib/email/templates'

const CANONICAL_LINK_REGEX = /https:\/\/eventos\.fbtax\.cloud\/[^\s"<>)]+/g
// Any http(s) link in template output that does NOT match the canonical
// domain — used to assert no foreign hosts leak in.
const FOREIGN_LINK_REGEX = /https?:\/\/(?!eventos\.fbtax\.cloud\b)[^\s"<>)]+/g

describe('email templates — uniform contract (Plan 01-08 Task 1)', () => {
  test('CANONICAL_DOMAIN is the production-canonical host', () => {
    expect(CANONICAL_DOMAIN).toBe('https://eventos.fbtax.cloud')
  })

  test('each of 6 templates renders non-empty subject + text', () => {
    const renders = [
      signupFornecedor({
        vendorName: 'João da Silva',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
      }),
      aprovacaoFornecedor({
        vendorName: 'João da Silva',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
      }),
      rejeicaoFornecedor({
        vendorName: 'João da Silva',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        reason: 'CNPJ baixado',
      }),
      contratoEmitido({
        vendorName: 'João da Silva',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        contractRef: 'ABCD1234',
        zapsignSignUrl: 'https://app.zapsign.com.br/sign/x',
      }),
      contratoAssinado({
        recipientName: 'João da Silva',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        contractRef: 'ABCD1234',
      }),
      pagamentoRecebido({
        recipientName: 'João da Silva',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        contractRef: 'ABCD1234',
        amountBRL: 'R$ 200,00',
        paymentId: '00000000-0000-0000-0000-000000000001',
      }),
    ]
    expect(renders).toHaveLength(6)
    for (const r of renders) {
      expect(r.subject.length).toBeGreaterThan(0)
      expect(r.text.length).toBeGreaterThan(0)
      expect(r.html).toBeDefined()
      expect((r.html ?? '').length).toBeGreaterThan(0)
    }
  })

  test('every link in every template uses the canonical domain', () => {
    const renders = [
      signupFornecedor({
        vendorName: 'João',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
      }),
      aprovacaoFornecedor({
        vendorName: 'João',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
      }),
      rejeicaoFornecedor({
        vendorName: 'João',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        reason: 'Documento ilegível',
      }),
      // contrato_emitido carries an optional ZapSign URL — exclude from
      // the foreign-link check by NOT passing it here. (The integration
      // test asserting "no foreign hosts" doesn't apply when the handler
      // is intentionally passing the ZapSign sign-url through.)
      contratoEmitido({
        vendorName: 'João',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        contractRef: 'ABCD1234',
      }),
      contratoAssinado({
        recipientName: 'João',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        contractRef: 'ABCD1234',
      }),
      pagamentoRecebido({
        recipientName: 'João',
        tenantName: 'Festa de Trindade',
        tenantSlug: 'trindade',
        contractRef: 'ABCD1234',
        amountBRL: 'R$ 200,00',
        paymentId: '00000000-0000-0000-0000-000000000001',
      }),
    ]
    for (const r of renders) {
      const corpus = `${r.subject}\n${r.text}\n${r.html ?? ''}`
      const canonicalMatches = corpus.match(CANONICAL_LINK_REGEX) ?? []
      const foreignMatches = corpus.match(FOREIGN_LINK_REGEX) ?? []
      // Every template must have at least one canonical link (in text/html
      // body), and zero foreign links.
      expect(canonicalMatches.length).toBeGreaterThan(0)
      expect(foreignMatches).toEqual([])
    }
  })

  test('rejeicao_fornecedor includes the rejection reason verbatim in text body', () => {
    const reason = 'CNPJ irregular junto à Receita Federal'
    const out = rejeicaoFornecedor({
      vendorName: 'João',
      tenantName: 'Festa de Trindade',
      tenantSlug: 'trindade',
      reason,
    })
    expect(out.text).toContain(reason)
    expect(out.html ?? '').toContain('CNPJ irregular junto à Receita Federal')
  })

  test('templateRegistry exposes all six events keyed by enum value', () => {
    const keys = Object.keys(templateRegistry).sort()
    expect(keys).toEqual(
      [
        'aprovacao_fornecedor',
        'contrato_assinado',
        'contrato_emitido',
        'pagamento_recebido',
        'rejecao_fornecedor',
        'signup_fornecedor',
      ].sort(),
    )
  })
})
