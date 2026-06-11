# Feature Research

**Domain:** Multi-tenant SaaS para gestão de grandes eventos (vertical: festas religiosas/culturais de massa no Brasil, com nicho em venda self-service de espaços para fornecedores)
**Researched:** 2026-06-11
**Confidence:** MEDIUM-HIGH

> **Source mix:** Eventbrite Platform API (Context7, HIGH), Cvent Developer Portal (Context7, HIGH), Pagar.me API (Context7, HIGH) verificam features de ticketing, exhibitor/booth management e split de pagamento. Sympla, Doity, Even3, EventMobi, Whova, A2Z/Personify, Bizzabo são analisados a partir de conhecimento de mercado público (MEDIUM — web search/fetch foram negados durante esta investigação; recomenda-se uma rodada de validação por entrevista com a organizadora piloto antes de congelar requisitos).

---

## 1. Posicionamento e Tese de Nicho

A pesquisa confirma o gap competitivo descrito no PROJECT.md:

| Eixo | Eventbrite / Sympla / Doity | Cvent / A2Z / Personify | Whova / EventMobi / Bizzabo | **FB_EVENTOS (wedge)** |
|------|-----------------------------|--------------------------|------------------------------|------------------------|
| Foco primário | Ingressos B2C | Exhibitor mgmt enterprise (trade shows) | Engagement/app no evento | **Venda self-service de espaços + ingressos + mão de obra em grandes eventos brasileiros** |
| Floor plan / booth picker | Não (ou só seating de teatros) | Sim, sofisticado mas caro/enterprise | Não | **Sim, 2D clicável, simples, BR-friendly** |
| Cobrança por m² para fornecedores | Não | Sim, mas via vendas consultivas | Não | **Sim, self-service** |
| Mão de obra terceirizada com split | Não | Não nativamente | Não | **Sim, com commissionamento da plataforma** |
| Mercado BR (PIX, NFSe, LGPD) | Sympla/Doity sim; Eventbrite parcial | Não foca BR | Não foca BR | **BR-first** |
| Preço | Por transação | Enterprise (USD 10k+/ano) | SaaS médio (USD 5-30k/ano) | **% transação + assinatura modesta** |

**Conclusão:** O concorrente real do FB_EVENTOS na Fase 1 não é Sympla nem Eventbrite — é o **Excel + WhatsApp + papel** que a organizadora usa hoje para vender espaços. Sympla/Eventbrite continuam vivos para ingressos (Fase 4 integra, não substitui). Cvent/A2Z são overkill, em inglês e caros demais. O wedge é claro: **floor plan 2D self-service + checkout BR + contrato digital, no idioma e preço corretos para o produtor brasileiro de eventos de massa**.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features que, se faltarem, o produto parece quebrado. Categorizadas por persona/dimensão.

#### 1. Event setup (Organizadora — Fase 1)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cadastro de evento (nome, datas, local, capacidade prevista) | Eventbrite/Sympla mostram isto na primeira tela; modelo mental universal | LOW | Eventbrite API: `name`, `start`, `end`, `venue`, `capacity`, `timezone`, `currency` — replicar este shape |
| Múltiplos eventos por organizadora | Multi-tenant + organizadora roda vários eventos por ano (Trindade, Totus Tuus, etc.) | LOW | Cvent/Eventbrite separam organization/account de events |
| Equipe e papéis (owner, admin, financeiro, atendente, viewer) | Organizadora tem time, não é uma pessoa só | MEDIUM | RBAC simples no v1 (3-4 papéis fixos); políticas finas em v2 |
| Edição de evento publicado com auditoria de mudanças | Mudanças de preço/datas após venda iniciada precisam trilha | MEDIUM | Audit log no Postgres (event sourcing leve); LGPD pede |
| Status do evento (rascunho, publicado, vendas abertas, encerrado, cancelado) | Padrão Eventbrite (`status: draft/live/started/ended/canceled`) | LOW | Replicar enum; state machine simples |
| Configuração de timezone e moeda (BRL default) | Eventos brasileiros operam em horário local; relatórios precisam de moeda consistente | LOW | TZ por evento, moeda global BRL no v1 |

#### 2. Floor plan / Booth management (Organizadora + Fornecedor — Fases 1 e 2) — **O CORE DIFERENCIADOR**

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Upload da planta (PDF/PNG/JPG/SVG) | Organizadora já tem a planta desenhada no CAD ou guardanapo digitalizado | LOW | PDF→PNG via pdfium/imagemagick; SVG cru |
| Editor 2D de lotes sobre a planta (polígonos clicáveis) | Sem isto, FB_EVENTOS = Excel com cara nova | MEDIUM-HIGH | Canvas/SVG no React; bibliotecas como react-konva ou fabric.js; ~3-5 dias de UI |
| Lote com metadados (código, m², categoria, restrições, preço, status) | Catálogo essencial | LOW | Schema Postgres com índices por evento+status |
| Categorias de lote (alimentação, bebida, artesanato, religioso, patrocínio âncora) | Organizadora precifica diferente por categoria; restringe quem pode comprar | LOW | Tabela de categorias por evento |
| Status de lote (disponível, reservado, em pagamento, vendido, bloqueado) | Replicar o "carrinho" do Eventbrite mas para lotes físicos | MEDIUM | Inclui timeout de reserva (ex.: 15 min para concluir pagamento) — risco de race condition se ignorado |
| Visualização do mapa de ocupação (heatmap colorido) | Organizadora quer ver "quanto já vendi?" de relance | LOW | Render do mesmo SVG colorindo polígonos por status |
| Tabela de preços por lote / categoria / período (lotes promocionais antes de X data) | Equivalente a `ticket_classes` do Eventbrite mas para espaço físico | MEDIUM | Reaproveitar mental model de ticket_class do EB |
| Reservas manuais pela organizadora (bloqueio interno, cortesia) | Cvent permite "hold" para sponsors VIP | LOW | Status `bloqueado` com motivo e responsável |
| Lista de espera por lote/categoria quando lotado | Padrão em Eventbrite/Sympla para ingressos | MEDIUM | Trigger quando libera reserva expirada ou cancelamento |
| Histórico de quem tocou no lote (quem reservou, quem cancelou, valor) | Auditoria + suporte | LOW | Audit log já mencionado acima |

#### 3. Vendor self-service (Fornecedor — Fase 2)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Descoberta de eventos abertos para venda de espaços | Site público / marketplace de eventos da organizadora | LOW | Lista filtrada por status + datas |
| Cadastro de fornecedor (CNPJ, razão social, responsável, comprovantes) | Compliance fiscal/jurídica BR | MEDIUM | Validação de CNPJ (BrasilAPI / ReceitaWS) + upload de comprovantes |
| Aprovação manual de fornecedor pela organizadora | Triagem antes de liberar compra; Cvent tem fluxo similar para sponsors | LOW | Workflow approval com estados + notificação |
| Seleção interativa de espaço na planta | É o diferencial; sem isto o fornecedor abandona | MEDIUM | Reusa o componente da #2 em modo "comprador" |
| Carrinho com múltiplos lotes + complementos (energia, água, lixo, mesas) | Cvent vende add-ons; Eventbrite/Sympla vendem como ticket extras | MEDIUM | Modelar como "produto add-on" por lote/evento |
| Checkout PIX + Cartão (parcelado) | Mercado BR; Sympla/Pagar.me são padrão | MEDIUM | Pagar.me ou Mercado Pago — split-aware (vide #8) |
| Contrato digital gerado a partir de template + e-sign | Hoje é PDF + WhatsApp; fricção real | MEDIUM | Template + render PDF (gotenberg/wkhtmltopdf); e-sign via Clicksign/D4Sign/ZapSign |
| Portal do fornecedor pós-venda (documentos, equipe, horários, status, recibos) | Cvent Exhibitor Portal é referência | MEDIUM | Dashboard com upload de docs (alvará, vigilância sanitária, ART) |
| Reemissão de boleto/cobrança + segunda via | Suporte básico | LOW | Webhook Pagar.me + endpoint manual |
| Cancelamento e reembolso com regras | LGPD + Código de Defesa do Consumidor | MEDIUM | State machine com política configurável por evento |

#### 4. Ticketing (Público — Fase 4)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Tipos de ingresso (categorias, preços, lotes 1/2/3, gratuidade, meia-entrada) | Padrão Sympla/Eventbrite; meia-entrada é lei BR (Lei 12.933/2013) | MEDIUM | Replicar `ticket_class` do EB; lógica BR de meia-entrada com validação documental |
| Limite por pedido, limite total, datas de início/fim de venda | Eventbrite expõe `minimum_quantity`/`maximum_quantity`/`sales_start`/`sales_end` | LOW | Mesma modelagem do EB |
| Cupons de desconto (percentual, valor, uso único/múltiplo, validade) | Padrão de mercado; Eventbrite tem endpoint `discounts` | MEDIUM | Endpoint `organizations/{id}/discounts` no EB serve de blueprint |
| Compra em grupo (vários ingressos, vários nomes) | Sympla/Eventbrite suportam; eventos religiosos vendem famílias inteiras | MEDIUM | Eventbrite expõe `quantity` + `attendees[]` por order |
| Check-in via QR Code (app mobile/web) | Eventbrite e Sympla são best-of-class; barcode `status: used` evita reentrada | MEDIUM | PWA offline-first (sem internet em estádio); sync ao reconectar |
| Lista de convidados / cortesias controladas | Eventos religiosos têm autoridades/imprensa | LOW | Reaproveita modelo de ticket + flag `comp` |
| Reenvio de ingresso por e-mail/SMS | Padrão de suporte | LOW | Mailer + Twilio/Zenvia |
| Devolução parcial ou total dentro do prazo | CDC BR; Sympla aceita | MEDIUM | Pareado com gateway |

#### 5. Beverage / F&B sales (Público — Fase 4 / v2)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Catálogo de produtos por evento (bebida, comida, suvenires) | Equivalente a mini e-commerce do evento | LOW | Tabela `product` por evento |
| Venda online pré-evento (retira no estande X) | Reduz fila no dia | MEDIUM | Reaproveita checkout do ticketing |
| Cashless / pulseira recarregável | Padrão em festivais; ANIPES/ABRAFESTA usam | HIGH | **v2+** — exige hardware/integração; fora do v1 |
| POS no estande (PWA + QR do voucher) | Operação no dia | MEDIUM | PWA offline-first; **v1.x se houver tempo** |
| Estoque básico (alerta de ruptura) | Operação | LOW | Contador decremental por venda |

#### 6. Outsourced labor / staffing (Prestador — Fase 3)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cadastro de prestador (PF/MEI/PJ + dados bancários para PIX) | Compliance fiscal e operacional | MEDIUM | Validação de CPF/CNPJ + chave PIX |
| Catálogo de demandas (segurança, limpeza, montagem, garçom) com vagas e horários | Organizadora precisa "publicar" demandas | LOW | CRUD simples |
| Candidatura/atribuição (aceite do prestador, confirmação da organizadora) | Workflow básico | MEDIUM | Notificações WhatsApp/SMS são quase obrigatórias no mercado |
| Comissionamento da plataforma com split automático (Pagar.me Recipients) | Modelo de receita FB_EVENTOS; Pagar.me suporta `split.rules` nativo | MEDIUM | Confirmado no Pagar.me docs: `split.enabled`, `rules[]` por `recipient_id` |
| Repasse via PIX com comprovante e DRE simplificada | Prestador precisa rastrear pagamento | MEDIUM | Webhook do gateway + relatório por prestador |
| Avaliação/feedback do prestador pela organizadora | Reputação simples | LOW | **v1.x ou v2** — não bloqueia receita |

#### 7. Marketplace público (Público + Organizadora — Fase 4)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Site público com marca da organizadora (cores, logo, domínio custom) | Sympla/Eventbrite são genéricos demais para organizadoras com identidade | MEDIUM | White-label essencial para diferenciar |
| Página do evento SEO-friendly (OG tags, sitemap, dados estruturados Event schema.org) | Tráfego orgânico — religioso + público busca Google | LOW | Next.js SSR / SvelteKit / Astro resolvem |
| Widget de checkout embedável em outros sites | Eventbrite Embedded Checkout é referência (vide código no Context7) | MEDIUM | Iframe ou script; bem documentado pelo EB |
| Compartilhamento social (WhatsApp, Instagram, FB) | Público BR vive em WhatsApp | LOW | Botões + deep-links |
| Busca de eventos pelo público | v2 (quando houver várias organizadoras) | LOW | Não prioritário Fase 1-4 |

#### 8. Integrações (Transversal — espalha por todas as fases)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Gateway de pagamento BR (Pagar.me ou Mercado Pago) — PIX + cartão + split | Sem isso não há receita | HIGH | Pagar.me docs confirmam: split por recipient, PIX, cartão, assinatura. Decisão Pagar.me vs MP fica para STACK.md |
| Webhook handler resiliente (idempotência, retry) | Pagamentos assíncronos exigem | MEDIUM | Padrão clássico de payments engineering |
| E-mail transacional (Resend, SES, Postmark) | Confirmações de compra, lembretes, recibos | LOW | Decidir provider em STACK.md |
| WhatsApp / SMS para confirmações e check-in (Twilio, Zenvia, Meta Cloud API) | Mercado BR vive em WhatsApp; ignorar é fricção | MEDIUM | Meta Cloud API direta ou Z-API/Zenvia; **v1.x se possível** |
| Integração com Sympla/Eventbrite (publicar evento, sincronizar vendas) | Marca a transição da organizadora gradualmente — PROJECT.md menciona Fase 4 | HIGH | Eventbrite API tem doc rica (Context7); Sympla tem API parcial — verificar contrato/limites |
| Calendário (.ics) para fornecedores/prestadores | Padrão; Cvent e EB exportam | LOW | Geração de ICS server-side |
| NFSe/NFe (emissão automática) | Compliance fiscal BR | HIGH | **EXPLICITAMENTE OUT-OF-SCOPE no PROJECT.md (v2+)** — não confundir com cobrança |

#### 9. Multi-tenant SaaS ops (Transversal)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Onboarding self-service da organizadora (cadastro, KYC leve, plano) | SaaS moderno; cliente piloto é manual mas a plataforma precisa do shape | MEDIUM | KYC de CNPJ + plano + dados de recebimento |
| Cobrança recorrente (assinatura mensal) | Modelo de receita | MEDIUM | Pagar.me Subscription objeto está nos docs (Context7) |
| Painel da organizadora separado por tenant | Isolamento de dados | MEDIUM | Row-level security no Postgres ou tenant_id em todas as tabelas — decisão de arquitetura |
| Custom domain por organizadora (eventos.fulanaeventos.com.br) | Whitelabel | MEDIUM | Wildcard SSL + roteamento por host header |
| Branding configurável (cores, logo, favicon, e-mail template) | Whitelabel | MEDIUM | CSS variables + tenant_config |
| Convite de usuários por e-mail com aceite | Padrão SaaS | LOW | Tokens com TTL |

#### 10. Reporting / Analytics (Organizadora — todas as fases)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Dashboard de ocupação da planta (% vendido, % reservado, % livre, receita prevista) | Pedido explícito no PROJECT.md | LOW | Aggregations por evento |
| Receita por categoria/persona (espaços, ingressos, mão de obra, bebidas) | Diversificação de receita = visibilidade | MEDIUM | Modelo financeiro precisa categorizar receitas desde o v1 |
| Comissões e splits — detalhamento por transação | Reconciliação contábil | MEDIUM | Reaproveita dados do gateway + Pagar.me reports |
| Fluxo de caixa do evento (a receber, recebido, repasses pendentes, comissão da plataforma) | Organizadora não tem isso hoje (Excel) | MEDIUM | View materializada por evento |
| Export CSV / Excel | Cliente vai cruzar com sistema externo | LOW | streaming CSV |
| Histórico do fornecedor entre eventos (recorrente vs novo) | Cvent tem; ajuda a vender Fase 2 | LOW | Query por CNPJ |

#### 11. Compliance (Transversal — desde o v1)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Consentimento LGPD no cadastro (banner + registro de aceite versionado) | Lei 13.709/2018 — multas reais; constraint do PROJECT.md | MEDIUM | Tabela `consent_record(user_id, term_version, accepted_at, ip)` |
| Política de retenção e direito ao esquecimento (delete on request) | LGPD art. 18 | MEDIUM | Soft-delete + job de hard-delete pós retenção |
| Audit log (quem fez o quê, quando, em qual recurso) | Compliance + suporte | MEDIUM | Tabela `audit_event` particionada por data |
| Cofre de documentos (alvará, vigilância sanitária, ART, contratos) | Operação real do evento BR exige | MEDIUM | S3-compatible (MinIO/R2) com URL assinada |
| 2FA opcional para organizadora | Padrão SaaS B2B | MEDIUM | TOTP via authenticator; **v1.x** |
| Backup e PITR do Postgres | Operação SaaS responsável | MEDIUM | Coolify + PG backup; testado mensalmente |

---

### Differentiators (Competitive Advantage)

Onde FB_EVENTOS ganha vs Sympla/Eventbrite/Cvent. Estes não precisam ser sofisticados — precisam **existir** e **funcionar** no contexto BR de eventos de massa.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Floor plan 2D self-service para venda de espaços por m²** | Sympla/Eventbrite não têm. Cvent tem mas é enterprise/USD/inglês. **Esta é a feature 0.** | MEDIUM-HIGH | Já listada em Table Stakes (#2) — repete aqui como wedge diferenciador |
| **Workflow integrado venda-de-espaço + contrato + cobrança em um lugar** | Hoje é Excel + PDF + WhatsApp + boleto. Unificar = redução de fricção brutal | MEDIUM | Stitch dos blocos 2/3 acima |
| **PIX-first checkout para fornecedores e público** | Mercado Pago e Sympla suportam, mas FB_EVENTOS desenha o fluxo do início com PIX como primeira opção | LOW | Decisão de UX; backend já suporta via Pagar.me |
| **Split automático para mão de obra terceirizada** | Cvent/A2Z não fazem. Sympla não foca isso. Pagar.me Recipients resolve nativamente | MEDIUM | `split.rules` no checkout — testado em produção em e-commerce BR |
| **Dashboard financeiro multi-fonte (espaços + ingressos + mão de obra + bebidas) por evento** | Eventbrite só mostra ingressos. Sympla idem. Visão consolidada é o que a organizadora pede | MEDIUM | Sumarização por categoria de receita |
| **Vertical para eventos religiosos / culturais de massa BR** | Posicionamento: copy, templates de contrato, integrações com Sympla/Eventbrite preservam o passado. Cvent não fala português; Eventbrite é genérico | LOW | Reside em copy, templates, demos — não em código |
| **White-label sob domínio da organizadora** | Sympla coloca a marca Sympla. Organizadora de Trindade quer "trindade.eventos.com.br" | MEDIUM | Custom domain + branding |
| **Mobile-first PWA offline para check-in em estádio sem internet** | Eventos de 90-900k pessoas em locais sem cobertura 4G. Sympla/Eventbrite assumem internet | MEDIUM-HIGH | Service worker + sync queue; CRDT light para conflitos |
| **Contratos digitais com e-sign integrado (Clicksign/D4Sign/ZapSign)** | Eventbrite/Sympla não fazem isso para venda de espaço | MEDIUM | API de terceiros + webhook |
| **Importação de planta a partir de PDF/JPG e desenho de polígonos com snap-to-grid** | Reduz fricção de setup inicial — quem ganhar o ramp-up ganha o cliente | MEDIUM | OpenCV/canvas; **v1.x** se v1 só aceitar SVG |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features que parecem boas, agradam stakeholders, mas matam timeline ou foco. Documentar aqui para impedir reentrada.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **ERP completo (estoque, fiscal, RH, contábil)** | Cliente piloto pode pedir "já que está nisso..." | Caminho para virar ERP médio que não compete com Senior/Totvs/Omie; viola "Vertical MVP" | Manter export para o ERP/contador da organizadora; foco no nicho de eventos |
| **CRM completo (pipeline, e-mail marketing, automação)** | "Já temos o lead, vamos converter" | Compete com RD Station, HubSpot; nicho perdido | Integração webhook/Zapier com CRM existente |
| **Planta 3D rica (DWG/IFC, walkthrough VR)** | "Wow factor" em demo | Risco técnico altíssimo para solo dev em 3 meses; já marcado OUT no PROJECT.md | 2D clicável agora; 3D em v2/v3 só se houver clientes pagando |
| **App nativo iOS/Android** | "Toda plataforma moderna tem app" | App stores, distribuição, dois codebases extras; PWA resolve 90% dos casos | PWA offline-first para check-in e portal do fornecedor |
| **Tudo em tempo real via WebSocket** | "Dashboard live, ocupação live" | Complexidade operacional para benefício marginal no contexto | Polling de 10-30s; SSE para ocupação ao vivo se necessário em v2 |
| **IA generativa (ChatGPT para descrição de evento, recomendação)** | Hype de 2024-2026 | Não move métricas de receita; distrai foco | Espera até validar PMF |
| **Programa de afiliados / influencers** | "Pode dar viral" | Não há produto consolidado; só vira lixo | v2 depois de PMF |
| **Cashless físico com pulseira NFC no v1** | "Festivais grandes têm" | Hardware-heavy, fora do escopo já documentado | Já marcado v2+ no PROJECT.md |
| **Internacionalização (i18n, multi-moeda) no v1** | "Pode vender para Portugal" | Já marcado OUT no PROJECT.md; espalha trabalho transversal pesado | Português BR puro até PMF |
| **Migração automática do Eventbrite no v1** | Cliente piloto poderia pedir | Já marcado OUT no PROJECT.md; risco de bugs em dados sensíveis | Operação paralela até cutover natural |
| **Marketplace público multi-organizadora no v1** | "Discovery de eventos" | Sem volume não funciona; canibaliza marca da organizadora | Cada organizadora tem seu site; descoberta cross em v2+ |
| **Customização sem código profunda (formulários, fluxos, regras)** | "Cada evento é diferente" | Vira no-code product, escopo enorme | Custom fields simples + JSON metadata no v1 |
| **Programa de fidelidade do público** | "Reten public" | Não é problema atual da organizadora | v2+ |

---

## Feature Dependencies

```
[Multi-tenant base (org, user, role, RBAC)]
    ├──requires──> [Auth/Identity (login, sessão, 2FA opcional)]
    └──requires──> [Postgres com tenant_id em todas as tabelas]

[Event setup]
    └──requires──> [Multi-tenant base]

[Floor plan editor (organizadora)]
    └──requires──> [Event setup]
    └──requires──> [Storage de assets (S3/MinIO)]

[Catálogo de lotes]
    └──requires──> [Floor plan editor]

[Vendor self-service (fornecedor)]
    ├──requires──> [Catálogo de lotes]
    ├──requires──> [Auth/Identity]
    ├──requires──> [Checkout PIX/Cartão (Pagar.me)]
    ├──requires──> [Contratos digitais + e-sign]
    └──requires──> [Notificações (e-mail mínimo; WhatsApp/SMS desejável)]

[Aprovação de fornecedor]
    └──requires──> [Cadastro de fornecedor + Workflow approval]

[Prestadores + comissão/split]
    ├──requires──> [Auth/Identity]
    ├──requires──> [Pagar.me Recipients/Split setup]
    └──requires──> [Cofre de documentos + dados bancários/PIX]

[Ticketing público]
    ├──requires──> [Event setup]
    ├──requires──> [Checkout PIX/Cartão]
    └──requires──> [QR code generator + check-in PWA]

[Beverage/F&B]
    └──requires──> [Catálogo de produtos] (independente; pode rodar depois)

[Integração Sympla/Eventbrite]
    ├──requires──> [Ticketing público funcional ou shim de sincronização]
    └──enhances──> [Ticketing público — não substitui]

[Dashboard financeiro consolidado]
    ├──requires──> [Receitas categorizadas em DB]
    └──enhances──> [Todas as fases]

[LGPD consent + audit log]
    └──requires──> [Auth/Identity]
    └──blocks──> [Lançamento de qualquer fase em produção sem isso]

[White-label / custom domain]
    └──enhances──> [Marketplace público + qualquer página voltada ao público]
    (não é bloqueante para v1 — v1 pode rodar em subdomínio compartilhado)
```

### Dependency Notes

- **Multi-tenant é bloqueante para TUDO.** PROJECT.md já decidiu: desde o dia 1. Custo marginal aceitável.
- **Floor plan editor é o gargalo de UI.** É a única feature da Fase 1 com risco técnico real (canvas/SVG + interação). Tudo o resto da Fase 1 é CRUD.
- **Checkout com split é pré-requisito para a Fase 3 (prestadores).** Pagar.me já tem o objeto `split.rules` no Subscription/Order. Mapear no v1 ajuda Fase 3 (não precisa retrabalhar gateway).
- **PWA offline para check-in só importa na Fase 4.** Não construir antes — fora do caminho crítico do piloto Trindade.
- **LGPD bloqueia produção.** Não é "depois". Banner de consentimento + audit log mínimo desde o primeiro deploy.
- **Integração Sympla/Eventbrite é defensiva, não ofensiva.** O objetivo é deixar a organizadora migrar gradualmente, não competir frontalmente — economia de esforço.

---

## MVP Definition

### Launch With (v1 — Fase 1 piloto Festa de Trindade, ≤3 meses)

Objetivo: **organizadora vende espaços por m² self-service para fornecedores em um evento real, em até 3 meses, com cobrança e contrato funcionando**.

- [ ] **Multi-tenant base** — auth, RBAC simples (owner/admin/atendente/viewer), tenant_id global
- [ ] **Cadastro de evento** — campos básicos (nome, datas, local, capacidade, timezone, moeda BRL, status)
- [ ] **Upload de planta** (PDF/PNG/JPG/SVG) com conversão para imagem renderizável
- [ ] **Editor 2D de lotes** — desenho de polígonos sobre a planta, metadata (código, m², categoria, preço, status)
- [ ] **Catálogo público de lotes do evento** — fornecedor vê quais estão disponíveis
- [ ] **Cadastro/aprovação de fornecedor** com validação de CNPJ + upload de comprovantes
- [ ] **Carrinho + checkout** com PIX e Cartão via Pagar.me (split-aware desde o início, mesmo que com regra zero)
- [ ] **Contrato digital** — template configurável + render PDF + e-sign integrado (1 provider: ZapSign ou Clicksign)
- [ ] **Portal do fornecedor (mínimo)** — ver compras, baixar contrato, baixar recibo, upload de documentos do evento
- [ ] **Dashboard de ocupação** da organizadora — mapa colorido + tabela
- [ ] **Dashboard financeiro mínimo** — receita prevista, recebida, a receber, fees da plataforma
- [ ] **Notificações por e-mail** — confirmação de compra, lembrete de pagamento, recibo, contrato assinado
- [ ] **LGPD baseline** — banner de consentimento versionado, audit log, política de exclusão sob demanda
- [ ] **Cofre de documentos** (S3/MinIO + URL assinada)
- [ ] **Backup automatizado do Postgres** com PITR

**Anti-MVP (não entra no v1):** ticketing público, vendas de bebida, prestadores, integração Sympla/Eventbrite, marketplace público, white-label completo, PWA offline, 3D, internacionalização.

### Add After Validation (v1.x — Fase 2 Fornecedor maduro + Fase 3 Prestador)

- [ ] **Add-ons no lote** (energia, água, lixo, mesas) — quando o piloto pedir
- [ ] **Lista de espera por lote** — quando faltar lote disponível e demanda continuar
- [ ] **WhatsApp para confirmações e cobranças** — alta alavancagem no mercado BR
- [ ] **Cadastro de prestador + atribuição de demandas + split de comissão** (Fase 3 inteira)
- [ ] **Cobrança recorrente da assinatura da organizadora** (Pagar.me Subscription)
- [ ] **Histórico do fornecedor** entre eventos
- [ ] **Reservas com TTL** (carrinho expira em 15-30 min)
- [ ] **Cancelamento e reembolso** com regras configuráveis
- [ ] **Importação de planta com auxílio (PDF→polígonos sugeridos)**

### Future Consideration (v2+ — Fase 4 Público e expansão)

- [ ] **Ticketing público completo** (categorias, lotes 1/2/3, meia-entrada, cupons)
- [ ] **Check-in PWA offline-first** (estádio sem internet)
- [ ] **Vendas de bebidas/F&B**
- [ ] **POS PWA no estande**
- [ ] **Integração Sympla / Eventbrite** (publicação + sincronização)
- [ ] **Marketplace público** com sites whitelabel e custom domain
- [ ] **Widget de checkout embedável**
- [ ] **NFSe/NFe** (já OUT no PROJECT.md — só voltar com regulatório resolvido)
- [ ] **Cashless / pulseira NFC**
- [ ] **i18n e multi-moeda**
- [ ] **3D rico CAD/BIM**
- [ ] **Migração automática do Eventbrite**
- [ ] **App nativo iOS/Android** (só se PWA provar insuficiente)

---

## Feature Prioritization Matrix

Categorizada por persona/fase. P1 = bloqueante para o piloto Trindade; P2 = entra na Fase 2/3; P3 = Fase 4 ou v2+.

| Feature | Persona | Fase | User Value | Implementation Cost | Priority |
|---------|---------|------|------------|---------------------|----------|
| Multi-tenant base + Auth + RBAC | Todos | 1 | HIGH | MEDIUM | **P1** |
| Cadastro de evento | Organizadora | 1 | HIGH | LOW | **P1** |
| Upload de planta + editor 2D de lotes | Organizadora | 1 | HIGH | MEDIUM-HIGH | **P1** |
| Catálogo de lotes (público para fornecedor) | Organizadora→Fornecedor | 1 | HIGH | LOW | **P1** |
| Cadastro/aprovação de fornecedor | Fornecedor | 1 | HIGH | MEDIUM | **P1** |
| Checkout PIX+Cartão (Pagar.me, split-aware) | Fornecedor | 1 | HIGH | MEDIUM | **P1** |
| Contrato digital + e-sign | Organizadora+Fornecedor | 1 | HIGH | MEDIUM | **P1** |
| Portal mínimo do fornecedor | Fornecedor | 1 | HIGH | MEDIUM | **P1** |
| Dashboard de ocupação | Organizadora | 1 | HIGH | LOW | **P1** |
| Dashboard financeiro mínimo | Organizadora | 1 | HIGH | MEDIUM | **P1** |
| LGPD baseline (consent + audit + delete) | Todos | 1 | HIGH (legal) | MEDIUM | **P1** |
| E-mail transacional | Todos | 1 | HIGH | LOW | **P1** |
| Cofre de documentos | Organizadora+Fornecedor | 1 | MEDIUM | LOW | **P1** |
| Backup + PITR | Ops | 1 | HIGH | MEDIUM | **P1** |
| Add-ons no lote | Fornecedor | 2 | MEDIUM | MEDIUM | **P2** |
| Lista de espera | Fornecedor | 2 | MEDIUM | MEDIUM | **P2** |
| WhatsApp transacional | Todos | 2 | HIGH | MEDIUM | **P2** |
| Cadastro de prestador | Prestador | 3 | HIGH | MEDIUM | **P2** |
| Atribuição de demandas | Prestador+Organizadora | 3 | HIGH | MEDIUM | **P2** |
| Split de comissão automático | Prestador | 3 | HIGH | MEDIUM | **P2** |
| Assinatura mensal da organizadora | Organizadora | 3 | HIGH (receita) | MEDIUM | **P2** |
| Reservas com TTL + cancelamento | Fornecedor | 2 | MEDIUM | MEDIUM | **P2** |
| Ticketing público completo | Público | 4 | HIGH | HIGH | **P3** |
| Check-in PWA offline | Público+Organizadora | 4 | HIGH | HIGH | **P3** |
| Cupons de desconto | Público | 4 | MEDIUM | MEDIUM | **P3** |
| Bebida/F&B online | Público | 4 | MEDIUM | MEDIUM | **P3** |
| POS PWA no estande | Operação | 4 | MEDIUM | MEDIUM | **P3** |
| Integração Sympla/Eventbrite | Organizadora | 4 | MEDIUM | HIGH | **P3** |
| Marketplace público + white-label | Organizadora | 4 | MEDIUM | MEDIUM-HIGH | **P3** |
| Widget de checkout embedável | Organizadora | 4 | LOW | MEDIUM | **P3** |
| Custom domain por organizadora | Organizadora | 4+ | MEDIUM | MEDIUM | **P3** |

---

## Competitor Feature Analysis

| Feature | Sympla / Doity (BR ticketing) | Eventbrite (global ticketing) | Even3 (BR científico/corp) | Cvent (global enterprise) | A2Z / Personify (global trade show) | Whova / EventMobi (event app) | **FB_EVENTOS** |
|---------|------------------------------|------------------------------|----------------------------|---------------------------|-------------------------------------|-------------------------------|----------------|
| Floor plan / venda de espaços por m² | Não | Não (apenas seating maps de teatro/estádio) | Não | Sim, robusto, enterprise | Sim, é o core deles | Não | **Sim, 2D self-service BR-first** |
| Cobrança self-service de fornecedor | Não | Não | Não | Parcial (geralmente consultivo) | Sim, mas processo enterprise | Não | **Sim, fluxo curto e simples** |
| Contrato digital + e-sign integrado | Não | Não | Não | Sim, via parceria | Sim | Não | **Sim, integrado (ZapSign/Clicksign)** |
| Mão de obra terceirizada com split | Não | Não | Não | Não nativamente | Não | Não | **Sim, via Pagar.me Recipients** |
| Ticketing público (categorias, cupons, check-in) | Sim, maduro | Sim, maduro (API rica) | Sim, focado em acadêmico | Sim | Sim, mas não é o foco | Parcial | Sim (Fase 4, integra ou compete) |
| PIX nativo | Sim | Sim (BR) | Sim | Não nativamente | Não | Não | **Sim, first-class** |
| Multi-moeda / i18n | Sim | Sim | Parcial | Sim | Sim | Sim | Não (v2+, BR-first é decisão) |
| White-label / custom domain | Limitado (marca Sympla forte) | Limitado | Sim, em planos altos | Sim | Sim | Sim | **Sim, planejado para v2 Fase 4** |
| App engagement no evento (networking, agenda) | Não | Parcial | Sim, no nicho científico | Sim | Sim | Sim, é o core deles | Não (anti-feature; foco é organizadora) |
| Preço para organizador BR de festa religiosa de 100k+ pessoas | Acessível (% por ingresso) | Acessível (% por ingresso) | Acessível | Inviável (USD enterprise) | Inviável (USD enterprise) | Inviável | **Acessível BR (% + assinatura modesta)** |
| Visão financeira consolidada multi-fonte (espaço + ingresso + mão de obra) | Não — só ingressos | Não — só ingressos | Não — só registros | Sim, complexo | Sim | Não | **Sim, é o pitch para a organizadora** |
| Idioma e suporte BR-first | Sim | Parcial | Sim | Não | Não | Não | **Sim** |

**Lição do mapa:** A coluna "FB_EVENTOS" só tem "Sim" em pontos onde **todas as outras têm "Não" ou "Inviável" para o contexto**. Esse é o wedge defensável. Tudo o que está em "Sim" em Sympla/Eventbrite e que FB_EVENTOS quer ter (ticketing) é defendido por integração, não por concorrência direta.

---

## Phase Mapping Summary (entregar por fase)

| Fase | Persona | Features-chave | Critério de sucesso |
|------|---------|----------------|---------------------|
| **Fase 1** (≤3 meses, piloto Trindade) | Organizadora | Multi-tenant base, event setup, floor plan editor, catálogo de lotes, cadastro/aprovação de fornecedor, checkout PIX+Cartão, contrato + e-sign, portal mínimo do fornecedor, dashboard de ocupação, dashboard financeiro mínimo, LGPD baseline, e-mail transacional, cofre de docs, backup | Organizadora vende ≥X lotes do evento real (Trindade) via FB_EVENTOS, sem voltar para Excel/WhatsApp |
| **Fase 2** | Fornecedor (maduro) | Add-ons no lote, lista de espera, reservas com TTL, cancelamento/reembolso, WhatsApp transacional, portal do fornecedor completo, importação assistida de planta | Fornecedores compram sozinhos no self-service em ≥80% dos casos, sem suporte humano |
| **Fase 3** | Prestador | Cadastro de prestador, catálogo de demandas, candidatura/atribuição, split automático de comissão, assinatura mensal da organizadora cobrada via Pagar.me, relatórios de comissão | Plataforma fatura via 4 vetores: % espaços, % mão de obra, assinatura, taxa fixa de setup |
| **Fase 4** | Público | Ticketing público completo, check-in PWA offline, cupons, bebida/F&B online, POS PWA, integração Sympla/Eventbrite, marketplace público, white-label + custom domain, widget embedável | Organizadora pode rodar 100% no FB_EVENTOS sem Eventbrite (ou continuar híbrido por escolha) |
| **v2+** | Todos | NFSe/NFe, cashless/NFC, i18n, 3D rico, migração automática Eventbrite, app nativo (se necessário) | Expansão pós-PMF |

---

## Confidence Assessment

| Área | Confidence | Reason |
|------|------------|--------|
| Eventbrite (ticketing, check-in, embed) | HIGH | Docs API completos via Context7 (144 snippets, benchmark 65) |
| Cvent (exhibitor, RFP, attendee, sponsorship) | HIGH | Developer Portal via Context7 (901 snippets, benchmark 95) |
| Pagar.me (split, marketplace, PIX, assinatura) | HIGH | Reference via Context7 (2119 snippets, benchmark 50.2) |
| Mercado Pago | MEDIUM | Docs via Context7 disponíveis (3825 snippets) — não consultados em profundidade nesta rodada; STACK.md vai decidir Pagar.me vs MP |
| Sympla / Doity / Even3 (BR) | MEDIUM | Conhecimento de mercado público (sem busca web nesta sessão); recomenda-se validação por entrevista com a organizadora |
| Whova / EventMobi / Bizzabo (engagement apps) | MEDIUM | Conhecimento público; já marcados como anti-feature para FB_EVENTOS — baixo risco de erro |
| A2Z / Personify (trade show enterprise) | MEDIUM | Conhecimento público; serve como referência distante (caro/enterprise demais para competir) |
| LGPD requirements | MEDIUM | Conhecimento público da Lei 13.709/2018; Surf Data via Context7 confirma PII masking como padrão; **recomendar consulta jurídica** antes de produção |
| Feature mapping para fases | HIGH | Direto do PROJECT.md (vertical MVP por persona já definido pelo cliente) |

---

## Open Questions (validar com a organizadora antes de congelar requisitos)

1. **Add-ons no lote são P1 ou P2?** Energia/água/lixo são padrão em festas de massa BR — pode ser que sem eles o piloto não fecha.
2. **E-sign — qual provider?** ZapSign (mais barato, BR-first) vs Clicksign (mais consolidado) vs D4Sign — depende de tolerância de preço da organizadora.
3. **Pagar.me vs Mercado Pago** — STACK.md decide; ambos suportam split e PIX. Pagar.me tem doc mais técnico; MP tem mais penetração com pequenos vendedores.
4. **Custom domain por organizadora é P1 da Fase 4 ou OK em subdomínio compartilhado?** Custom domain ajuda branding mas adiciona ops (wildcard SSL, DNS, Traefik).
5. **WhatsApp — Meta Cloud API direta ou intermediário (Zenvia, Z-API)?** Direta é mais barata mas exige aprovação de templates e BSP; intermediários cobram mais mas resolvem burocracia.
6. **Política de comissão da plataforma** — % fixo por categoria de receita (espaço x ingresso x mão de obra), ou negociado por organizadora? Afeta modelagem de billing.
7. **Política de retenção LGPD** — quantos meses de retenção de dados após o evento? Padrão de mercado é 5 anos para fiscal, mas depende de tipo de dado.

---

## Sources

- **Eventbrite Platform API** — Context7 `/websites/eventbrite_platform` (HIGH, 144 snippets, benchmark 65): confirmou shape de event, ticket_class, attendee, barcode/check-in, embedded checkout, discounts/promo codes, organization-level resources
- **Cvent Developer Portal** — Context7 `/websites/developers_cvent` (HIGH, 901 snippets, benchmark 95): confirmou modelo de exhibitor (atributos, virtual booth, leads), product fees, table assignment/seating, RFP/event spaces, activity tracking
- **Pagar.me API Reference** — Context7 `/websites/pagar_me_reference` (HIGH, 2119 snippets, benchmark 50.2): confirmou suporte nativo a PIX, cartão, split (`split.enabled`, `rules[]`), assinatura (Subscription object), recipients para split de mão de obra
- **Mercado Pago Developers BR** — Context7 `/websites/mercadopago_br_developers_pt` (MEDIUM, 3825 snippets): identificado como alternativa, não aprofundado nesta rodada
- **PROJECT.md** — `/home/claudio/projetos/FB_EVENTOS/.planning/PROJECT.md`: fonte primária de constraints, OUT-of-scope, e definição de vertical MVP por persona
- **Conhecimento de mercado (MEDIUM)** — Sympla, Doity, Even3, Whova, EventMobi, Bizzabo, A2Z/Personify: análise comparativa baseada em conhecimento público pré-cutoff; recomenda-se uma rodada de validação por entrevista com a organizadora piloto e consulta a posts/blog dos produtos antes de congelar requisitos sensíveis

---
*Feature research for: Multi-tenant SaaS de gestão de grandes eventos (festas religiosas/culturais BR como vertical inicial)*
*Researched: 2026-06-11*
