# ADR-0002 — Provider de Assinatura Eletrônica (ZapSign)

- **Status:** Accepted
- **Data:** 2026-06-14
- **Plano:** 01-05 (Phase 1 — Organizadora end-to-end piloto Festa de Trindade)
- **Decisão original:** CONTEXT.md D-01 + D-02 + D-03

## Contexto

A Fase 1 entrega o ciclo organizadora → fornecedor para a Festa de
Trindade/GO. Parte desse ciclo é o **contrato de cessão de espaço**,
gerado em PDF e assinado eletronicamente pela organizadora e pelo
fornecedor — nessa ordem (D-02 sequencial).

Critérios de avaliação:

1. **Custo no piloto**: organizadora emite até ~50 contratos no piloto
   (Festa de Trindade tem ~900k pessoas mas apenas ~100 fornecedores).
   Cobrança por documento muda muito entre os dois competidores.
2. **REST API + sandbox confiável**: precisamos invocar via `fetch` puro
   com Zod (CLAUDE.md "no SDK") e validar end-to-end no sandbox antes
   do gate D-14.
3. **Webhook reliability + autenticação**: precisamos defender contra
   replay/spoof. Pelo menos um de:
   - HMAC signature header com secret compartilhado (ideal)
   - HTTP Basic Auth + IP allowlist
   - Re-fetch do documento via API após webhook (belt-and-suspenders)
4. **Assinatura sequencial** (D-02): ordem `org → fornecedor`. Provider
   precisa nativamente suportar `signer_order` ou equivalente — não
   queremos simular ordem com 2 envelopes separados.
5. **Idiomas pt-BR + UX brasileira** (Festa de Trindade é GO; fornecedores
   locais).
6. **DX para Claudio (dev solo + AI)**: docs públicas + samples cURL
   visíveis ao Claude Code; SDKs oficiais opcionais.

## Decisão

Adotar **ZapSign** como provider de e-sign da Fase 1.

Implementação:

- Sandbox em dev/staging — base URL `https://sandbox.api.zapsign.com.br/api/v1`
  (D-03; gate D-14 flipa para production após smoke E2E).
- Auth: Bearer token via env var `ZAPSIGN_TOKEN`. Switch sandbox→production
  via `ZAPSIGN_ENV` enum.
- Cliente em `src/lib/zapsign/client.ts` (fetch + Zod, sem SDK).
- POST `/api/v1/docs/` com `signature_order_active: true` e cada signer
  carregando `order_group: 1` (organizadora) ou `2` (fornecedor). ZapSign
  gerencia a sequência: o convite para `order_group=2` só dispara quando
  o signer `order_group=1` completa.
- Webhook callback em `/api/webhooks/zapsign` autenticado por HTTP Basic
  Auth (env `ZAPSIGN_WEBHOOK_USER` + `ZAPSIGN_WEBHOOK_PASS`). **Defesa
  belt-and-suspenders**: além do Basic Auth, o handler re-fetcha o
  documento via `GET /api/v1/docs/:token/` antes de transitar o FSM, então
  ZapSign API é a fonte da verdade — webhook é só notificação.

## Comparação

| Critério                          | **ZapSign**                                                         | **Clicksign**                                                |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Cobrança no piloto (50 docs/mês) | Tier gratuito 5 docs/mês + plano básico ~R$ 30/mês para 50 docs    | Webhook + API gated em plano Enterprise (~R$ 2.500+/mês)     |
| REST API                          | `POST /api/v1/docs/` direto + JSON, docs limpas, exemplos cURL     | API v3 Envelopes mais elaborada, requer fluxo de envelope    |
| Sandbox UX                        | URL dedicada `sandbox.api.zapsign.com.br` — flip sem flag         | Sandbox separado mas restrito a Enterprise no início         |
| Assinatura sequencial             | Nativo: `signature_order_active: true` + `order_group`             | Nativo: ordem definida no envelope                           |
| Autenticação webhook              | HTTP Basic Auth (per-webhook) — **sem HMAC nativo**                | HMAC SHA-256 com secret (Enterprise)                         |
| pt-BR / UX brasileira             | pt-BR nativo (empresa brasileira, sede em SP)                       | pt-BR nativo (empresa brasileira, sede em Florianópolis)     |
| DX para dev solo                   | Docs públicas + community Discord                                   | Docs requerem login + suporte direcionado a clientes Enterprise |
| Maturidade                        | Lançamento 2019, ~1M docs/mês em 2026                              | Lançamento 2014, líder em volume Enterprise                  |
| Trail de auditoria                | Hash + timestamp + IP/geo em PDF assinado                          | Hash + timestamp + IP/geo + cadeia de custódia ICP-Brasil   |

## Decisão racional

ZapSign vence no contexto da Fase 1 piloto por **três motivos
load-bearing**:

1. **Custo** — 50 docs/mês cabem no tier gratuito + paid ~R$ 30/mês.
   Clicksign exige plano Enterprise (~R$ 2.500/mês) só para webhook +
   API. Em uma SaaS que ainda não monetiza, isso é proibitivo.
2. **DX** — ZapSign docs públicas + sandbox dedicado por URL = setup
   em 1 hora. Clicksign requer onboarding comercial antes de acessar
   webhook + API. Para dev solo + AI esse atrito mata produtividade.
3. **Adequação técnica** — sequential signers funcionam nativamente em
   ambos; idempotência via re-fetch defense é equivalente em segurança
   ao HMAC (ZapSign não tem HMAC nativo mas a re-fetch defesa cobre).

A ausência de HMAC nativo é mitigada pela combinação:

- Basic Auth no header (chaves rotacionáveis via Coolify env).
- Re-fetch do documento via `GET /api/v1/docs/:token/` antes de
  transitar contracts.status. Mesmo se um atacante forjar um webhook
  com Basic Auth válido, o re-fetch a ZapSign API revela a verdade.
- UNIQUE em `zapsign_documents(zapsign_id)` torna duplicatas no-op.

## Alternativas consideradas

| Provider          | Por que considerei                          | Por que rejeitei                                                                                       |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **ZapSign** ✅    | Custo + DX + adequado tecnicamente          | Adotado.                                                                                                |
| Clicksign         | Maturidade + HMAC nativo + ICP-Brasil       | Webhook + API gated em Enterprise (~R$ 2.500+/mês). Inviável no piloto.                                |
| DocuSign          | Líder global, robusto                       | Mensalidade USD ~$30-40/usuário, mínimo 5 usuários. Documentação pt-BR fraca. Sandbox restrito.        |
| Adobe Sign        | Líder global, integração com Adobe          | Pricing por documento alto (~$2/doc). Sem foco em mercado brasileiro.                                  |
| Bry (BRy Tecnologia)| ICP-Brasil + foco brasileiro              | Foco em assinatura digital tributária + jurídica; API mais limitada para fluxo SaaS.                   |
| AssineBem         | Brasileiro + barato                         | API + webhook estavam em beta na pesquisa (2026-06-13); maturidade ainda em construção.                |

## Consequências

### Positivas

- Custo mensal previsível durante o piloto (~R$ 30 + 5 docs grátis).
- Setup do sandbox em menos de 1 hora (dashboard + token + webhook).
- Componente belt-and-suspenders (Basic Auth + re-fetch) atinge nível
  de segurança equivalente a HMAC para os ataques previstos.
- Suporte nativo a sequential signers — sem código de orquestração nosso.
- Sandbox URL separado elimina o risco de "esqueci de flagar prod=true".

### Negativas

- Sem HMAC nativo no webhook → re-fetch é obrigatório (latência extra ~200 ms
  por callback). Aceitável para Fase 1 (volume baixo).
- Sem ICP-Brasil-grade auditoria — válido para contratos não-tributários
  + não-jurisprudenciais (que é o caso da Fase 1). Para Fase 3+ se a
  organizadora pedir contratos com força executiva extrajudicial, vamos
  precisar reconsiderar (Clicksign + ICP-Brasil-grade).
- Single-vendor lock — embora `src/lib/zapsign/client.ts` seja um shim
  fino sobre fetch, vendor swap exigiria refactor do contrato `signers[]`
  e da semântica de `order_group`.

### Quando reconsiderar (revisit triggers)

- Volume atinge >500 docs/mês → reavaliar pricing Clicksign Enterprise vs
  ZapSign paid tier.
- Cliente exige ICP-Brasil-grade audit trail.
- Webhook spoofing observado em produção (move para HMAC obrigatório).
- ZapSign API tem outage >2 horas em produção → Fase 3 adiciona Clicksign
  como segundo provider com feature flag.

## Referências

- CONTEXT.md D-01 + D-02 + D-03 (decisões originais).
- 01-RESEARCH.md §A7 (ZapSign REST API + Sequential Sign).
- 01-RESEARCH.md §ZapSign vs Clicksign (comparação detalhada).
- `src/lib/zapsign/client.ts` + `src/lib/zapsign/types.ts`
- `src/jobs/tasks/zapsign-send-contract.ts`
- `src/jobs/tasks/zapsign-webhook-process.ts` (Plan 01-05 Task 3)
- ZapSign docs: <https://docs.zapsign.com.br/>
- ZapSign sandbox: <https://sandbox.app.zapsign.co/>
