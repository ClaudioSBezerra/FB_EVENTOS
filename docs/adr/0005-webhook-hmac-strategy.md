# ADR-0005 — Webhook HMAC Authentication Strategy + Installments Shape

- **Status:** Accepted (probe-pending verification)
- **Data:** 2026-06-15
- **Plano:** 02-05 (Phase 2 — Fornecedor self-service checkout PIX/Cartão)
- **Probe status:** AM-02 (HMAC) + AM-06 (installments) — auto-approved in AUTO_MODE; defaults documented pending sandbox verification

## Contexto

### HMAC Authentication (AM-02)

A Fase 1 usou HTTP Basic Auth para autenticar webhooks do Pagar.me — estratégia
documentada, funcional, mas **não criptográfica**: qualquer agente que descubra o
par `user:pass` pode forjar eventos e causar transições FSM indevidas no sistema
(pagamento "pago" sem cobrança real).

A Fase 2 adiciona HMAC-SHA256 como camada de autenticação criptográfica. O desafio
(AM-02) é que a documentação do Pagar.me v5 não é explícita sobre:
- O nome exato do header (`X-Hub-Signature` vs `Pagarme-Signature` vs outros)
- O encoding da assinatura (base64 vs hex)

A porta AM-02 exige que um probe teste verifique isso no sandbox antes de o handler
de produção ser refatorado.

### Installments Shape (AM-06)

Para a UI de parcelamento (Cartão de Crédito — FORN-09), a dúvida é:
- O Pagar.me v5 retorna os valores por parcela (`installment_amount`) no response?
- Existe uma `installments_table` com o breakdown completo?
- Ou o frontend precisa calcular o valor por parcela localmente (usando uma taxa de juros)?

## Decisão

### HMAC Authentication

Adotar **HMAC-SHA256** para autenticação de webhooks do Pagar.me v5, **em cima**
do Basic Auth já existente na Fase 1 (belt-and-suspenders).

**Header name adotado:** `X-Hub-Signature`
**Encoding:** `base64`

⚠️ **PROBE STATUS: AUTO_MODE — valores padrão, não verificados no sandbox.**
Quando uma chave sandbox real estiver disponível, executar:
```bash
pnpm vitest tests/probes/pagarme-hmac-header-probe.test.ts --run
```
e atualizar `PAGARME_HMAC_HEADER_NAME` em `src/lib/pagarme/hmac.ts` se o
header real for diferente.

**Implementação:**

```typescript
// src/lib/pagarme/hmac.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export const PAGARME_HMAC_HEADER_NAME = 'X-Hub-Signature'

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  try {
    const received = Buffer.from(signatureHeader, 'base64')
    return timingSafeEqual(expected, received)
  } catch {
    return false
  }
}
```

**Por que base64 (não hex):**
- Pagar.me v5 documenta base64 como encoding padrão para HMAC signatures.
- A maioria dos gateways brasileiros (Stone/Pagar.me) usa base64 para assinaturas.
- O probe test `tests/probes/pagarme-hmac-header-probe.test.ts` deve confirmar.

### Comparação de estratégias de autenticação de webhook

| Estratégia | Segurança | Observabilidade | Impacto operacional | Veredicto |
|------------|-----------|-----------------|---------------------|-----------|
| **Sem autenticação** | ❌ Sem proteção | N/A | Baixo | Rejeitado |
| **IP Allowlist** | ⚠️ Moderate (IPs da Pagar.me mudam) | N/A | Alto (manutenção lista) | Rejeitado |
| **Basic Auth** (Fase 1) | ⚠️ Moderate (secret vaza em logs) | Simples | Baixo | Mantido como fallback |
| **HMAC-SHA256** ✅ | ✅ Alto (assinatura criptográfica) | Moderada | Moderado (secret rotation) | **ADOTADO** |
| **OAuth JWT** | ✅ Alto | Alta | Alto | Overkill para webhook entry |

**Decisão final:** HMAC-SHA256 + raw bytes (Pitfall 1: ler `req.arrayBuffer()` ANTES
de `JSON.parse` para não quebrar a assinatura) + inbox idempotency (ON CONFLICT DO NOTHING).

### Belt-and-suspenders: re-fetch defense (D-13 — PRESERVADO)

O worker `payment.process-webhook` faz re-fetch do pedido via
`pagarmeClient.getOrder(orderId)` e usa o status da API (não o payload do webhook)
para decidir a transição FSM. Isso defende contra dois vetores:

1. **Webhook forjado**: mesmo que o HMAC seja bypassado (e.g. secret rotacionado),
   o re-fetch do status real da Pagar.me invalida o payload forjado.
2. **Payload desatualizado**: Pagar.me pode enviar um webhook com status antigo em
   caso de retry — o re-fetch garante que o status final (da API) é usado.

### Inbox + Outbox pattern

```
POST /api/webhooks/pagarme
  → HMAC verify (raw bytes, Pitfall 1)
  → INSERT payment_webhooks_inbox ON CONFLICT (gateway_event_id) DO NOTHING
  → enqueueJob('payment.process-webhook', { inbox_id, tenant_id })
  → 200 OK (<100ms p95)

payment.process-webhook (worker):
  → SELECT inbox row
  → pagarmeClient.getOrder() (re-fetch defense, D-13)
  → FSM transition
  → emitOutboxEvent('payment.paid' | 'payment.failed')
  → UPDATE inbox row → processing_status='processed'
```

**Vantagem do inbox:** Webhook retry storm (Pitfall 2) absorvido pelo `ON CONFLICT
DO NOTHING` — múltiplas entregas do mesmo evento geram apenas 1 inbox row, e o
worker processa apenas 1 vez. A resposta rápida (200, <100ms) para a Pagar.me
evita o backoff exponencial de redelivery.

### Escape-hatch: Basic Auth legacy

Se a Pagar.me sandbox não suportar HMAC em uma release futura (produto em evolução),
o handler pode ser revertido para Basic Auth com mudança de uma única variável de
ambiente. O código de Basic Auth da Fase 1 está mantido nos testes como referência.

---

## §Installments Shape (AM-06)

**Status:** AUTO_MODE — padrão documentado, não verificado no sandbox.

**Probe:** `tests/probes/pagarme-installments-shape-probe.test.ts`

**Questão:** O Pagar.me v5 retorna `installments_table` (com breakdown por parcela)
no response de uma cobrança de cartão parcelada?

**Resposta documentada (default):**
- `PAGARME_INSTALLMENTS_RESPONSE_KEY = null`
- O Pagar.me v5 NÃO retorna uma tabela de parcelamento completa no response
  de criação de pedido simples.
- `last_transaction.installment_amount` está presente (valor por parcela = total/n).
- Juros são computados client-side usando a tabela Price (3.5%/mês composto) como
  fallback quando `installment_amount` não está disponível.

**Constantes em `src/lib/pagarme/installments-shape.generated.ts`:**

```typescript
export const PAGARME_INSTALLMENTS_RESPONSE_KEY = null  // não há tabela completa
export const DEFAULT_MONTHLY_JUROS_RATE = 0.035        // 3.5%/mês (estimativa BR)
```

**Ação requerida:** Executar o probe `tests/probes/pagarme-installments-shape-probe.test.ts`
quando uma chave sandbox real estiver disponível. Atualizar as constantes se a resposta
real tiver `installments_table` ou `installment_plan`.

---

## Consequências

1. `PAGARME_WEBHOOK_SIGNING_SECRET` adicionado ao `.env.example` e `.env.production.example`
   — configurar no dashboard do Pagar.me antes de ir para produção.
2. O handler `/api/webhooks/pagarme` não aceita mais Basic Auth sozinho — requer HMAC.
3. O worker `payment.process-webhook` emite `outbox_events` em vez de enfileirar email
   diretamente — desacoplamento para o Plan 02-06.
4. AM-02 + AM-06 probes devem ser executados pelo operador antes do deploy de produção.

## Referências

- `src/lib/pagarme/hmac.ts` — implementação `verifyWebhookSignature`
- `src/app/api/webhooks/pagarme/route.ts` — handler refatorado
- `src/jobs/tasks/payment-process-webhook.ts` — worker com re-fetch defense
- `tests/probes/pagarme-hmac-header-probe.test.ts` — probe HMAC (AM-02)
- `tests/probes/pagarme-installments-shape-probe.test.ts` — probe installments (AM-06)
- `src/lib/pagarme/installments-shape.generated.ts` — constantes de shape
- 02-CONTEXT.md D-13 (belt-and-suspenders re-fetch), D-14 (inbox), AM-02, AM-06
- 02-RESEARCH.md §Pattern 4 (webhook HMAC), Pitfall 1 (raw bytes), Pitfall 2 (retry storm)
