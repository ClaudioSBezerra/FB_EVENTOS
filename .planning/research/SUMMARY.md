# Project Research Summary

**Project:** FB_EVENTOS — Plataforma SaaS multi-tenant para gestão de grandes eventos (vertical: festas religiosas/culturais de massa no Brasil, com nicho em venda self-service de espaços para fornecedores)
**Domain:** Multi-tenant SaaS / Event management / Marketplace BR
**Researched:** 2026-06-11
**Confidence:** HIGH (stack, multi-tenancy, queue, real-time, pitfalls); MEDIUM (gateway commercial terms, Sympla/Eventbrite API specifics, LGPD legal text)

## Executive Summary

FB_EVENTOS é um SaaS multi-tenant BR-first cujo wedge de mercado é vender, self-service, espaços físicos por m² em grandes eventos (festas religiosas de massa como Festa de Trindade/GO 900k e Totus Tuus 90k) — algo que Sympla/Eventbrite/Doity não fazem (focam em ingresso B2C) e que Cvent/A2Z fazem mas em USD/inglês/enterprise. O concorrente real no piloto não é uma plataforma — é Excel + WhatsApp + papel. A pesquisa converge em quatro decisões de produto: (1) MVP vertical por persona — Organizadora → Fornecedor → Prestador → Público; (2) 2D agora, 3D depois; (3) PostgreSQL como único source-of-truth (constraint contratual derivada do problema crônico do FB_APU04); (4) multi-tenancy desde o dia 1.

**Stack recomendada (reconciliada — divergência resolvida):** Next.js 15 (App Router) + TypeScript end-to-end + Drizzle ORM + PostgreSQL 16 + Better Auth (organization plugin) + Konva.js (2D floor-plan) + Pagar.me v5 (split + PIX nativo). A pesquisa de STACK fez a análise mais profunda sobre velocidade de solo-dev com Claude Code e tem alta confiança neste pivô (Next.js dá Server Actions = ~60% menos boilerplate de CRUD, single language e maior corpus de treinamento LLM); a pesquisa de ARCHITECTURE assumiu Go por inércia do FB_APU04, mas suas decisões estruturais (modular monolith, RLS multi-tenancy, advisory locks, SSE+LISTEN/NOTIFY, outbox/inbox) são language-agnósticas e aplicam-se identicamente ao Node. **Reconciliação aplicada na fila assíncrona:** substituir BullMQ/Redis (default de STACK) por uma fila Postgres-backed em Node (**Graphile-Worker** preferencial, ou pg-boss) para honrar o princípio "PostgreSQL é o único source-of-truth" estabelecido na ARCHITECTURE e na PROJECT.md — fica registrado como **decisão de Phase 0** a confirmar no spike inicial.

**Riscos principais e mitigações:** (a) vazamento cross-tenant — mitigado por RLS + FORCE + role dedicado + middleware que faz `SET LOCAL app.current_tenant_id` em toda request; (b) race de reserva de lote (dois fornecedores clicam o mesmo lote) — mitigado por `pg_try_advisory_xact_lock` + reserva com TTL + job server-side de expiração; (c) webhook PIX entregue duas vezes (cobrança dupla) — mitigado por inbox table com PK no `event_id` do gateway + outbox pattern para enviar email/PDF; (d) colapso operacional na Festa de Trindade (900k atendentes, solo-dev) — mitigado por monolito modular boring + PgBouncer + load test antes do piloto + check-in PWA offline-first na Fase 4 + runbook escrito; (e) over-engineering — mitigado pela disciplina vertical-MVP e pela lista explícita de "What NOT to Use" em STACK.

## Key Findings

### Recommended Stack (RECONCILIADO)

> **Divergência reconciliada:** STACK.md recomendou pivotar para Next.js + TypeScript (análise focada em velocidade solo-dev + Claude Code, HIGH confidence). ARCHITECTURE.md assumiu Go-monolito + River queue por inércia do FB_APU04. **A stack final é a do STACK.md**, com a **única alteração** de trocar BullMQ/Redis por **Graphile-Worker (Postgres-backed)** para preservar o princípio "Postgres como single source of truth" estabelecido em ARCHITECTURE.md e na constraint contratual de PROJECT.md.

**Stack primária (Phase 0 lock):**

- **Next.js 15 (App Router) + React 19** — full-stack único; Server Actions matam ~60% do CRUD boilerplate; maior corpus LLM para Claude Code; rota `middleware.ts` ideal para detecção de tenant por host/path.
- **TypeScript 5.6 end-to-end** — Drizzle infere tipos do schema para Server Actions e clients; elimina classe de bugs DTO-drift do FB_APU04.
- **PostgreSQL 16 + Drizzle ORM + postgres.js** — único source-of-truth (constraint contratual); Drizzle suporta RLS nativo (`pgPolicy`, `pgTable.withRLS`); migrations explícitas SQL-first (sem `DROP TABLE schema_migrations` self-heal do FB_APU04).
- **Multi-tenancy por RLS + `current_setting('app.tenant_id')`** — defesa em profundidade; tabela `tenants` global + toda tabela tenant-owned com policy obrigatória; user da app sem `BYPASSRLS`.
- **Better Auth + organization plugin** — TypeScript-native, sessões em Postgres (sem Redis), OAuth/magic link/2FA built-in, organização = tenant.
- **Pagar.me v5** — split-payment first-class (`split.rules[]` com `recipient_id` + `liable` + `charge_processing_fee`); PIX + cartão; API de recipients para onboard self-service de fornecedor; backup Asaas no v2.
- **Konva.js + react-konva** — 2D floor-plan: polígonos clicáveis, Transformer (resize), event delegation, escala >5k lotes (Festa de Trindade); upgrade path para Three.js (`ExtrudeGeometry`) em v2.
- **Postgres `LISTEN/NOTIFY` + SSE (Server-Sent Events) via Route Handler** — real-time push de status de lote; <500ms; zero infra adicional; passa por Traefik sem WS.
- **Graphile-Worker (Postgres-backed queue)** — **ALTERAÇÃO RECONCILIADA**: substitui o BullMQ/Redis recomendado no STACK para honrar o princípio "Postgres como único source-of-truth". Suporta enfileiramento transacional (job enfileira na MESMA TX do business event → outbox pattern nativo), backoff, schedule, queues nomeadas. **Decisão de Phase 0** — confirmar no spike inicial; alternativa é pg-boss.
- **shadcn/ui + Tailwind CSS 4 + TanStack Query + React Hook Form + Zod 4** — UI consistente e acessível; forms tipados; v4 de Tailwind = 5-10× build mais rápido.
- **MinIO (S3-compatible) + Resend + Pino + Sentry** — storage de plantas/contratos com migração trivial para AWS S3; emails transacionais; logs JSON estruturados desde o dia 1; error tracking.
- **Coolify + Traefik + Docker + GitHub Actions** — herdar a infra validada do FB_APU04 (sem importar a dívida técnica de domínio).

**Razões para o pivô vs. herdar Go do FB_APU04:** FB_EVENTOS é CRUD + marketplace + canvas interativo, não high-throughput SPED ingester. Solo-dev + 3 meses + Claude Code = velocidade > performance microoptimizada. Uma linguagem (TS) elimina type-drift Go↔React do FB_APU04.

Detalhes: STACK.md

### Expected Features

**Must have (Fase 1 — piloto Festa de Trindade, P1):**
- Multi-tenant base (auth, RBAC simples, tenant_id global) — bloqueia tudo
- Cadastro de evento (nome, datas, local, capacidade, TZ, BRL)
- Editor 2D de planta — upload de PDF/PNG/JPG, desenho de polígonos clicáveis, metadata por lote (código, m², categoria, preço, status) — O CORE DIFERENCIADOR
- Cadastro/aprovação de fornecedor com validação CNPJ + upload de comprovantes
- Checkout PIX + Cartão via Pagar.me (split-aware desde o início, mesmo com regra zero)
- Contrato digital com e-sign (ZapSign ou Clicksign — decidir)
- Portal mínimo do fornecedor (compras, contratos, recibos, upload de docs)
- Dashboard de ocupação + dashboard financeiro mínimo
- LGPD baseline (consent versionado, audit log, política de exclusão)
- Cofre de documentos (S3/MinIO + URL assinada)
- Backup PITR do Postgres

**Should have (Fase 2-3 — diferenciadores):**
- Workflow integrado venda-de-espaço + contrato + cobrança (substitui Excel + PDF + WhatsApp)
- Add-ons no lote (energia, água, lixo, mesas)
- Lista de espera + reserva com TTL (15 min) + cancelamento/reembolso
- WhatsApp transacional (Meta Cloud API direta ou Zenvia)
- Split automático de comissão para mão de obra terceirizada (Pagar.me Recipients) — anti-feature em todos os concorrentes
- Cobrança recorrente da assinatura da organizadora
- Histórico do fornecedor entre eventos
- Importação assistida de planta (PDF → polígonos sugeridos)

**Defer (Fase 4 / v2+):**
- Ticketing público completo + check-in PWA offline (Fase 4)
- Vendas de bebidas / F&B / POS PWA (Fase 4)
- Integração Sympla/Eventbrite (publicação cross-platform — defensiva, não ofensiva)
- Marketplace público + white-label + custom domain (Fase 4)
- NFSe/NFe, cashless NFC, i18n, 3D rico CAD/BIM, app nativo, migração automática Eventbrite (v2+)

**Anti-features (não construir):** ERP completo, CRM completo, planta 3D no v1, WebSocket bidirecional no v1, IA generativa, programa de afiliados, customização sem-código profunda.

Detalhes: FEATURES.md

### Architecture Approach

Monolito modular em Next.js 15 (single repo, single deploy), decomposto em 12 módulos por capacidade de negócio (`identity`, `tenancy`, `events`, `floorplan`, `vendors`, `tickets`, `fnb`, `staffing`, `payments`, `billing`, `compliance`, `integrations`). Cada módulo possui suas tabelas; comunicação síncrona via interfaces TypeScript tipadas (constructor injection), assíncrona via outbox pattern (mesma TX do business event grava na fila Graphile-Worker via Postgres). Multi-tenancy por shared-schema + RLS forçada com `tenant_id` em toda tabela de domínio, derivado do session do Better Auth (org plugin) e propagado via middleware que faz `SET LOCAL app.tenant_id` por request dentro de uma transação. Routing por host no Traefik: path-based no v1 (`app.fbeventos.com/{tenant}`), subdomínio wildcard a partir da Fase 4 (`{tenant}.fbeventos.com`), custom domain como v2+ tier pago.

**Major components:**
1. Edge — Traefik — TLS wildcard ACME, rate limit, roteamento por host/path
2. Web — Next.js 15 — Server Components SSR para tenant-scoped, Server Actions para CRUD, Route Handlers para SSE/webhooks
3. PostgreSQL 16 — single source-of-truth: storage + queue (Graphile-Worker) + locks (`pg_try_advisory_xact_lock`) + pub/sub (`LISTEN/NOTIFY`) + outbox + inbox + audit log
4. MinIO — storage de plantas/contratos/QR codes (S3-compatible, pre-signed URLs)
5. External gateways — Pagar.me (PIX/cartão/split/recipients), Resend (email), BrasilAPI (CNPJ), Sympla/Eventbrite (Fase 4)
6. Observabilidade — Pino JSON + Sentry + Prometheus/Grafana (reaproveitar do FB_APU04)

**Padrões críticos:**
- Outbox pattern — business event + job enqueue na mesma TX → exactly-once entrega via worker
- Inbox pattern — webhook grava em tabela com PK no `event_id` externo + `ON CONFLICT DO NOTHING` → idempotência absoluta
- Advisory locks para hotspots (reserva de lote, refresh de MV)
- State machine explícita em `payments.status` e `lot_reservations.status`
- SSE + LISTEN/NOTIFY para real-time push (ocupação da planta)
- Read replica opcional para marketplace público (Fase 4)

Detalhes: ARCHITECTURE.md

### Critical Pitfalls

1. **Embedded-DB trap** (constraint contratual): nunca SQLite, nunca `.db`, nunca tracker em arquivo. CI grep gate bloqueia `sqlite3|@libsql|better-sqlite3` no `package.json` e `*.db` em qualquer artefato. Job queue e webhook inbox vivem em Postgres (Graphile-Worker), não em arquivo.
2. **Multi-tenant data leak**: handler esquece `WHERE tenant_id = ?` → vaza dados. Defesa em profundidade via RLS + `FORCE ROW LEVEL SECURITY` + user da app sem `BYPASSRLS` + middleware obrigatório que faz `SET LOCAL` + integration test com dois tenants para todo handler.
3. **Race de reserva de lote** (TOCTOU): dois fornecedores clicam lote #42, ambos pagam. Mitigação: `pg_try_advisory_xact_lock(hashtext('lot:'||event_id||':'||lot_id))` na TX da reserva + reservation row com `expires_at = now() + 15min` + Graphile-Worker scheduled job de expiração + SSE para empurrar mudança de status para outros clientes abertos.
4. **PIX webhook não-idempotente** → cobrança/email/PDF duplicados. Mitigação: `payment_webhooks_inbox` com PK no `gateway_event_id` + `ON CONFLICT DO NOTHING` + HMAC signature verificada em toda request + webhook handler retorna 200 rápido e enfileira trabalho (não processa inline).
5. **Colapso operacional no piloto Trindade** (900k atendentes, solo-dev): mitigação via PgBouncer transaction-pooling desde o dia 1, connection pool dimensionado para spike (não steady-state), check-in PWA offline-first (Fase 4), load test (k6) antes de cada fase ir ao piloto, runbook escrito + read-only-mode toggle como nuclear option.

Outros pitfalls a internalizar: LGPD non-compliance (consent granular como dados de primeira-classe, direito ao esquecimento como workflow), modelo de floor-plan locked a 2D (usar `jsonb` versionado para geometria), Sympla/Eventbrite sem reconciliação (one-way pre-allocation, FB_EVENTOS é authoritative), confusão subscription + commission billing (duas engines), Watchtower `:latest` (semver tag + canary), endpoints destrutivos sem guardrails (não existir em v1).

Detalhes: PITFALLS.md

## Implications for Roadmap

A pesquisa sugere uma estrutura de **5 fases sequenciais (Phase 0 a Phase 4)**, alinhada ao Vertical MVP por persona já decidido em PROJECT.md. A Phase 0 é necessária para travar decisões de stack (incluindo a reconciliação Graphile-Worker vs BullMQ) e blindar contra os pitfalls inherited do FB_APU04 antes de qualquer linha de código de domínio.

### Phase 0: Foundation, Stack Lock & Anti-Pitfall Hardening
**Rationale:** Antes de qualquer feature, é preciso (a) confirmar e travar a stack reconciliada (Next.js + Drizzle + **Graphile-Worker em vez de BullMQ**), (b) instalar todos os CI gates que blindam contra os pitfalls #1 (embedded-DB), #11 (bus factor), #15-21 (FB_APU04 inherited hygiene), e (c) bootstrap do projeto (`pnpm create next-app`, Drizzle config, Better Auth schema, RLS template de migration, Sentry, Pino, gitleaks).
**Delivers:** repo bootstrapped, CI verde (grep gates passando, gitleaks, biome lint, tsc), deploy pipeline Coolify, runbook esqueleto, dois `.env.example` (dev + prod) com mesmas variáveis, decisão registrada Graphile-Worker vs pg-boss.
**Addresses:** Multi-tenant base + Auth + RBAC (P1 de FEATURES.md), embedded-DB ban (PROJECT.md constraint), bus-factor mitigation.
**Avoids:** Pitfalls #1, #10, #11, #13, #14, #15-21 — TODOS antes de produção.
**Duration estimate:** ~1 semana.

### Phase 1: Organizadora End-to-End (Piloto Festa de Trindade)
**Rationale:** PROJECT.md decidiu vertical-MVP por persona, e a organizadora é a primeira porque sem evento cadastrado e planta desenhada não há fornecedor para vender. Esta fase entrega o cliente piloto (Festa de Trindade ≤3 meses).
**Delivers:** organizadora cadastra evento, sobe planta (PDF/PNG/JPG), desenha lotes 2D no Konva, define preços/categorias, cadastra/aprova fornecedores manualmente, recebe pagamento manual ou via link, gera contrato digital com e-sign, vê dashboard de ocupação e financeiro.
**Uses:** Next.js 15 + Drizzle + Postgres 16 + Better Auth (org plugin) + Konva.js + react-konva + pdf.js + MinIO (plantas/contratos) + Resend (emails) + ZapSign ou Clicksign (e-sign) + Pagar.me básico (criação de cobrança, sem self-service ainda).
**Implements:** módulos `identity`, `tenancy`, `events`, `floorplan`, `vendors` (admin-side), `compliance` baseline (consent + audit log), `payments` (admin-manual).
**Addresses:** Persona 1 inteira de PROJECT.md (P1 todos de FEATURES.md).
**Avoids:** Pitfalls #2 (RLS + FORCE em toda tabela desde a primeira migration), #3 (advisory lock no fluxo de reserva mesmo manual), #5 (LGPD consent infra + PII tags em colunas), #7 (geometria do lote como `jsonb` versionado).
**Critério de sucesso:** organizadora vende ≥X lotes do evento real (Trindade) via FB_EVENTOS, sem voltar para Excel/WhatsApp.
**Duration estimate:** ~10 semanas (o gargalo é o editor 2D).

### Phase 2: Fornecedor Self-Service + Checkout PIX/Cartão
**Rationale:** Com a base da organizadora pronta, o próximo gargalo de valor é remover a fricção do atendimento manual — fornecedor entra sozinho, escolhe lote na planta, paga PIX, recebe contrato. Esta fase é onde payments hardening acontece de verdade (webhooks idempotentes, SAGA reserva↔pagamento).
**Delivers:** portal de fornecedor, descoberta de eventos abertos, seleção interativa de lote no Konva (modo comprador), carrinho com add-ons (energia/água/lixo/mesas), checkout Pagar.me com split-aware (regra ainda pode ser zero), reserva com TTL 15min + cancelamento/reembolso, lista de espera, contrato digital pós-pagamento, segunda via de boleto.
**Uses:** Pagar.me v5 (split + PIX QR + cartão + webhooks), `pg_try_advisory_xact_lock`, SSE+LISTEN/NOTIFY (status do lote em tempo real), Graphile-Worker (job de expiração de reserva, geração de PDF de contrato, envio de email), inbox table `payment_webhooks_inbox`, outbox pattern.
**Implements:** `vendors` self-service, `floorplan` (reserva + lock), `payments` completo (PIX + cartão + webhooks + refunds), `compliance` (consent granular do fornecedor).
**Addresses:** Persona 2 inteira (FEATURES.md P1 do fornecedor); diferenciador #1 (workflow integrado venda+contrato+cobrança).
**Avoids:** Pitfalls #3 (race de reserva — load test 10 clientes concorrentes), #4 (PIX webhook double-charge — HMAC + idempotência forçada), #14 (sem endpoint destrutivo público).
**Duration estimate:** ~6 semanas.

### Phase 3: Prestador + Comissionamento + Assinatura
**Rationale:** Diversifica receita (4 vetores conforme PROJECT.md: % espaços, % mão de obra, assinatura, taxa fixa). Tecnicamente reutiliza Pagar.me Recipients (split.rules[]) já provisionado na Phase 2.
**Delivers:** cadastro de prestador (PF/MEI/PJ + PIX), catálogo de demandas (segurança, limpeza, montagem, garçom), candidatura/atribuição, split automático no pagamento do evento (organizadora → plataforma → prestador), repasse via PIX com comprovante, assinatura mensal recorrente da organizadora cobrada via Pagar.me Subscription, relatórios de comissão por prestador e por evento.
**Uses:** Pagar.me Recipients API + Subscription API, Graphile-Worker (cobrança recorrente + repasse + relatórios), WhatsApp/SMS opcional para notificação de atribuição.
**Implements:** `staffing`, `billing` (subscription + commission_invoices, duas engines distintas conforme Pitfall #9).
**Addresses:** Persona 3 inteira de PROJECT.md.
**Avoids:** Pitfall #9 (subscription + commission billing confusion — modelo de duas engines documentado em `.planning/billing/model.md`).
**Duration estimate:** ~4 semanas.

### Phase 4: Público — Ticketing, F&B, Marketplace, Integrações
**Rationale:** Última persona; é onde a plataforma vira "completa" e onde aparece o spike scenario (90k-900k atendentes simultâneos). Concentra os maiores riscos operacionais e por isso vem por último, com infra de Phase 0-3 já validada.
**Delivers:** ticketing público (categorias, lotes 1/2/3, meia-entrada lei BR, cupons, compra em grupo), check-in PWA offline-first (estádio sem internet — IndexedDB + sync queue + conflict resolution first-scan-wins), F&B online + POS PWA, integração Sympla/Eventbrite (one-way pre-allocation, FB_EVENTOS authoritative), marketplace público SSR/SSG com SEO + structured data + Lighthouse gate, white-label + custom domain via subdomain wildcard, widget embedable, read replica do Postgres para leitura pesada.
**Uses:** Next.js SSR/SSG para páginas públicas (SEO), CDN Cloudflare opcional, Sympla v2 API + Eventbrite v3 (com version pin), Twilio/Zenvia/Meta Cloud API (WhatsApp), `react-day-picker` para escolha de sessão, PWA service worker, Cloudflare R2 (alternativa ao MinIO) para escala.
**Implements:** `tickets`, `fnb`, `integrations` (Sympla/Eventbrite), `tenancy` (white-label, custom domain).
**Addresses:** Persona 4 inteira; diferenciador #2 (visão financeira multi-fonte consolidada).
**Avoids:** Pitfall #5 (full LGPD direito ao esquecimento workflow), #6 (event-day operational collapse — k6 load test 50k concurrent + offline check-in + runbook + read-only mode toggle), #8 (Sympla/Eventbrite reconciliation), #12 (SEO/mobile performance — Lighthouse mobile >85, LCP <2.5s).
**Duration estimate:** ~10-12 semanas (a maior fase em escopo e risco).

### Phase Ordering Rationale

- **Phase 0 antes de tudo:** os pitfalls inherited do FB_APU04 e a decisão Graphile-Worker vs BullMQ são contratuais — instalar os gates antes da primeira feature evita refactor caro depois.
- **Vertical-MVP por persona** (Phase 1→2→3→4) é decisão já travada em PROJECT.md e a pesquisa confirma: a organizadora bloqueia o fornecedor (sem evento+planta não há lote para vender); fornecedor bloqueia prestador (modelo de split precisa de fluxo de venda completo); público vem por último porque concentra o spike scenario e exige a infra mais hardenada.
- **Payments hardening na Phase 2 (não Phase 1):** Phase 1 paga manual/cobrança simples; Phase 2 é onde webhook idempotency + SAGA reserva↔pagamento + signature verification são não-negociáveis. Adiar para Phase 2 evita over-engineering em Phase 1.
- **LGPD em duas etapas:** baseline (consent + audit + PII tags) na Phase 1 porque o schema é irreversível depois de dados em produção; workflow completo de direito ao esquecimento na Phase 4 quando dados de público entram.
- **Floor-plan data model irreversível:** decisão na Phase 1 — geometria como `jsonb` versionado (`{"version":1, "type":"rect2d", ...}`) para permitir upgrade 2D→3D sem ALTER TABLE em produção (Pitfall #7).

### Research Flags

Phases que provavelmente vão precisar de `/gsd:plan-phase --research-phase <N>` durante o planning detalhado:

- **Phase 0:** decisão final Graphile-Worker vs pg-boss vs BullMQ (com fundamentação técnica completa); validar versões compatíveis (`next@15.4.x`, `drizzle-orm@0.45.x`, `better-auth@1.6.x`, Node 22 LTS); confirmar extensões Postgres no Coolify (`pgcrypto`, `pg_trgm`, opcionalmente `postgis`).
- **Phase 2:** payments hardening — verificar esquema exato de signature HMAC do Pagar.me v5 atual (training data pode estar defasado); padrões de retry/backoff específicos do gateway; modelagem de refund (PIX é one-shot, não authorize+capture).
- **Phase 3:** modelo de comissão exato — % por categoria de receita ou negociado por organizadora? Afeta schema de `commission_rules`; investigar Pagar.me Subscription edge cases (proration, dunning, suspensão).
- **Phase 4: research-phase obrigatório** — Sympla API atual (versão, endpoints, rate limits, OAuth2 vs token), Eventbrite v3 atual, padrões de PWA offline-first para check-in em escala (IndexedDB schema, conflict resolution, sync queue), comparação Cloudflare R2 vs S3 vs MinIO em prod BR, estratégia de CDN para marketplace público, hardening de carga (PgBouncer config, read replica lag, cache stampede prevention).

Phases com padrões standard (provavelmente podem pular research-phase):

- **Phase 1:** padrões bem documentados (Next.js Server Actions, Drizzle RLS, Konva polygons, Better Auth) — research da Phase 0 cobre quase tudo. Spike rápido só para o editor 2D pode ser suficiente.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (Next.js + Drizzle + Postgres + Better Auth) | HIGH | Versões verificadas live no npm; Context7 confirma APIs de Drizzle RLS, Konva, Better Auth, postgres.js LISTEN/NOTIFY |
| Stack — fila Postgres-backed em Node | MEDIUM-HIGH | Graphile-Worker é maduro e usado em produção, mas não foi o foco do STACK.md (que recomendou BullMQ); decisão final fica para Phase 0 spike |
| Pagar.me como primary gateway | HIGH (técnico) / MEDIUM (comercial) | Split + PIX verificados via Context7 reference docs; fees vêm de training data e exigem verificação contratual |
| Multi-tenancy via RLS forçada | HIGH | Drizzle `pgTable.withRLS` + `pgPolicy` + padrões Supabase verificados; padrão dominante em 2026 |
| Konva.js para 2D floor-plan | HIGH | Context7 indexa 2481 snippets; `Konva.Line` closed + Transformer + event delegation verificados |
| SSE + LISTEN/NOTIFY para real-time | HIGH | postgres.js suporta `LISTEN/NOTIFY` nativo; padrão Next.js 15 documentado |
| Features (table stakes, differentiators, anti-features) | HIGH | Eventbrite + Cvent + Pagar.me docs verificados via Context7 (HIGH benchmarks); Sympla/Whova/A2Z via conhecimento público (MEDIUM) |
| Architecture patterns (modular monolith, outbox/inbox, advisory locks, RLS) | HIGH | Padrões language-agnósticos — aplicam-se identicamente ao Node; ARCHITECTURE.md documenta com evidência Context7 + ecosystem consensus |
| Architecture choice — Go vs Node | RECONCILED → HIGH for Node | ARCHITECTURE.md assumiu Go por inércia FB_APU04, mas STACK.md fez análise mais profunda (solo-dev + Claude Code velocity) com HIGH confidence — Node prevalece, padrões estruturais transferem 1:1 |
| Pitfalls (FB_APU04 lessons + multi-tenant + payments + LGPD) | HIGH | Evidência direta do FB_APU04 CONCERNS.md/INTEGRATIONS.md; padrões PostgreSQL/payments/LGPD bem documentados |
| Sympla/Eventbrite integration specifics | MEDIUM | Defer details to Phase 4 research |
| LGPD legal completeness | MEDIUM | Stack cobre mecanismos técnicos; texto legal (DPA, política de privacidade) fora do escopo do dev |
| Three.js v2/v3 3D upgrade path | MEDIUM | Path é sólido (`ExtrudeGeometry`) mas DWG/IFC complexity é deep-dive da v2 |

**Overall confidence:** HIGH — com uma decisão técnica de Phase 0 ainda aberta (Graphile-Worker vs pg-boss vs BullMQ) e três áreas com confiança MEDIUM (Sympla/Eventbrite, LGPD legal, 3D path) que são todas concentradas em fases futuras (4 e v2+), não bloqueando Phase 0-3.

### Gaps to Address

- **Fila assíncrona em Node sobre Postgres:** Phase 0 deve fazer spike rápido (~1 dia) comparando Graphile-Worker, pg-boss e (apenas para baseline) BullMQ; decisão registrada em ADR. Critérios: `InsertTx`-like na mesma TX do business event, TypeScript-friendly, unique-jobs, scheduled jobs, retry/backoff, observabilidade.
- **Pagar.me commercial terms:** Phase 0 ou Phase 1 deve obter proposta comercial real (fees PIX/cartão/split) — training data pode estar defasada; afeta modelagem financeira.
- **E-sign provider (ZapSign vs Clicksign vs D4Sign):** decidir em Phase 1 com base em preço e DX da API; arquitetura já modela como provider-agnostic.
- **Add-ons no lote (energia/água/lixo/mesas):** open question de FEATURES.md — validar com organizadora piloto se é P1 (faz parte do v1) ou P2 (Fase 2); afeta escopo da Phase 1.
- **Política de comissão (% fixo por categoria vs negociado por tenant):** decidir até Phase 3; afeta schema `commission_rules` mas não bloqueia Phase 1-2.
- **WhatsApp provider (Meta Cloud API direta vs Zenvia/Z-API):** Phase 2 — primeira decisão de mensageria transacional.
- **Custom domain por organizadora (P1 da Fase 4 ou OK em subdomínio compartilhado?):** decisão da Phase 4; afeta ops Traefik (DNS-01 ACME on-demand).
- **Política de retenção LGPD (meses pós-evento):** consulta jurídica antes de Phase 4 ir para produção.
- **Postgres extensions no Coolify (`pgcrypto`, `pg_trgm`, `postgis`):** Phase 0 confirma se vêm na imagem padrão ou exige custom image.

## Sources

### Primary (HIGH confidence)
- STACK.md — análise completa de stack reconciliada (Next.js + Drizzle + Postgres + Pagar.me + Konva)
- FEATURES.md — landscape de features com mapping por fase/persona e matriz competitiva
- ARCHITECTURE.md — decisões estruturais (monolito modular, RLS, advisory locks, outbox/inbox, SSE)
- PITFALLS.md — 21 pitfalls catalogados com fase de prevenção e evidência FB_APU04
- Context7 libraries — `/vercel/next.js`, `/drizzle-team/drizzle-orm-docs`, `/konvajs/konva`, `/konvajs/react-konva`, `/websites/pagar_me_reference`, `/llmstxt/asaas_llms_txt`, `/supabase/supabase` (RLS patterns), `/better-auth/better-auth`, `/porsager/postgres` (LISTEN/NOTIFY), `/riverqueue/river` (transactional outbox pattern), `/traefik/traefik`, `/websites/eventbrite_platform`, `/websites/developers_cvent`
- npm registry — todas as versões verificadas live em 2026-06-11
- FB_APU04 codebase audit — `/tmp/FB_APU04/.planning/codebase/CONCERNS.md` e `INTEGRATIONS.md` (lessons-learned)
- PROJECT.md — constraints contratuais (Postgres único, LGPD, multi-tenant desde dia 1, vertical-MVP por persona, embedded-DB banido)

### Secondary (MEDIUM confidence)
- Sympla, Doity, Even3, EventMobi, Whova, A2Z/Personify, Bizzabo — análise comparativa por conhecimento público (WebSearch indisponível na sessão)
- Pagar.me/Asaas/Mercado Pago fee schedules — training data; exigem verificação contratual
- LGPD requirements — Lei 13.709/2018 codificada; texto legal específico (DPA, política de privacidade) exige consulta jurídica
- Cross-border data transfer (Stripe, SendGrid US-based) — DPA padrão necessário

### Tertiary (LOW confidence — VERIFY na fase apropriada)
- Sympla API v2 schema atual e rate limits — verificar no início da Phase 4
- Eventbrite v3 OAuth2 scopes atuais — verificar no início da Phase 4
- Pagar.me v5 webhook signature scheme exato — verificar no início da Phase 2
- PostGIS availability no Coolify-managed Postgres — confirmar no Phase 0 spike
- Better Auth organization plugin maturity para os 4 personas — confirmar no Phase 0; fallback é RBAC hand-rolled

---
*Research completed: 2026-06-11*
*Ready for roadmap: yes*
*Reconciliação Stack vs Architecture: Node prevalece (Next.js + TS), padrões da Architecture (RLS, advisory locks, SSE+LISTEN/NOTIFY, outbox/inbox) transferem 1:1; fila assíncrona muda para Postgres-backed (Graphile-Worker) — decisão de Phase 0*
