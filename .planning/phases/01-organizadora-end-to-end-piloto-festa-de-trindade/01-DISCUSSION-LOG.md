# Phase 1 Discussion Log — 2026-06-12

> For human reference only (audits, retrospectives). Downstream agents read CONTEXT.md, not this file.

## Mode

- **Workflow:** `gsd-discuss-phase`
- **Mode:** `discuss` (default; no flags)
- **Duration:** ~5 turns of AskUserQuestion (1 area selection + 3 deep-dive rounds)

## Areas Selected for Discussion

Apresentadas 4 gray areas; usuário selecionou todas as 4:

- E-sign provider — ZapSign vs Clicksign
- MinIO — self-host vs S3 BR + topologia
- PDF de contrato — stack de geração
- Piloto Trindade — timeline + seed data + ownership

Outras 6 gray areas identificadas durante análise (geometria jsonb, auto-save granularity, BrasilAPI degradation, pricing model, dashboard visualization, Resend templates) foram tratadas como sub-questões dentro das 4 áreas ou como Claude's discretion para o planner.

## Rounds

### Round 1 — Cornerstone decisions (1 question per area)

| Pergunta | Opção escolhida |
|---|---|
| E-sign provider | **ZapSign** (recommended) — alternativa Clicksign, alternativa "decidir na pesquisa" |
| MinIO topologia | **Self-host + bucket-per-tenant** (recommended) — alternativa prefix-per-tenant, alternativa S3 sa-east-1 |
| PDF stack | **@react-pdf/renderer** (recommended) — alternativa Puppeteer, alternativa PDFKit |
| Piloto ownership | **Você opera dev/staging; piloto real depois** (recommended) — alternativa real desde staging, alternativa decidir depois |

### Round 2 — Execution details (1 question per area)

| Pergunta | Opção escolhida |
|---|---|
| ZapSign ordem de assinatura | **Sequencial: organizadora primeiro, depois fornecedor** (recommended) |
| MinIO upload pattern | **Pre-signed PUT direto browser → MinIO** (recommended) |
| Template do contrato source-of-truth | **Hardcoded TS file por categoria, versão em commit** (recommended) |
| Gate sandbox → produção | **Gate técnico: smoke E2E + 1 cobrança sandbox + 1 contrato sandbox assinado** (recommended) |

### Round 3 — Structural decisions

| Pergunta | Opção escolhida |
|---|---|
| Dashboard de ocupação visualização | **Ambos lado-a-lado** (mapa Konva colorido + cards) — usuário escolheu opção mais completa, não a "recommended" minimalista |
| Modelo de preço de lote | **Aditivo: `base_fixo + m² × rate`** (recommended) |
| Auto-save granularidade | **Por lote, debounce 1s** (recommended) |
| Conteúdo de emails Resend | **Você escreve placeholders curtos pt-BR** (recommended) |

## Notable Choices

- **Apenas 1 desvio do "recommended"**: dashboard de ocupação. Você escolheu a opção mais rica (mapa Konva + cards lado-a-lado) ao invés do mapa-só recommended. Sinal: para o piloto Trindade a UX rica vale o custo de UI adicional.
- **Zero pushback nos "decidir na pesquisa"**. Todas as decisões viáveis foram travadas no discuss. ADR-0002 (e-sign) ainda será escrita pelo researcher para formalizar a comparação ZapSign vs Clicksign — mas com decisão default = ZapSign.

## Deferred Ideas Captured

Capturadas em CONTEXT.md `<deferred>`:
- Cópia de lotes (cmd+D) no editor — polish
- React Email rich templates — polish
- Real-time SSE no dashboard de ocupação — Phase 2+
- Templates de contrato editáveis pela organizadora — Phase 3
- Tudo de Phase 2-4 (split, subscriptions, marketplace, PWA, etc.)

## Scope Creep Redirected

Nenhum item de scope creep emergiu. Discussão ficou dentro de Phase 1.

## Next Steps

1. Researcher escreve `01-RESEARCH.md` com:
   - ZapSign vs Clicksign deep-dive (formaliza ADR-0002)
   - MinIO bucket-per-tenant + Lifecycle LGPD setup details
   - @react-pdf/renderer limitations + template patterns
   - BrasilAPI SLA + degradation strategy
   - Konva polygon2d v1 jsonb shape exato
   - Pagar.me Orders + Charges API (sem split)
2. Planner consome CONTEXT.md + RESEARCH.md, gera `01-XX-PLAN.md` files com tasks executáveis
3. Plano provavel: ~6-10 plans em ~3-5 waves

---

*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Discussion: 2026-06-12*
