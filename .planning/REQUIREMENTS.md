# Requirements: FB_EVENTOS

**Defined:** 2026-06-11
**Core Value:** Habilitar a organizadora a vender espaços de eventos a fornecedores de forma self-service, com planta visual e pagamento integrado — sem precisar de WhatsApp/Excel/contratos em papel.

## v1 Requirements

Requisitos da release inicial. Cada um mapeado para uma fase no roadmap. Organização: **Phase 0** (Foundation) precede as 4 fases de personas verticais (Phase 1-4). REQ-IDs seguem padrão `[CATEGORIA]-NN`.

### Foundation (Infra & Anti-Pitfall Hardening)

- [ ] **FOUND-01**: Repo bootstrapped com Next.js 15 + TypeScript 5.6 + Drizzle ORM + PostgreSQL 16
- [ ] **FOUND-02**: CI gate bloqueia presença de `sqlite3`/`@libsql`/`better-sqlite3` em `package.json` (anti-pitfall #1)
- [ ] **FOUND-03**: CI gate bloqueia commit de arquivos `*.db`, `*.sqlite`, `tracker-*.db` (anti-pitfall #1)
- [ ] **FOUND-04**: Pre-commit hook com `gitleaks` para evitar commit de secrets
- [ ] **FOUND-05**: Pre-commit hook com `biome` (lint) e `tsc --noEmit` (type-check)
- [ ] **FOUND-06**: Dois arquivos `.env.example` (dev + prod) com mesmas chaves e placeholders explícitos
- [ ] **FOUND-07**: Pipeline GitHub Actions: lint + typecheck + test + build em PR
- [ ] **FOUND-08**: Deploy automatizado via Coolify + Traefik (TLS Let's Encrypt + roteamento por host)
- [ ] **FOUND-09**: Imagem Docker multi-stage com semver tag (não `:latest` em produção)
- [ ] **FOUND-10**: Logging estruturado JSON (Pino) desde a primeira request
- [ ] **FOUND-11**: Error tracking Sentry configurado (frontend + backend)
- [ ] **FOUND-12**: Backup PITR do PostgreSQL configurado (>=7 dias retention)
- [ ] **FOUND-13**: Runbook mínimo escrito (`docs/RUNBOOK.md`) com procedimentos de incidente
- [ ] **FOUND-14**: Decisão registrada em ADR: Graphile-Worker vs pg-boss (fila Postgres-backed)
- [ ] **FOUND-15**: Versões alvo verificadas live no npm e travadas em `package.json` (Next 15.x, Drizzle 0.45.x, Better Auth 1.6.x, Node 22 LTS)
- [ ] **FOUND-16**: Postgres extensions necessárias (`pgcrypto`, `pg_trgm`) confirmadas disponíveis no Coolify

### Identity & Multi-Tenancy (Cross-cutting — base para todas as fases)

- [ ] **AUTH-01**: Organizadora pode criar conta com email + senha (Better Auth)
- [ ] **AUTH-02**: Verificação de email por link após cadastro
- [ ] **AUTH-03**: Reset de senha por email
- [ ] **AUTH-04**: Sessão persiste entre refreshes do browser (Better Auth session em Postgres)
- [ ] **AUTH-05**: 2FA opcional (TOTP) para conta da organizadora
- [ ] **TENA-01**: Toda tabela de domínio tem coluna `tenant_id` (FK para `tenants`)
- [ ] **TENA-02**: PostgreSQL Row-Level Security habilitado e **FORCED** em toda tabela tenant-owned (anti-pitfall #2)
- [ ] **TENA-03**: User da app conecta no Postgres SEM `BYPASSRLS` (role dedicado `fb_eventos_app`)
- [ ] **TENA-04**: User de migrations conecta com role separado `fb_eventos_migrator` com permissões DDL
- [ ] **TENA-05**: Middleware de request faz `SET LOCAL app.current_tenant_id = ?` baseado no session do Better Auth
- [ ] **TENA-06**: Tenant resolution por path (`app.fbeventos.com/{tenant-slug}`) via Next.js `middleware.ts`
- [ ] **TENA-07**: Integration test com 2 tenants garante isolamento (tenant A não vê dados do tenant B)
- [ ] **TENA-08**: RBAC mínimo: roles `owner` / `admin` / `viewer` por organização (Better Auth org plugin)

### Compliance Baseline (LGPD)

- [ ] **LGPD-01**: Tabela `consent_records` com versionamento (consent_version + texto + timestamp + user_id)
- [ ] **LGPD-02**: Banner de consent para cookies (essenciais sempre; analytics/marketing opt-in)
- [ ] **LGPD-03**: Tags PII nas colunas que armazenam dados pessoais (`comment` SQL) para inventário
- [ ] **LGPD-04**: Audit log Postgres com user_id, tenant_id, action, entity, timestamp para todas as operações sensíveis
- [ ] **LGPD-05**: Soft-delete em entidades com PII (campo `deleted_at`); hard-delete via job assíncrono
- [ ] **LGPD-06**: Política de retenção documentada em `docs/LGPD.md` (placeholder até consulta jurídica)

### Phase 1 — Persona Organizadora (Cliente piloto: Festa de Trindade/GO)

- [ ] **ORG-01**: Organizadora cadastra evento com nome, datas (início/fim), local, capacidade, timezone, moeda (BRL)
- [ ] **ORG-02**: Organizadora faz upload da planta do evento (PDF/PNG/JPG até 25 MB) para MinIO/S3 com pre-signed URL
- [ ] **ORG-03**: Editor 2D Konva renderiza a planta como background e permite desenhar polígonos clicáveis (lotes)
- [ ] **ORG-04**: Cada lote tem: código, área em m², categoria, preço base, status (`available`/`reserved`/`sold`), metadata `jsonb` versionada (`{"version":1, "type":"polygon2d", ...}` para suportar futuro upgrade para 3D sem ALTER TABLE)
- [ ] **ORG-05**: Editor permite mover/redimensionar/excluir lotes (Konva Transformer); auto-save por debounce em Postgres
- [ ] **ORG-06**: Organizadora define categorias de lote (ex: "Stand 4m²", "Restaurante 50m²") com preço por m² e preço fixo
- [ ] **ORG-07**: Lista, busca e detalhe de fornecedores cadastrados (com filtro por status: pendente/aprovado/rejeitado)
- [ ] **ORG-08**: Aprovação/rejeição manual de fornecedor pela organizadora (workflow de status)
- [ ] **ORG-09**: Atribuição manual de lote para fornecedor aprovado (Phase 1: organizadora aloca; Phase 2: fornecedor escolhe)
- [ ] **ORG-10**: Geração de contrato digital (PDF) por evento+fornecedor+lote via Graphile-Worker job
- [ ] **ORG-11**: Integração com provider de e-sign (ZapSign OU Clicksign — decisão em Phase 1) para envio de contrato
- [ ] **ORG-12**: Geração de cobrança Pagar.me (cobrança simples PIX/cartão; SEM split ainda — split fica para Phase 2-3)
- [ ] **ORG-13**: Dashboard de ocupação da planta (% lotes vendidos, em valor R$ e em m²)
- [ ] **ORG-14**: Dashboard financeiro mínimo (recebido, a receber, comissão da plataforma já calculada)
- [ ] **ORG-15**: Cofre de documentos por fornecedor (MinIO + URL assinada com TTL curto)
- [ ] **ORG-16**: Validação de CNPJ via BrasilAPI no cadastro de fornecedor
- [ ] **ORG-17**: Notificação por email (Resend) para organizadora e fornecedor em mudanças de status (cadastro, aprovação, contrato emitido)

### Phase 2 — Persona Fornecedor (Self-service + Checkout PIX/Cartão)

- [ ] **FORN-01**: Fornecedor cadastra-se self-service (Better Auth) com CNPJ + dados de contato + comprovantes
- [ ] **FORN-02**: Fornecedor descobre eventos abertos para venda dentro do tenant (página marketplace interna)
- [ ] **FORN-03**: Fornecedor navega na planta 2D do evento em modo comprador (lotes vendidos visualmente bloqueados)
- [ ] **FORN-04**: Reserva de lote com TTL 15 minutos (linha em `lot_reservations` com `expires_at`)
- [ ] **FORN-05**: Advisory lock `pg_try_advisory_xact_lock(hashtext('lot:'||event_id||':'||lot_id))` previne race condition (anti-pitfall #3)
- [ ] **FORN-06**: Graphile-Worker scheduled job libera reservas expiradas a cada 1 minuto
- [ ] **FORN-07**: SSE + `LISTEN/NOTIFY` push de mudança de status do lote para outros clientes vendo a mesma planta em tempo real
- [ ] **FORN-08**: Carrinho com lote principal + add-ons (energia, água, lixo, mesas) — escopo a ser confirmado com piloto
- [ ] **FORN-09**: Checkout Pagar.me v5 com PIX (QR Code + copia-e-cola) e cartão de crédito
- [ ] **FORN-10**: Webhook handler Pagar.me com inbox table `payment_webhooks_inbox` (PK no `gateway_event_id` + `ON CONFLICT DO NOTHING`) — idempotência absoluta (anti-pitfall #4)
- [ ] **FORN-11**: HMAC signature do webhook Pagar.me verificada em toda request
- [ ] **FORN-12**: Webhook handler retorna 200 rápido e enfileira processamento via Graphile-Worker (não processa inline)
- [ ] **FORN-13**: Outbox pattern: gravação de business event + enfileiramento de side-effects (email confirmação, PDF contrato, marcação do lote como `sold`) na MESMA transação
- [ ] **FORN-14**: SAGA de cancelamento: falha de pagamento libera a reserva automaticamente
- [ ] **FORN-15**: Lista de espera por lote (waitlist) quando lote está vendido — notificação via email/WhatsApp se liberar
- [ ] **FORN-16**: Refund/estorno via Pagar.me (PIX é one-shot — modelado como estorno PIX; cartão é authorize+capture com cancel)
- [ ] **FORN-17**: Portal do fornecedor: histórico de compras, contratos baixáveis, segunda via de boleto, upload de docs adicionais
- [ ] **FORN-18**: Consent granular do fornecedor (compliance LGPD): marketing, analytics, dados de pagamento

### Phase 3 — Persona Prestador + Comissionamento

- [ ] **PREST-01**: Prestador cadastra-se self-service (PF/MEI/PJ) com chave PIX para repasse
- [ ] **PREST-02**: Catálogo de demandas de serviço por evento (segurança, limpeza, montagem, garçom, etc.)
- [ ] **PREST-03**: Prestador candidata-se a demanda; organizadora aprova/rejeita
- [ ] **PREST-04**: Split automático no pagamento via Pagar.me Recipients (organizadora → plataforma → prestador)
- [ ] **PREST-05**: Repasse via PIX para prestador com comprovante PDF (Graphile-Worker job)
- [ ] **BILL-01**: Pagar.me Subscription para assinatura mensal da organizadora (cobrança recorrente)
- [ ] **BILL-02**: Engine separada para `commission_invoices` (split-payment fees, NÃO subscription) — duas engines explícitas (anti-pitfall #9)
- [ ] **BILL-03**: Dunning policy: tentativas de cobrança falhada com backoff exponencial + notificação
- [ ] **BILL-04**: Relatórios por prestador, por evento, por categoria de receita
- [ ] **BILL-05**: Dashboard consolidado das 4 fontes de receita (% espaços + % mão de obra + % ingressos/bebidas + assinatura)

### Phase 4 — Persona Público + Marketplace + Integrações

- [ ] **TIC-01**: Ticketing público: categorias de ingresso, lotes de preço (1º/2º/3º lote), meia-entrada (lei BR)
- [ ] **TIC-02**: Cupons de desconto + compra em grupo
- [ ] **TIC-03**: Cart público + checkout Pagar.me (PIX + cartão)
- [ ] **TIC-04**: Geração de QR Code do ingresso (assinado, anti-falsificação)
- [ ] **TIC-05**: PWA de check-in offline-first: IndexedDB local + sync queue + conflict resolution (first-scan-wins) — testado em modo avião
- [ ] **TIC-06**: PWA pode ser instalada em Android/iOS sem app store
- [ ] **FNB-01**: Cardápio online de bebidas/alimentos por evento
- [ ] **FNB-02**: POS PWA para vendedores no local (modo offline-first)
- [ ] **FNB-03**: Controle de inventário básico (estoque por SKU)
- [ ] **MKT-01**: Marketplace público SSR (Next.js) com SEO (sitemap, Open Graph, structured data)
- [ ] **MKT-02**: Lighthouse mobile score >= 85 (LCP < 2.5s) — gate no CI
- [ ] **MKT-03**: White-label: organizadora customiza logo, cores, domínio
- [ ] **MKT-04**: Subdomínio wildcard via Traefik (`{tenant}.fbeventos.com`) + ACME DNS-01
- [ ] **MKT-05**: Custom domain por tenant (tier premium) com ACME on-demand
- [ ] **MKT-06**: Widget embedable (`<iframe>` ou script) para fornecedor inserir cart em site próprio
- [ ] **INT-01**: Integração com Sympla v2 API (pre-allocation one-way; FB_EVENTOS é authoritative)
- [ ] **INT-02**: Integração com Eventbrite v3 API (pre-allocation one-way)
- [ ] **INT-03**: Webhook handlers para sincronizar venda de ingressos vinda de Sympla/Eventbrite
- [ ] **INT-04**: Reconciliação automática entre sistemas (relatório diário de divergências)
- [ ] **LGPD-07**: Workflow completo de direito ao esquecimento (form público + workflow interno + hard-delete via job)
- [ ] **LGPD-08**: Data Processing Agreement padrão para fornecedores B2B
- [ ] **OPS-01**: Read replica do Postgres para marketplace público + relatórios
- [ ] **OPS-02**: PgBouncer transaction-pooling dimensionado para spike (não steady-state)
- [ ] **OPS-03**: Load test k6 — 50k requests/min concorrentes no checkout antes do go-live do piloto
- [ ] **OPS-04**: Cache stampede prevention (single-flight) para páginas do marketplace
- [ ] **OPS-05**: Read-only-mode toggle (kill switch) para uso em incidente
- [ ] **OPS-06**: Status page em infra separada (não no mesmo deploy)

## v2 Requirements

Reconhecidos, mas não no roadmap atual. Movem-se para v1 só com atualização do roadmap.

### Visualização 3D

- **3D-01**: Visualização 3D leve via Three.js usando `ExtrudeGeometry` sobre a mesma geometria 2D (data shape já versionada na Phase 1)
- **3D-02**: Walkthrough 3D (câmera primeira-pessoa) no marketplace público para imersão
- **3D-03**: Importação CAD/DWG (parsers self-hosted ou Autodesk Platform Services)

### POS Físico & Maquininhas

- **POS-01**: Integração com hardware fiscal (PDV físico no local)
- **POS-02**: Cashless wristband NFC (RFID)
- **POS-03**: Recarga de saldo via PIX em terminal

### Fiscal & Contábil

- **FISC-01**: Emissão automática de NFSe via provider (Asaas ou eNotas ou NFe.io)
- **FISC-02**: Emissão de NFe para vendas de produtos
- **FISC-03**: Export para sistemas contábeis (Conta Azul, Bling)

### Internacionalização

- **I18N-01**: Suporte a múltiplos idiomas (en, es)
- **I18N-02**: Múltiplas moedas + gateways não-BR (Stripe, PayPal)
- **I18N-03**: Suporte a regulações regionais (GDPR EU)

### Maturidade SaaS

- **SAAS-01**: Painel super-admin (cross-tenant) para suporte da plataforma
- **SAAS-02**: Sandbox por organizadora (eventos de teste isolados)
- **SAAS-03**: Marketplace de fornecedores cross-tenant (descoberta de fornecedores entre eventos)
- **SAAS-04**: API pública (REST/GraphQL) com OAuth2 para integradores externos

### Migração

- **MIG-01**: Importação assistida de dados do Eventbrite atual da cliente piloto
- **MIG-02**: Importação assistida de planilhas Excel/Google Sheets de eventos antigos

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Razão |
|---------|-------|
| Planta 3D rica (CAD/BIM-like, DWG/IFC) no v1 | 3D no v1 é o maior risco técnico para solo dev em 3 meses; 2D entrega valor suficiente para validar modelo. Movido para v2 (`3D-01..03`). |
| Banco de dados embarcado (SQLite, `.db` files, file watermarks) | **Constraint contratual.** Aprendizado direto do FB_APU04 — watermark SQLite no `bridge.py` cresceu sem limites, isolamento frágil por config-stem, sem testes. FB_EVENTOS não pode repetir. |
| WebSocket bidirecional | SSE + LISTEN/NOTIFY cobre o caso real-time do v1 (push de mudança de status). WS bidirecional só se aparecer caso de uso real. |
| Microservices / Kubernetes | Solo dev + 3 meses. Monolito modular boring é a escolha racional. Decomposição vem se/quando o time crescer. |
| ERP completo | FB_EVENTOS é vertical de eventos, não horizontal de gestão. Integração com ERP via export, não substituição. |
| CRM completo | Mesmo motivo: vertical, não horizontal. Dados de contato existem mas não há automação de marketing/funnel. |
| IA generativa (chatbot, recomendação ML) | Não é diferenciador para venda de espaços. Adiar até PMF. |
| Programa de afiliados | Vertical-MVP por persona não tem espaço para isso. |
| Customização sem-código profunda | Anti-pattern de complexidade para solo dev. Branding (logo + cores) é o limite no v1. |
| Maquininhas/POS hardware integrações no v1 | Hardware-heavy; movido para v2 (`POS-01..03`) |
| NFe/NFSe automática no v1 | Regulatório intensivo; movido para v2 (`FISC-01..03`) |
| Internacionalização no v1 | Mercado primário é Brasil; movido para v2 (`I18N-01..03`) |
| Migração automática Eventbrite no v1 | Organizadora opera em paralelo até cutover natural; movido para v2 (`MIG-01..02`) |
| Watchtower com tag `:latest` em prod | Anti-pitfall #19 (FB_APU04 inherited). Sempre semver tag + canary. |
| Endpoint destrutivo público (DELETE /api/*) sem confirmation token | Anti-pitfall #14. Endpoints destrutivos só em backoffice com confirmation token + audit log. |
| `BYPASSRLS` em user da app | Anti-pitfall #2 (multi-tenant leak). Role dedicado SEM bypass. |

## Traceability

Mapeamento de cada requisito v1 para sua fase do roadmap (cada REQ-ID aparece em exatamente uma fase).

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 0 | Pending |
| FOUND-02 | Phase 0 | Pending |
| FOUND-03 | Phase 0 | Pending |
| FOUND-04 | Phase 0 | Pending |
| FOUND-05 | Phase 0 | Pending |
| FOUND-06 | Phase 0 | Pending |
| FOUND-07 | Phase 0 | Pending |
| FOUND-08 | Phase 0 | Pending |
| FOUND-09 | Phase 0 | Pending |
| FOUND-10 | Phase 0 | Pending |
| FOUND-11 | Phase 0 | Pending |
| FOUND-12 | Phase 0 | Pending |
| FOUND-13 | Phase 0 | Pending |
| FOUND-14 | Phase 0 | Pending |
| FOUND-15 | Phase 0 | Pending |
| FOUND-16 | Phase 0 | Pending |
| AUTH-01 | Phase 0 | Pending |
| AUTH-02 | Phase 0 | Pending |
| AUTH-03 | Phase 0 | Pending |
| AUTH-04 | Phase 0 | Pending |
| AUTH-05 | Phase 0 | Pending |
| TENA-01 | Phase 0 | Pending |
| TENA-02 | Phase 0 | Pending |
| TENA-03 | Phase 0 | Pending |
| TENA-04 | Phase 0 | Pending |
| TENA-05 | Phase 0 | Pending |
| TENA-06 | Phase 0 | Pending |
| TENA-07 | Phase 0 | Pending |
| TENA-08 | Phase 0 | Pending |
| LGPD-01 | Phase 0 | Pending |
| LGPD-02 | Phase 0 | Pending |
| LGPD-03 | Phase 0 | Pending |
| LGPD-04 | Phase 0 | Pending |
| LGPD-05 | Phase 0 | Pending |
| LGPD-06 | Phase 0 | Pending |
| ORG-01 | Phase 1 | Pending |
| ORG-02 | Phase 1 | Pending |
| ORG-03 | Phase 1 | Pending |
| ORG-04 | Phase 1 | Pending |
| ORG-05 | Phase 1 | Pending |
| ORG-06 | Phase 1 | Pending |
| ORG-07 | Phase 1 | Pending |
| ORG-08 | Phase 1 | Pending |
| ORG-09 | Phase 1 | Pending |
| ORG-10 | Phase 1 | Pending |
| ORG-11 | Phase 1 | Pending |
| ORG-12 | Phase 1 | Pending |
| ORG-13 | Phase 1 | Pending |
| ORG-14 | Phase 1 | Pending |
| ORG-15 | Phase 1 | Pending |
| ORG-16 | Phase 1 | Pending |
| ORG-17 | Phase 1 | Pending |
| FORN-01 | Phase 2 | Pending |
| FORN-02 | Phase 2 | Pending |
| FORN-03 | Phase 2 | Pending |
| FORN-04 | Phase 2 | Pending |
| FORN-05 | Phase 2 | Pending |
| FORN-06 | Phase 2 | Pending |
| FORN-07 | Phase 2 | Pending |
| FORN-08 | Phase 2 | Pending |
| FORN-09 | Phase 2 | Pending |
| FORN-10 | Phase 2 | Pending |
| FORN-11 | Phase 2 | Pending |
| FORN-12 | Phase 2 | Pending |
| FORN-13 | Phase 2 | Pending |
| FORN-14 | Phase 2 | Pending |
| FORN-15 | Phase 2 | Pending |
| FORN-16 | Phase 2 | Pending |
| FORN-17 | Phase 2 | Pending |
| FORN-18 | Phase 2 | Pending |
| PREST-01 | Phase 3 | Pending |
| PREST-02 | Phase 3 | Pending |
| PREST-03 | Phase 3 | Pending |
| PREST-04 | Phase 3 | Pending |
| PREST-05 | Phase 3 | Pending |
| BILL-01 | Phase 3 | Pending |
| BILL-02 | Phase 3 | Pending |
| BILL-03 | Phase 3 | Pending |
| BILL-04 | Phase 3 | Pending |
| BILL-05 | Phase 3 | Pending |
| TIC-01 | Phase 4 | Pending |
| TIC-02 | Phase 4 | Pending |
| TIC-03 | Phase 4 | Pending |
| TIC-04 | Phase 4 | Pending |
| TIC-05 | Phase 4 | Pending |
| TIC-06 | Phase 4 | Pending |
| FNB-01 | Phase 4 | Pending |
| FNB-02 | Phase 4 | Pending |
| FNB-03 | Phase 4 | Pending |
| MKT-01 | Phase 4 | Pending |
| MKT-02 | Phase 4 | Pending |
| MKT-03 | Phase 4 | Pending |
| MKT-04 | Phase 4 | Pending |
| MKT-05 | Phase 4 | Pending |
| MKT-06 | Phase 4 | Pending |
| INT-01 | Phase 4 | Pending |
| INT-02 | Phase 4 | Pending |
| INT-03 | Phase 4 | Pending |
| INT-04 | Phase 4 | Pending |
| LGPD-07 | Phase 4 | Pending |
| LGPD-08 | Phase 4 | Pending |
| OPS-01 | Phase 4 | Pending |
| OPS-02 | Phase 4 | Pending |
| OPS-03 | Phase 4 | Pending |
| OPS-04 | Phase 4 | Pending |
| OPS-05 | Phase 4 | Pending |
| OPS-06 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: **107 total** (FOUND:16 + AUTH:5 + TENA:8 + LGPD:6 + ORG:17 + FORN:18 + PREST:5 + BILL:5 + TIC:6 + FNB:3 + MKT:6 + INT:4 + LGPD(v4):2 + OPS:6)
- Phase 0: 35 requirements (FOUND:16 + AUTH:5 + TENA:8 + LGPD:6)
- Phase 1: 17 requirements (ORG:17)
- Phase 2: 18 requirements (FORN:18)
- Phase 3: 10 requirements (PREST:5 + BILL:5)
- Phase 4: 27 requirements (TIC:6 + FNB:3 + MKT:6 + INT:4 + LGPD:2 + OPS:6)
- **Mapped: 107/107** — todos os REQ-IDs em exatamente uma fase ✓
- Unmapped: 0
- Duplicated: 0

---
*Requirements defined: 2026-06-11*
*Last updated: 2026-06-11 after roadmap creation (per-REQ-ID phase mapping)*
