# FB_EVENTOS — Plataforma SaaS de Gestão de Grandes Eventos

## What This Is

Plataforma SaaS multi-tenant para empresas que organizam grandes eventos — começando por eventos religiosos de massa no Brasil (referência: Festa de Trindade/GO com previsão de 900.000 pessoas; Totus Tuus com 90.000 pessoas em um dia) e com potencial de expansão mundial. Permite às organizadoras gerirem ponta-a-ponta: venda de espaços a fornecedores/patrocinadores (visualização da planta + cobrança por m²), terceirização de mão de obra com comissionamento da plataforma, venda de ingressos, venda de bebidas e integração com sites de vendas externos.

## Core Value

**Habilitar a organizadora a vender espaços de eventos a fornecedores de forma self-service, com planta visual e pagamento integrado** — sem precisar de WhatsApp/Excel/contratos em papel. Tudo o mais (ingressos, prestadores, bebidas, integrações) é importante mas vem depois.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

**Persona 1 — Organizadora (Fase 1 / piloto Festa de Trindade)**
- [ ] Cadastro de evento (nome, datas, local, equipe)
- [ ] Carga da planta do evento (PDF/imagem) com mapeamento de lotes/zonas clicáveis em 2D
- [ ] Definição de lotes por m² com preço e regras (categoria, restrições)
- [ ] Cadastro/aprovação de fornecedores
- [ ] Geração de contratos digitais e cobrança
- [ ] Dashboard de ocupação da planta e fluxo financeiro

**Persona 2 — Fornecedor / Patrocinador (Fase 2)**
- [ ] Login self-service e descoberta de eventos abertos
- [ ] Escolha de espaço na planta interativa 2D
- [ ] Checkout com PIX/Cartão (gateway BR)
- [ ] Gestão da própria presença no evento (documentos, equipe, horários)

**Persona 3 — Prestador de Serviço (Fase 3)**
- [ ] Cadastro/aprovação de prestadores (mão de obra terceirizada)
- [ ] Atribuição de demandas e comissionamento para a plataforma
- [ ] Repasse e relatórios de comissão

**Persona 4 — Público Final (Fase 4)**
- [ ] Marketplace público (site/checkout) para venda de ingressos
- [ ] Integração com Sympla/Eventbrite (publicação cross-platform)
- [ ] Venda de bebidas / produtos no evento

**Transversal**
- [ ] Multi-tenant SaaS desde o início (uma única base atende várias organizadoras)
- [ ] Conformidade LGPD (consentimento, retenção, direito ao esquecimento)
- [ ] Conciliação financeira e relatórios para a organizadora
- [ ] Modelo de receita: % sobre espaços + % sobre ingressos/bebidas + % sobre mão de obra + assinatura mensal por organizadora

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Planta 3D rica (CAD/BIM-like, importação DWG/IFC, walkthrough VR)** — adiada para v2/v3. v1 usa 2D clicável (canvas/SVG). Razão: 3D rico tem risco técnico/orçamento muito alto para solo dev em 3 meses; 2D entrega valor suficiente para validar modelo de negócio.
- **Banco de dados embarcado (SQLite, arquivos .db locais, bridge.py com tracker file)** — proibido por contrato. Razão: o FB_APU04 herdou SQLite watermark no ERP Bridge que cresce sem limites, tem isolamento frágil por config-stem, e sem testes. FB_EVENTOS deve ter PostgreSQL como source-of-truth único.
- **Integração com maquininhas/PDV físico no local** — adiada para v2+. Razão: hardware-heavy; precisa do core software validado antes.
- **Integração com ERPs e emissão fiscal (NFe/NFSe)** — adiada para v2+. Razão: regulatório intensivo; primeiro validar produto, depois fiscalizar.
- **Internacionalização (i18n, múltiplas moedas, gateways não-BR)** — adiada para v2+. Razão: primeiro mercado é Brasil; expansão internacional vem depois de PMF.
- **Migração automática de dados do Eventbrite** — fora do v1. Razão: organizadora pode operar em paralelo (Eventbrite atual + FB_EVENTOS para espaços) até cutover natural.

## Context

**Cliente piloto:**
- Parceira/amiga do solicitante, organizadora de eventos no Brasil
- Foco atual: festas religiosas de massa (Totus Tuus 90k pessoas em estádio de futebol; Festa de Trindade/GO 900k pessoas)
- Hoje opera com mistura de **Excel/Sheets + Eventbrite + WhatsApp + papel** — fricção alta na venda de espaços para fornecedores
- Evento piloto da Fase 1: **Festa de Trindade/GO** (≤3 meses)

**Mercado:**
- Eventbrite/Sympla cobrem bem venda de ingressos para público
- Gestão de espaços/stands para fornecedores em grandes eventos é nicho mal-servido — diferenciador do FB_EVENTOS

**Histórico de aprendizado (referência FB_APU04):**
- FB_APU04 (sistema fiscal do mesmo grupo) usou SQLite embarcado no `erp-bridge-aws/bridge.py` como watermark — gerou problemas de crescimento ilimitado, isolamento frágil entre tenants (config-stem), zero cobertura de testes
- Stack do FB_APU04 (Go 1.22 + React 18 + PostgreSQL 15 + Docker/Coolify + Traefik) é referência arquitetural — a definir na pesquisa se será reusado tal qual ou adaptado

**Time:**
- Solo dev + Claude Code → fases pequenas e sequenciais; Vertical MVP por persona

## Constraints

- **Persistência**: PostgreSQL como source-of-truth único. **Proibido** SQLite embarcado, arquivos `.db` locais, ou bridges com tracker em arquivo — restrição contratual derivada do problema crônico do FB_APU04.
- **Timeline**: Fase 1 (Organizadora end-to-end mínima) precisa rodar na **Festa de Trindade/GO** (≤3 meses).
- **Pagamentos**: Gateway brasileiro obrigatório (PIX + Cartão) — Pagar.me / Mercado Pago / Stripe BR, a decidir na pesquisa.
- **Regulatório**: LGPD compliance obrigatório (consentimento, retenção, direito ao esquecimento) desde o v1.
- **Multi-tenancy**: Arquitetura multi-tenant desde o primeiro dia (mesmo iniciando com 1 cliente) — evitar refactor doloroso depois.
- **Recursos**: Dev solo apoiado por AI → fases pequenas, sequenciais, vertical MVP por persona.
- **Stack**: A confirmar na pesquisa. Hipótese inicial = Go + React + PostgreSQL + Docker/Coolify (FB_APU04 pattern).

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Vertical MVP por persona (Organizadora → Fornecedor → Prestador → Público) | Solo dev + 3 meses até piloto + risco de "tudo integrado no v1". Cada fase entrega valor end-to-end validável em evento real. | — Pending |
| 2D primeiro, 3D rico depois | 3D CAD/BIM-like é o item de maior risco técnico. 2D clicável (canvas/SVG) entrega valor suficiente para validar modelo de negócio. | — Pending |
| PostgreSQL único — proibido SQLite/banco embarcado | Aprendizado direto do FB_APU04: SQLite watermark do bridge.py cresceu sem limites, isolamento frágil, sem testes. FB_EVENTOS não pode repetir. | — Pending |
| Multi-tenant desde o v1 | Modelo SaaS — adicionar multi-tenant depois exige refactor caro. Custo marginal no v1 é aceitável. | — Pending |
| FB_APU04 como referência arquitetural (não fork de código) | Reusar padrões (Coolify, Docker, observabilidade) sem importar dívida técnica do APU04. Stack final definida na pesquisa. | — Pending |
| Múltiplas fontes de receita (% espaços + % ingressos/bebidas + % mão de obra + assinatura) | Diversificação reduz risco de modelo de monetização não funcionar em uma vertical. | — Pending |
| Sem migração automática do Eventbrite no v1 | Organizadora opera em paralelo (FB_EVENTOS p/ espaços + Eventbrite p/ ingressos) até cutover natural na Fase 4. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-11 after initialization*
