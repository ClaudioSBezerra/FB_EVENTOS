# Roadmap: FB_EVENTOS

## Overview

FB_EVENTOS é entregue em cinco fases sequenciais (Phase 0 → 4) seguindo a decisão **Vertical MVP per persona** travada em PROJECT.md. Phase 0 (Foundation) blinda contra os 21 pitfalls inherited do FB_APU04 — instala stack, CI gates, RLS multi-tenant, LGPD baseline e auth — antes de qualquer linha de código de domínio. Phase 1 entrega a Organizadora end-to-end no piloto Festa de Trindade/GO (≤3 meses). Phase 2 transforma fricção em self-service de fornecedor com checkout PIX/cartão hardenado. Phase 3 adiciona prestadores + comissionamento + assinatura recorrente (4 vetores de receita). Phase 4 entrega público, ticketing offline-first, F&B, marketplace SSR, integrações Sympla/Eventbrite e LGPD compliance completa.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 0: Foundation, Stack Lock & Anti-Pitfall Hardening** - Repo, CI gates, RLS multi-tenant, auth, LGPD baseline, deploy pipeline (completed 2026-06-12)
- [ ] **Phase 1: Organizadora End-to-End (Piloto Festa de Trindade)** - Evento + planta 2D + lotes + fornecedores + contrato + cobrança manual
- [ ] **Phase 2: Fornecedor Self-Service + Checkout PIX/Cartão** - Portal fornecedor + reserva com TTL + Pagar.me hardened + webhooks idempotentes
- [ ] **Phase 3: Prestador + Comissionamento + Assinatura Recorrente** - Mão de obra + split Pagar.me + subscription da organizadora + 4 fontes de receita
- [ ] **Phase 4: Público — Ticketing, F&B, Marketplace, Integrações** - PWA offline check-in + marketplace SSR + Sympla/Eventbrite + LGPD complete + ops hardening

## Phase Details

### Phase 0: Foundation, Stack Lock & Anti-Pitfall Hardening
**Goal**: Repo bootstrapped com stack travada (Next.js 15 + Drizzle + Postgres 16 + Better Auth + RLS), CI gates anti-pitfall ativos, deploy Coolify funcional, auth + multi-tenant + LGPD baseline operacionais — base contratualmente segura para todo desenvolvimento de domínio
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, FOUND-08, FOUND-09, FOUND-10, FOUND-11, FOUND-12, FOUND-13, FOUND-14, FOUND-15, FOUND-16, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, TENA-01, TENA-02, TENA-03, TENA-04, TENA-05, TENA-06, TENA-07, TENA-08, LGPD-01, LGPD-02, LGPD-03, LGPD-04, LGPD-05, LGPD-06
**Success Criteria** (what must be TRUE):
  1. CI pipeline em PR bloqueia qualquer commit que adicione `sqlite3`/`@libsql`/`better-sqlite3` em `package.json` ou arquivos `*.db`/`*.sqlite`/`tracker-*.db` (constraint contratual de embedded-DB ban verificável)
  2. Deploy via Coolify + Traefik publica build com semver tag (não `:latest`) sob TLS Let's Encrypt; healthcheck retorna 200 e logs JSON Pino chegam estruturados no destino configurado
  3. Integration test com dois tenants (`tenant_A`, `tenant_B`) prova que usuário autenticado de A nunca vê dados de B em nenhum endpoint — RLS está `FORCED`, role `fb_eventos_app` não tem `BYPASSRLS`, middleware `SET LOCAL app.current_tenant_id` é obrigatório
  4. Usuário pode criar conta com email+senha (Better Auth), verificar email, fazer login que persiste entre refreshes, e resetar senha via link — fluxo end-to-end testado
  5. ADR registrada decidindo Graphile-Worker vs pg-boss; versões de Next 15.x, Drizzle 0.45.x, Better Auth 1.6.x, Node 22 LTS travadas em `package.json` lock; extensões Postgres `pgcrypto` e `pg_trgm` confirmadas disponíveis no Coolify
**Plans**: 7 plans
- [x] 00-01-PLAN.md — Repo bootstrap & tooling floor (pnpm + Next.js 15.5.19 + TypeScript + Biome + Husky + gitleaks binary + .env manifests + multi-stage Dockerfile)
- [x] 00-02-PLAN.md — CI anti-pitfall gates (GitHub Actions: embedded-DB grep, gitleaks-action@v2, drizzle-push ban, legacy fb_apu0x ban, Next 16 ban, tag-only build-and-push)
- [x] 00-03-PLAN.md — Postgres + Drizzle + RLS foundation (docker compose without Redis, two-role pattern, RLS FORCED, withTenant wrapper, three RLS contract tests)
- [x] 00-04-PLAN.md — Better Auth + multi-tenant middleware + auth UI (signup with LGPD consent, login, verify, reset, 2FA, /[slug]/dashboard, TENA-07 dual-tenant E2E)
- [x] 00-05-PLAN.md — LGPD baseline + audit log (audit_log append-only, consent_records versioning, PII COMMENT ON COLUMN, soft-delete helpers, consent banner, docs/LGPD.md)
- [x] 00-06-PLAN.md — Observability + Graphile-Worker job harness (Pino + Sentry + child-logger bindings; Graphile-Worker runner/enqueue; ADR-0001; add_job signature probe)
- [x] 00-07-PLAN.md — Coolify deploy + health + walking-skeleton E2E (api/health, Dockerfile.worker, Coolify manifests, Traefik labels, RUNBOOK + BACKUP, Playwright E2E)

### Phase 1: Organizadora End-to-End (Piloto Festa de Trindade)
**Goal**: Organizadora cadastra evento real (Festa de Trindade/GO), sobe planta, desenha lotes 2D clicáveis, cadastra/aprova fornecedores manualmente, emite contrato digital, cobra via link e vê dashboards de ocupação + financeiro — sem retornar para Excel/WhatsApp
**Mode:** mvp
**Depends on**: Phase 0
**Requirements**: ORG-01, ORG-02, ORG-03, ORG-04, ORG-05, ORG-06, ORG-07, ORG-08, ORG-09, ORG-10, ORG-11, ORG-12, ORG-13, ORG-14, ORG-15, ORG-16, ORG-17
**Success Criteria** (what must be TRUE):
  1. Organizadora do piloto **Festa de Trindade/GO** cadastra o evento real (nome, datas, local, capacidade, timezone, BRL), faz upload da planta em PDF/PNG/JPG (até 25 MB) para MinIO e desenha lotes como polígonos 2D clicáveis no editor Konva — auto-save funciona e geometria persiste como `jsonb` versionado (`{"version":1,"type":"polygon2d",...}`) sem ALTER TABLE futuro
  2. Organizadora define categorias de lote com preço por m² + preço fixo, cadastra fornecedores via formulário com validação CNPJ pela BrasilAPI, aprova/rejeita manualmente, atribui lote para fornecedor aprovado e armazena documentos do fornecedor em cofre MinIO com URL assinada TTL curto
  3. Sistema gera contrato digital PDF via Graphile-Worker job, envia para e-sign (ZapSign **ou** Clicksign — decisão registrada em ADR durante Phase 1) e cria cobrança Pagar.me simples (PIX/cartão, sem split ainda) para o lote atribuído
  4. Dashboard mostra mapa de ocupação da planta colorido por status (`available`/`reserved`/`sold`) com % vendido em R$ e em m²; dashboard financeiro mostra recebido, a receber e comissão da plataforma calculada
  5. Organizadora e fornecedor recebem email Resend em cada mudança de status (cadastro, aprovação, contrato emitido) — ≥1 lote real do piloto Trindade é vendido via FB_EVENTOS sem voltar a Excel/WhatsApp
**Plans**: 8 plans
- [x] 01-01-PLAN.md — Test infra Wave 0 + MinIO infra + domain schema bootstrap (12 tables FORCE RLS + PII comments + setActiveOrg hook)
- [ ] 01-02-PLAN.md — Event CRUD + planta upload (pre-signed PUT direto browser→MinIO; statObject verification)
- [ ] 01-03-PLAN.md — Konva editor + lots (polygon2d v1 jsonb) + categories (aditivo pricing) + lot assignment + ADR-0003
- [ ] 01-04-PLAN.md — Fornecedor CRUD + approval FSM + BrasilAPI CNPJ (2-layer + degrade-with-warning + 7d cache) + vendor doc cofre
- [ ] 01-05-PLAN.md — Contracts + @react-pdf templates + ZapSign sequential signers + webhook re-fetch defense + ADR-0002 + ADR-0004
- [ ] 01-06-PLAN.md — Pagar.me v5 simple charges (PIX + cartão, sem split) + webhook re-fetch defense + idempotency
- [ ] 01-07-PLAN.md — Dashboards ocupação (Konva read-only colorido) + financeiro (recebido / a receber / comissão por fornecedor)
- [ ] 01-08-PLAN.md — Resend pt-BR templates (6 events) + walking-skeleton D-14 4-step gate extension + RUNBOOK operator flip checklist (checkpoint)
**UI hint**: yes

### Phase 2: Fornecedor Self-Service + Checkout PIX/Cartão
**Goal**: Fornecedor descobre evento aberto, escolhe lote na planta interativa, reserva com TTL 15min sem race condition, paga PIX/cartão via Pagar.me e recebe contrato + recibo — fluxo end-to-end sem intervenção da organizadora; webhooks Pagar.me idempotentes em produção
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: FORN-01, FORN-02, FORN-03, FORN-04, FORN-05, FORN-06, FORN-07, FORN-08, FORN-09, FORN-10, FORN-11, FORN-12, FORN-13, FORN-14, FORN-15, FORN-16, FORN-17, FORN-18
**Success Criteria** (what must be TRUE):
  1. Fornecedor cadastra-se self-service (Better Auth) com CNPJ + comprovantes, descobre eventos abertos do tenant, navega a planta 2D como comprador (lotes vendidos visualmente bloqueados) e recebe push SSE+`LISTEN/NOTIFY` em tempo real quando outro fornecedor reserva ou paga um lote
  2. Dois fornecedores clicando o mesmo lote simultaneamente: apenas um obtém reserva (TTL 15min em `lot_reservations`); o outro recebe 409 imediato — verificado por load test concorrente, pois `pg_try_advisory_xact_lock(hashtext('lot:'||event_id||':'||lot_id))` está ativo na transação de reserva
  3. Checkout Pagar.me v5 aceita PIX (QR + copia-e-cola) e cartão; webhook handler verifica HMAC, grava em `payment_webhooks_inbox` com PK no `gateway_event_id` + `ON CONFLICT DO NOTHING`, retorna 200 rápido e enfileira processamento via Graphile-Worker — entrega duplicada do gateway é no-op verificada por teste
  4. Outbox pattern grava `payment.paid` business event + jobs (email confirmação, geração de PDF de contrato, marcação do lote como `sold`) na mesma transação; SAGA de cancelamento libera reserva quando pagamento falha; Graphile-Worker scheduled job expira reservas a cada 1 minuto; lista de espera notifica candidatos quando lote vendido é liberado
  5. Portal do fornecedor mostra histórico de compras, contratos baixáveis, segunda via de boleto, upload de docs adicionais, refund/estorno (PIX one-shot vs cartão authorize+capture) e consent granular LGPD (marketing/analytics/dados de pagamento) por fornecedor
**Plans**: TBD
**UI hint**: yes

### Phase 3: Prestador + Comissionamento + Assinatura Recorrente
**Goal**: Plataforma fatura via 4 vetores de receita (% espaços, % mão de obra, % ingressos/bebidas placeholder, assinatura) — prestadores cadastram-se, são atribuídos a demandas, recebem split automático via Pagar.me Recipients e PIX; organizadora paga assinatura mensal recorrente; engine de subscription e engine de commission são separadas explicitamente
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: PREST-01, PREST-02, PREST-03, PREST-04, PREST-05, BILL-01, BILL-02, BILL-03, BILL-04, BILL-05
**Success Criteria** (what must be TRUE):
  1. Prestador cadastra-se self-service (PF/MEI/PJ) com chave PIX para repasse, candidata-se a demandas do catálogo (segurança, limpeza, montagem, garçom) e organizadora aprova/rejeita — atribuição registrada com auditoria
  2. Quando pagamento de evento entra para Pagar.me, split automático via Recipients distribui valor entre organizadora, plataforma e prestador conforme `commission_rules`; repasse PIX para prestador gera comprovante PDF via Graphile-Worker job — verificado em transação real de teste com 3 recipients
  3. Organizadora é cobrada mensalmente via Pagar.me Subscription (assinatura recorrente); dunning policy executa backoff exponencial em falhas com notificação por email — engine de Subscription **separada** da engine de `commission_invoices` (duas tabelas, dois fluxos, documentado em `docs/billing/model.md`)
  4. Dashboard consolidado mostra as 4 fontes de receita (% espaços + % mão de obra + % ingressos/bebidas + assinatura) com totais por evento, por prestador e por categoria de receita; relatórios exportáveis por prestador e por evento
  5. Engine de comissão e engine de subscription são distinguíveis no schema e nas APIs — confusão entre os dois fluxos é impossível por design (Pitfall #9 mitigado e testado)
**Plans**: TBD
**UI hint**: yes

### Phase 4: Público — Ticketing, F&B, Marketplace, Integrações
**Goal**: Plataforma atende público final em escala de piloto (90k-900k) com ticketing PWA offline-first, F&B online + POS, marketplace SSR white-label com SEO, integrações Sympla/Eventbrite one-way, LGPD direito ao esquecimento completo e infra hardenada (read replica + PgBouncer + load test 50k req/min + status page + read-only kill switch)
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: TIC-01, TIC-02, TIC-03, TIC-04, TIC-05, TIC-06, FNB-01, FNB-02, FNB-03, MKT-01, MKT-02, MKT-03, MKT-04, MKT-05, MKT-06, INT-01, INT-02, INT-03, INT-04, LGPD-07, LGPD-08, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06
**Success Criteria** (what must be TRUE):
  1. Público compra ingresso público no marketplace SSR (Lighthouse mobile ≥85, LCP <2.5s gate no CI) com categorias + lotes 1º/2º/3º + meia-entrada BR + cupons + compra em grupo via Pagar.me PIX/cartão e recebe QR Code assinado anti-falsificação
  2. PWA instalável (Android/iOS sem app store) faz check-in offline-first em modo avião: IndexedDB local + sync queue + conflict resolution first-scan-wins — testado em modo avião em estádio simulado e sincroniza ao reconectar sem perda de scans
  3. Marketplace público SSR oferece white-label (logo, cores, domínio) por organizadora via subdomain wildcard `{tenant}.fbeventos.com` (ACME DNS-01) + custom domain tier premium (ACME on-demand) + widget embedável para sites de fornecedor; cardápio F&B + POS PWA offline + estoque básico por SKU operam no evento
  4. Integração Sympla v2 + Eventbrite v3 one-way (FB_EVENTOS authoritative): pre-allocation publica ingressos, webhook handlers sincronizam vendas vindas dos parceiros, reconciliação automática diária gera relatório de divergências — sem scraping HTML
  5. Workflow LGPD completo: form público de direito ao esquecimento + workflow interno + hard-delete via Graphile-Worker job (LGPD-07) + DPA padrão para fornecedores B2B (LGPD-08); read replica do Postgres serve marketplace + relatórios; PgBouncer transaction-pooling dimensionado para spike; load test k6 valida 50k req/min concorrentes no checkout antes do go-live; cache stampede single-flight ativo; toggle read-only-mode (kill switch) testado em runbook; status page em infra separada (não no mesmo deploy)
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 0 → 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Foundation, Stack Lock & Anti-Pitfall Hardening | 7/7 | Complete   | 2026-06-12 |
| 1. Organizadora End-to-End (Piloto Festa de Trindade) | 1/8 | In Progress|  |
| 2. Fornecedor Self-Service + Checkout PIX/Cartão | 0/TBD | Not started | - |
| 3. Prestador + Comissionamento + Assinatura Recorrente | 0/TBD | Not started | - |
| 4. Público — Ticketing, F&B, Marketplace, Integrações | 0/TBD | Not started | - |

---
*Roadmap created: 2026-06-11*
*Coverage: 107/107 v1 requirements mapped (all REQ-IDs in REQUIREMENTS.md assigned to exactly one phase)*
