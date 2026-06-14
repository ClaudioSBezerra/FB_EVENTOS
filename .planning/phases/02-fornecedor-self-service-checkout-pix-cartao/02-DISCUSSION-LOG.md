# Phase 2 Discussion Log — 2026-06-14

> For human reference only (audits, retrospectives). Downstream agents read CONTEXT.md, not this file.

## Mode

- **Workflow:** `gsd-discuss-phase` (auto-invoked via `/gsd-progress --next` → Route 6 advance)
- **Mode:** `discuss` (default; no flags)
- **Duration:** 3 rounds of AskUserQuestion (1 area selection + 2 drill-down rounds)

## Areas Selected for Discussion

Apresentadas 4 gray areas; usuário selecionou TODAS as 4:

1. Cart + add-ons (FORN-08) — escopo
2. Pagamento mix — cartão parcelas + boleto?
3. Refund/estorno policy (FORN-16) — regras
4. Waitlist channel (FORN-15) — WhatsApp ou só email?

## Rounds

### Round 1 — Cornerstone decisions (1 question per area)

| Pergunta | Opção escolhida |
|---|---|
| Cart + add-ons | **Phase 2 inclui add-ons como produtos separados** (recommended) — `event_addons` table com checkbox no checkout |
| Pagamento mix | **PIX + cartão + boleto (3 métodos completos)** — NÃO escolheu o recommended "PIX + cartão 6x sem juros"; quer trinity completa |
| Refund policy | **Self-service + política temporal automática** (recommended) — fornecedor cancela sozinho |
| Waitlist channel | **Email only em Phase 2** (recommended) — sem WhatsApp |

### Round 2 — Execution details (1 question per area)

| Pergunta | Opção escolhida |
|---|---|
| Cartão — parcelas e juros | **Até 12x COM juros** (Pagar.me calcula) — NÃO escolheu o recommended "6x sem juros" |
| Boleto — vencimento + PIX híbrido | **3 dias úteis com PIX híbrido** (recommended) |
| Refund — política temporal default | **4-tier (>30d=100%, 15-30d=50%, 7-15d=25%, <7d=0%)** (recommended) configurável por tenant |

## Notable Choices

- **2 desvios do "recommended":**
  1. Trinity completa de métodos (PIX + cartão + boleto) em vez de "PIX + cartão sem juros"
  2. Cartão até 12x COM juros (Pagar.me calcula) em vez de 6x sem juros
- Padrão deste usuário (visto em Phase 1 também): escolher opções com MAIS escopo + flexibilidade quando o piloto Trindade pode demandar (vide D-12 dashboard "ambos lado-a-lado" em Phase 1).

## Deferred Ideas Captured

Capturadas em CONTEXT.md `<deferred>`:
- WhatsApp Business API para waitlist (Phase 3 ou 4)
- Split de pagamento + subscriptions (Phase 3)
- Prestadores + comissionamento (Phase 3)
- Marketplace SSR público + white-label (Phase 4)
- PWA + check-in offline (Phase 4)
- Cart abandonment recovery (polish)
- 2FA obrigatória pro fornecedor (polish)

## Scope Creep Redirected

Nenhum item de scope creep emergiu. Discussão ficou dentro de Phase 2.

## Next Steps

1. Researcher escreve `02-RESEARCH.md` com deep-dives em:
   - Pagar.me v5 webhook HMAC signature (exact header + algorithm + secret rotation policy)
   - Pagar.me v5 boleto + PIX híbrido API shape
   - Pagar.me v5 cartão installments (1..12 com juros embutidos)
   - Pagar.me v5 refunds (PIX + cartão authorize/capture + boleto refund-via-PIX)
   - Postgres `pg_try_advisory_xact_lock(hashtext('lot:'||event_id||':'||lot_id))` performance
   - Next.js 15 SSE Route Handler patterns (keepalive + Last-Event-ID + reconnect)
   - Outbox pattern with single `outbox_events` table + Graphile-Worker polling drain
   - Better Auth org plugin signup-by-slug semantics
2. Planner consome CONTEXT.md + RESEARCH.md, gera `02-XX-PLAN.md` files (provável: 8-10 plans em ~5-6 waves)
3. Esperado: ADRs novas 0005 (HMAC) + 0006 (outbox) + 0007 (refund policy)

---

*Phase: 02-fornecedor-self-service-checkout-pix-cartao*
*Discussion: 2026-06-14*
