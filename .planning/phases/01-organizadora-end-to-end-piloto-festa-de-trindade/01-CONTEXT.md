# Phase 1: Organizadora End-to-End (Piloto Festa de Trindade) - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Habilitar a **Organizadora** a operar um evento real ponta-a-ponta no FB_EVENTOS — do cadastro do evento à venda de espaços — **sem self-service de fornecedor** (isso é Phase 2). Nesta fase a organizadora aprova fornecedores manualmente, atribui lotes manualmente, gera cobranças/contratos manualmente. O alvo é a Festa de Trindade/GO.

**O que está IN-SCOPE:**
- Cadastro de evento (nome, datas, local, capacidade, timezone, BRL)
- Upload da planta (PDF/PNG/JPG até 25 MB) + editor 2D Konva de lotes (polígonos, mover/redimensionar/excluir, auto-save)
- Categorias de lote com modelo de preço aditivo (`base_fixo + m² × rate`)
- CRUD de fornecedores com validação CNPJ (BrasilAPI), aprovação manual, cofre de docs (MinIO)
- Atribuição manual de lote para fornecedor aprovado
- Geração de contrato PDF (Graphile-Worker job) + envio para ZapSign (assinatura sequencial: organizadora → fornecedor)
- Cobrança Pagar.me simples (PIX/cartão, **sem split** — split fica Phase 2-3)
- Dashboard de ocupação (mapa Konva read-only colorido + cards) + dashboard financeiro (recebido, a receber, comissão)
- Notificações Resend para organizadora + fornecedor em mudanças de status

**O que está OUT-OF-SCOPE (Phase 2+):**
- Fornecedor self-service / cadastro próprio
- Reserva com TTL + advisory locks (Phase 2)
- Webhooks Pagar.me com outbox idempotente (Phase 2)
- Split de pagamento (Phase 2-3)
- Marketplace público / SSR (Phase 4)
- Prestadores + comissionamento + assinatura recorrente (Phase 3)

</domain>

<decisions>
## Implementation Decisions

### E-sign Provider
- **D-01:** **ZapSign** é o provider de e-sign. Researcher escreve ADR-0002 antes de plan-phase ratificando a escolha contra Clicksign (custo, REST API, webhook reliability, sandbox UX).
- **D-02:** Ordem de assinatura **sequencial**: organizadora primeiro, fornecedor depois. Status do contrato: `draft → awaiting_org → awaiting_fornecedor → signed`. Evita enviar contrato errado para terceiro.
- **D-03:** ZapSign **sandbox** durante dev/staging até gate técnico (ver D-13). Credenciais via env vars `ZAPSIGN_TOKEN` + `ZAPSIGN_ENV` (sandbox/production).

### Object Storage (MinIO)
- **D-04:** **MinIO self-host** em Coolify (reusa pattern FB_APU04), **bucket-per-tenant** para isolamento físico + Lifecycle policies LGPD por tenant.
- **D-05:** Upload de planta (25 MB) + docs do fornecedor: **pre-signed PUT direto browser → MinIO**. Server Action gera URL pre-signed com `content-type lock + size limit + TTL 5min`. Server não aguenta os bytes. Researcher avalia pegadinhas de CORS + Coolify networking.
- **D-06:** Pre-signed GET para download (cofre de docs, ORG-15) com TTL curto (planner default = 15 min; revisitar se necessário).

### Geração de PDF (Contrato)
- **D-07:** **@react-pdf/renderer** para geração do contrato. Stack TS puro, sem Chrome no Dockerfile.worker. Layout suficiente para contrato simples de piloto.
- **D-08:** **Template hardcoded em TS file** por categoria de contrato: `src/contracts/templates/fornecedor-stand-v1.tsx`. Mudança = novo arquivo `-v2.tsx` ou migration ALTER. Cada contrato gerado salva `template_version` no DB para reproduzir auditoria. Commits Git = audit trail.

### Modelo de Preço de Lote
- **D-09:** **Aditivo:** `preço_lote = categoria.base_fixed + lote.area_m² × categoria.per_sqm_rate`. Categoria carrega `base_fixed numeric NOT NULL DEFAULT 0` e `per_sqm_rate numeric NOT NULL DEFAULT 0` (qualquer um pode ser 0 — categoria só fixa OU só por m² ainda funciona). Lote calcula seu preço final pela combinação.

### Geometria de Lotes + Auto-save
- **D-10:** Geometria persiste como `jsonb` versionado: `{"version":1, "type":"polygon2d", "points":[[x,y],...], "z_index":N}`. **Sem ALTER TABLE futuro** quando upgrade 3D — `version:2, type:"extrude3d"` coexiste com v1. Researcher confirma campos exatos que Konva precisa.
- **D-11:** **Auto-save por lote, debounce 1s.** Cada move/resize/create/delete dispara Server Action que faz `UPDATE lots SET geometry=? WHERE id=?` dentro de `withTenant`. Sem snapshot da planta inteira — conflict-free entre lotes diferentes.

### Dashboard
- **D-12:** Dashboard de ocupação = **mapa Konva read-only colorido + cards lado-a-lado**. Componente Konva do editor é reusado com prop `mode='dashboard'` que pinta lotes por status (`available` verde, `reserved` amarelo, `sold` vermelho). Cards mostram % vendido em R$ + % vendido em m². Padrão clássico de SaaS de ticketing.

### Piloto Trindade + Gate Sandbox → Produção
- **D-13:** **Você (Claudio) opera como organizadora durante dev/staging.** Seed `tenant_trindade` em dev. Modo sandbox em Pagar.me + ZapSign até gate técnico passar.
- **D-14:** **Gate sandbox → produção é técnico, não temporal.** Flip `PAGARME_ENV=production` + `ZAPSIGN_ENV=production` somente após smoke E2E completo:
  1. Signup da organizadora real do piloto
  2. Upload de planta real + desenho de pelo menos 1 lote
  3. 1 cobrança sandbox PIX paga end-to-end
  4. 1 contrato sandbox enviado + assinado (sequencial) end-to-end
  
  Quando os 4 passam verde, flip vai para produção. Smoke deve estar automatizado (extensão do walking-skeleton de Phase 0).

### Emails (Resend)
- **D-15:** Templates **pt-BR, texto curto + link** (1-2 linhas + CTA), você escreve os strings. 5 eventos:
  1. `signup_fornecedor` → organizadora + fornecedor
  2. `aprovacao_fornecedor` → fornecedor
  3. `rejeicao_fornecedor` → fornecedor (com motivo)
  4. `contrato_emitido` → fornecedor (link ZapSign)
  5. `contrato_assinado` → organizadora + fornecedor (PDF assinado)
  
  Templates ficam em código (`src/lib/email/templates/*.ts`). React Email rich templates ficam para Phase 4 polish.

### Validação CNPJ (BrasilAPI)
- **D-16:** Validação em **2 camadas**: (a) regex client-side (formato + DV) no submit do form para feedback rápido; (b) lookup BrasilAPI server-side via Server Action que **confirma situação cadastral ativa**. Se BrasilAPI fora do ar, planner decide entre `degrade-with-warning` (aceita cadastro com flag `cnpj_verified=false`) ou `block` — researcher avalia SLA típico da BrasilAPI antes.

### Claude's Discretion
- Estrutura interna de tabelas (`events`, `lots`, `lot_categories`, `vendors`, `vendor_documents`, `contracts`, `payments`, etc.) — researcher + planner definem com base nos requisitos
- Schema das business event tables (será refatorado em Phase 2 para outbox pattern, então fica simples agora)
- Estratégia de teste fixtures vs factories
- Layout exato dos formulários e dashboards (UI-phase pode ser executado para gerar UI-SPEC.md antes do plan-phase se você quiser)
- Padrão de file naming dentro de `src/app/[slug]/eventos/`, `src/app/[slug]/fornecedores/`, etc.

### Folded Todos
Nenhum todo pendente foi dobrado nesta discussão.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Stack + Fundação (Phase 0)
- `.planning/PROJECT.md` — Core value, requirements, evolution rules, hard contractual constraints
- `.planning/REQUIREMENTS.md` §ORG-01–17 — Os 17 requirements específicos desta fase
- `CLAUDE.md` — Stack travada, "What NOT to Use", Phase Patterns
- `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-RESEARCH.md` — Patterns 1-10, Pitfalls inherited from FB_APU04
- `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-04-SUMMARY.md` — Better Auth patterns, TENA-05 split, recordConsentMetadata
- `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-05-SUMMARY.md` — LGPD baseline (audit_log, PII comments, consent_records, soft-delete)
- `.planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-06-SUMMARY.md` — Graphile-Worker enqueue pattern, RLS-no-worker contract, ADR-0001

### Código de Fundação Reusado
- `src/db/with-tenant.ts` — A boundary RLS; toda Server Action + Server Component que toca dado tenant-scoped passa por aqui
- `src/db/schema/auth.ts` — Better Auth + organization plugin tables
- `src/db/schema/consent.ts` — `consent_records` (Phase 0 stub estendido por Phase 0 LGPD plan)
- `src/db/schema/audit.ts` — `audit_log` append-only (toda mudança de status de fornecedor/lote/contrato gera audit row)
- `src/lib/actions/safe-action.ts` — `actionClient → authedAction → withTenantAction` chain
- `src/lib/audit.ts` — `recordAudit()` helper
- `src/lib/email.ts` — Resend/nodemailer transport wrapper (Phase 0 wired this)
- `src/jobs/enqueue.ts` + `src/jobs/runner.ts` — Graphile-Worker enqueue + worker harness (gerar contratos PDF + enviar emails Resend = jobs)
- `src/middleware.ts` — Tenant slug resolution + `x-request-id`

### ADRs (a criar nesta fase)
- `docs/adr/0002-e-sign-provider.md` — **ZapSign vs Clicksign** (pesquisa decide; default ZapSign)
- `docs/adr/0003-pricing-model.md` — Modelo aditivo de preço de lote (formaliza D-09)
- `docs/adr/0004-pdf-generator.md` — @react-pdf/renderer (formaliza D-07)

### LGPD (continuidade Phase 0)
- `docs/LGPD.md` — Retention table (atualizar com classes: planta_evento, fornecedor_doc, contrato_pdf, cobranca_pagarme)
- `src/lib/soft-delete.ts` — Helper para soft-delete tenant-scoped

### Externos (researcher confirma versões + endpoints + sandbox URLs)
- ZapSign REST API + webhook docs (sandbox + production)
- Pagar.me v5 docs — Orders + Charges (PIX + Cartão simples, **sem** split nesta fase)
- BrasilAPI `/cnpj/v1/:cnpj` — SLA, rate limits, response shape
- MinIO Server Admin API — bucket-per-tenant setup + Lifecycle policies por bucket
- @react-pdf/renderer — limitações de layout para contrato
- Konva.js — `Konva.Line` closed + `Konva.Transformer` + dashboard read-only mode

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`withTenant(tenantId, fn)`** — toda query tenant-scoped passa por aqui. Lotes, fornecedores, contratos, cobranças = todos `tenant_id NOT NULL` com FORCE RLS desde a primeira migration desta fase.
- **`recordAudit()`** — registra mudanças de status (fornecedor aprovado/rejeitado, lote atribuído, contrato emitido/assinado, cobrança criada/paga). LGPD-04 cobre via baseline de Phase 0.
- **`safe-action.ts` chain** — `withTenantAction()` é o wrapper canonical para Server Actions tenant-scoped com Zod input/output.
- **`enqueueJob()`** — pattern para Graphile-Worker. Gera contrato PDF + envio Resend + envio ZapSign devem ser tasks separadas registradas em `src/jobs/tasks/index.ts` (cada uma extrai `tenantId` do payload e wrappa em `withTenant`).
- **`sendEmail()`** wrapper (`src/lib/email.ts`) — Resend (prod) / nodemailer-mailpit (dev) / in-memory (test). Plugar templates novos é trivial.
- **Componentes shadcn já instalados:** button, input, label, form, card, checkbox. Plan precisará adicionar: select, dialog, table, badge, dropdown-menu, popover, calendar, date-picker.

### Established Patterns (do Phase 0)
- **TENA-05 split** — middleware Edge sem DB; `SET LOCAL app.current_tenant_id` só dentro de `withTenant()`. Server Components que tocam dado tenant-scoped SEM passar por `withTenant` retornam 0 rows por RLS default-deny. Aplicar consistentemente em todas as páginas `/[slug]/...`.
- **PII inventory** — toda coluna sensível nova (`vendors.email`, `vendors.phone`, `vendors.cnpj`, `vendors.legal_representative_name`, etc.) deve carregar `COMMENT ON COLUMN ... IS 'PII:...'`.
- **Append-only audit** — `audit_log` está com `REVOKE UPDATE, DELETE` no GRANT layer. Toda mudança de status = `INSERT INTO audit_log`.
- **RLS-no-worker** — task handlers wrappam corpo em `withTenant(payload.tenantId, fn)`. Tarefas de geração de PDF + ZapSign + email DEVEM seguir esse padrão.
- **`add_job` signature contract** — `enqueueJob()` usa named-arg form. Probe test de Phase 0 trava drift. Não desviar.

### Integration Points
- **Nova migration 0010+:** `events`, `lot_categories`, `lots`, `vendors`, `vendor_documents`, `vendor_applications`, `lot_assignments`, `contracts`, `contract_templates_versions`, `payments`, `pagarme_orders`, `zapsign_documents`. Todas com `tenant_id NOT NULL` + FORCE RLS.
- **MinIO:** novo container no `docker/compose.yml` + manifest Coolify novo (`docker/coolify/minio.service.md`). Bucket bootstrap script (`scripts/minio/setup-buckets.sh`) cria buckets por tenant + Lifecycle.
- **`/[slug]/eventos`, `/[slug]/eventos/[id]/planta`, `/[slug]/eventos/[id]/lotes`, `/[slug]/fornecedores`, `/[slug]/contratos`, `/[slug]/cobrancas`, `/[slug]/dashboard`** — nova hierarquia de rotas tenant-scoped.
- **Graphile-Worker tasks** novas: `pdf.generate-contract`, `zapsign.send-contract`, `zapsign.webhook-process`, `pagarme.create-order`, `pagarme.webhook-process` (simples, sem outbox nesta fase), `email.send-status-update`.
- **Webhooks:** `/api/webhooks/zapsign` + `/api/webhooks/pagarme` — Route Handlers no App Router. Phase 1 grava em tabela inbox simples + processa inline; Phase 2 refatora para outbox idempotente.

</code_context>

<specifics>
## Specific Ideas

- Festa de Trindade/GO é o piloto **real** — não é evento sintético. Quando o gate técnico (D-14) passa, é a organizadora real do evento que toma o seat.
- Walking-skeleton E2E de Phase 0 (`tests/e2e/walking-skeleton.spec.ts`) deve ser **estendido** nesta fase para cobrir o smoke gate (D-14, 4 passos).
- Templates Resend: tom **direto, pt-BR formal mas humano** (ex: "Você foi aprovado como fornecedor no FB_EVENTOS. Acesse seu painel em <link>.").
- Editor Konva: prioridade **velocidade de desenho** acima de polish — organizadora vai desenhar 100+ lotes em poucas sessões. Atalhos de teclado + cópia de lote (cmd+D) são nice-to-have mas não obrigatório no MVP.
- Modelo de cobrança Pagar.me **simples = order com 1 charge**. Sem subscriptions, sem split. Manter superfície mínima para reduzir surface area de Phase 2 quando outbox + idempotency + webhooks-com-HMAC chegam.

</specifics>

<deferred>
## Deferred Ideas

### Para Phase 2
- Cópia de lotes (cmd+D no editor) — polish do editor Konva
- React Email rich HTML templates — polish dos emails (Phase 2 ou 4)
- Real-time SSE+LISTEN/NOTIFY no dashboard de ocupação (Phase 2 já faz isso para reservas; pode estender para ocupação)
- Templates de contrato editáveis pela organizadora (jsonb no DB ou MinIO assets) — fica para Phase 3 quando faz sentido com multi-cliente
- Webhooks Pagar.me com outbox idempotente — **explicitamente Phase 2** (ROADMAP)
- Reserva de lote com TTL + advisory locks — **explicitamente Phase 2**

### Para Phase 3
- Split de pagamento via Pagar.me Recipients
- Subscription da organizadora (assinatura recorrente)
- Comissionamento de prestadores

### Para Phase 4
- Marketplace público / SSR / white-label
- PWA + check-in offline-first
- LGPD direito ao esquecimento via UI
- Read replica + PgBouncer + cache stampede single-flight

### Reviewed Todos (not folded)
Nenhum todo pendente revisitado nesta discussão.

</deferred>

---

*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Context gathered: 2026-06-12*
