# FB_EVENTOS — Manual de Operações

> **Audiência:** equipe da organizadora (Fabricia / GoTo / GRU) e fornecedores piloto.
> **Versão da plataforma:** Piloto pré-Pagar.me (junho 2026).
> **URL produção:** https://eventos.fbtax.cloud

Este manual cobre o ciclo completo: do cadastro da organização ao primeiro lote vendido. Cada seção tem o caminho pela UI + atalhos de SQL para resolução rápida de incidentes.

---

## Sumário

1. [Visão geral do sistema](#1-visão-geral-do-sistema)
2. [Pré-requisitos e credenciais](#2-pré-requisitos-e-credenciais)
3. [Como a organizadora opera (Fabricia)](#3-como-a-organizadora-opera-fabricia)
   - 3.1 [Login](#31-login)
   - 3.2 [Acessar uma organização](#32-acessar-uma-organização)
   - 3.3 [Cadastrar uma nova organização](#33-cadastrar-uma-nova-organização-super-admin)
   - 3.4 [Cadastrar usuários administradores](#34-cadastrar-usuários-administradores-super-admin)
   - 3.5 [Criar um evento](#35-criar-um-evento)
   - 3.6 [Upload da planta](#36-upload-da-planta)
   - 3.7 [Cadastrar categorias de lote](#37-cadastrar-categorias-de-lote)
   - 3.8 [Desenhar lotes no editor](#38-desenhar-lotes-no-editor)
   - 3.9 [Publicar no marketplace](#39-publicar-no-marketplace)
   - 3.10 [Aprovar fornecedores](#310-aprovar-fornecedores)
   - 3.11 [Acompanhar vendas](#311-acompanhar-vendas)
4. [Como o fornecedor opera](#4-como-o-fornecedor-opera)
   - 4.1 [Cadastro público](#41-cadastro-público)
   - 4.2 [Verificação de email](#42-verificação-de-email)
   - 4.3 [Reservar um lote](#43-reservar-um-lote)
   - 4.4 [Pagar (checkout)](#44-pagar-checkout)
5. [Simuladores (piloto sem Pagar.me/ZapSign reais)](#5-simuladores-piloto-sem-pagarmezapsign-reais)
6. [Operações administrativas via SQL](#6-operações-administrativas-via-sql)
7. [Troubleshooting](#7-troubleshooting)
8. [Glossário](#8-glossário)

---

## 1. Visão geral do sistema

FB_EVENTOS é uma plataforma SaaS multi-tenant para gestão de grandes eventos. Cada **organizadora** (paróquia, prefeitura, empresa) tem um espaço isolado onde:

1. Cadastra **eventos** (festa, congresso, feira).
2. Sobe a **planta** do espaço físico.
3. Define **categorias de lote** (VIP, Comum, Backstage) com preços.
4. Desenha os **lotes** sobre a planta (polígonos clicáveis).
5. **Publica** no marketplace público.
6. Recebe **fornecedores** que reservam e pagam pelos lotes.

O sistema tem 3 níveis de acesso:

| Papel | Pode |
|---|---|
| **Super admin** (Claudio, Fabricia) | Tudo: criar organizações, criar usuários, atuar como qualquer organizadora |
| **Owner / Admin de organização** | Gerenciar tudo dentro de uma organização específica |
| **Fornecedor (vendor)** | Ver marketplace, reservar lotes, pagar |

---

## 2. Pré-requisitos e credenciais

Antes de começar:

- **URL:** https://eventos.fbtax.cloud
- **Email do super admin principal:** `claudiosousadebezerra@gmail.com`
- **Email da super admin parceira:** `fabricia@fcbcompany.com` (GoTo/GRU)
- Acesso ao servidor SSH (Hostinger 76.13.171.196) — só para operações administrativas via SQL

> ⚠ Em produção real, **NÃO** compartilhe senhas por canais inseguros. O sistema enviará e-mails de redefinição quando o SMTP estiver configurado (pendente).

---

## 3. Como a organizadora opera (Fabricia)

### 3.1 Login

1. Acesse https://eventos.fbtax.cloud
2. Tela de login com painel decorativo da GRU à esquerda + formulário à direita
3. Email + senha → **Entrar**

**O que acontece em seguida:**

- **Super admin** → cai em `/admin` (painel administrativo global)
- **Membro de 1 organização** → cai direto em `/{slug}/dashboard` da org
- **Membro de várias organizações** → tela `/select-org` para escolher
- **Sem organização vinculada** → tela "Sem acesso ainda" pedindo para o admin liberar

### 3.2 Acessar uma organização

Como super admin (Fabricia), você vê o painel `/admin`. Para **operar uma organizadora específica** (ex: criar eventos para a Paróquia da Trindade):

1. Sidebar admin → **Organizadoras**
2. Lista mostra todas as organizadoras cadastradas
3. Clique no nome da organizadora
4. No topo da tela aparece um card verde com botão **"Acessar como organizadora"**
5. Clique → você é levada para `/{slug}/dashboard` da org como se fosse uma operadora interna

> O super admin pode entrar em **qualquer** organização, mesmo sem membership formal. Isso é o caminho "atuar como" para suporte.

Voltar ao admin: na sidebar (que muda para o tema escuro da org), clicar em "Acessar uma organizadora" volta para `/select-org`.

### 3.3 Cadastrar uma nova organização (super admin)

Quando uma nova cliente fechar contrato:

1. Sidebar admin → **Organizadoras**
2. Botão **"Nova organizadora"**
3. Preencha:
   - **Nome:** "Paróquia Nossa Senhora da Guia"
   - **Slug:** `paroquia-guia` (minúsculas, hífens, 3-30 caracteres — vai virar parte da URL)
   - **Admin da organizadora:** nome + email + senha inicial (≥12 caracteres)
4. **Criar organizadora**

O wizard cria atomicamente:
- A organização (tabela `tenants` + `organization`)
- O usuário admin (com email já verificado)
- O vínculo de membership (role: `owner`)
- O bucket MinIO de uploads (`{slug}-uploads`)

Passe a senha inicial ao novo admin por canal externo (WhatsApp / telefone). Ele entra e pode trocar.

### 3.4 Cadastrar usuários administradores (super admin)

Para adicionar mais admins ou outros super admins:

1. Sidebar admin → **Usuários**
2. **Novo usuário**
3. Preencha nome / email / senha inicial
4. Marque ✅ **Super administrador** se quiser conceder acesso ao painel admin global
5. **Criar usuário**
6. Na lista, clique no novo usuário → seção **Vínculos com organizações** → escolha a org + papel (`owner` / `admin` / `member`) → **Vincular**

> Tem **botão "Redefinir senha (admin)"** no detail do usuário caso ele perca o acesso e o SMTP esteja off. A nova senha sai por canal externo.

### 3.5 Criar um evento

Dentro de uma organizadora (cabeçalho mostra o nome dela):

1. Sidebar org → **Eventos** OU dashboard → card **"Criar evento"**
2. Preencha:
   - **Nome:** "Festa de Trindade 2026"
   - **Início / Término:** datas + horários (datepicker do browser; clique na área cinza, digite ou use o calendário 📅)
   - **Local:** "Santuário da Trindade"
   - **Endereço:** "Av. Padre Pelágio, s/n — Trindade/GO"
   - **Capacidade:** ex `900000` (pessoas estimadas)
   - **Timezone:** America/Sao_Paulo (default)
3. **Criar evento**

Você cai no detalhe do evento. O evento começa em **status: rascunho** (não aparece no marketplace ainda).

### 3.6 Upload da planta

No detalhe do evento, role até o card **"Planta do evento"**:

1. Botão **"Enviar planta"**
2. Selecione arquivo: PDF, PNG ou JPG (até 200 MB)
3. Aguarde o upload (vai direto para MinIO, sem passar pelo servidor)
4. A miniatura aparece. PDF é renderizado como imagem da primeira página automaticamente.

> Plantas grandes (200 MB) podem demorar 1-2 minutos. Não feche a aba.

### 3.7 Cadastrar categorias de lote

Antes de desenhar lotes, defina as categorias de preço:

1. No detalhe do evento → **Categorias** (na sidebar ou no menu de ações)
2. **Nova categoria**
3. Preencha:
   - **Nome:** "Área VIP"
   - **Cor:** clique no seletor (ex: vermelho)
   - **Preço base fixo:** `500.00` (em reais, com 2 casas decimais)
   - **Preço por m²:** `0.0000` (deixe zero se cobra só por lote)
4. Salve

Repita para outras categorias (Comum, Backstage). Pelo menos 1 categoria é obrigatória antes de desenhar lotes.

> ⚠ Cadastre o preço **em reais** (ex: `500.00`), não em centavos. O sistema converte para centavos internamente.

### 3.8 Desenhar lotes no editor

1. No detalhe do evento → **Abrir editor da planta**
2. A planta aparece como fundo do canvas (área cinza grande)
3. Barra de ferramentas no topo:
   - **Selecionar:** modo padrão, clica em lote existente para editar
   - **Novo polígono:** entra em modo desenho
   - **Excluir:** remove o lote selecionado
   - **Categoria:** dropdown — escolha a categoria do lote que vai desenhar (cor segue a categoria)
4. Para desenhar:
   1. Escolha a **Categoria** no dropdown
   2. Clique em **"Novo polígono"** (botão fica verde escuro)
   3. **Clique** no canvas para adicionar cada vértice (cada clique = 1 ponto)
   4. Mínimo de 3 cliques para formar um triângulo
   5. **Duplo-clique** para fechar o polígono e salvar
   6. O lote aparece com a cor da categoria
5. Repita para todos os lotes

> Use linhas retas e formas simples. O editor não suporta curvas — só polígonos.

### 3.9 Publicar no marketplace

Enquanto o evento está em **rascunho**, fornecedores **não** veem ele no marketplace. Para liberar:

1. Volte ao detalhe do evento
2. No topo aparece um banner âmbar **"Evento em rascunho"** com botão **"Publicar no marketplace"**
3. Clique → banner vira verde: **"Evento publicado — visível no marketplace para fornecedores"**

Pronto. O evento agora aparece em `/{slug}/marketplace` para qualquer fornecedor cadastrado.

### 3.10 Aprovar fornecedores

Quando um fornecedor se cadastra via link público (próxima seção), ele entra como **status: pendente** e **não pode reservar lotes**:

1. Sidebar org → **Fornecedores**
2. Lista mostra todos com badge **"Pendente"** ou **"Aprovado"**
3. Clique num fornecedor pendente
4. Botão **"Aprovar"** → status vira `approved` → ele pode reservar

> Você pode rejeitar um cadastro também (botão "Rejeitar"), com motivo opcional.

### 3.11 Acompanhar vendas

- Dashboard da org → KPIs no topo (Eventos cadastrados, Fornecedores aprovados, Lotes vendidos)
- Evento → **Dashboard de ocupação**: planta colorida por status do lote (verde = disponível, cinza = reservado, vermelho = vendido)
- **Cobranças** → lista de pagamentos com status (pendente / pago / falho)
- **Contratos** → lista de contratos digitais

---

## 4. Como o fornecedor opera

### 4.1 Cadastro público

A organizadora envia ao fornecedor o link:

```
https://eventos.fbtax.cloud/{slug}/fornecedor/cadastro
```

Exemplo: `https://eventos.fbtax.cloud/paroquia-guia/fornecedor/cadastro`

O fornecedor abre o link (sem precisar estar logado) e preenche:
- Razão Social
- Nome Fantasia (opcional)
- CNPJ (validado contra a Receita Federal via BrasilAPI quando disponível)
- Email do responsável
- Senha (mínimo 10 caracteres)
- Nome do responsável
- Telefone (opcional)
- Endereço (opcional)
- Consentimentos LGPD obrigatórios

Ao submeter:
- Cria usuário com a senha (Better Auth)
- Cria o vendor no tenant da organizadora (status: `pending`)
- Cria o vínculo de membership
- Registra os consentimentos LGPD (auditáveis)
- Redireciona para `/{slug}/marketplace`

### 4.2 Verificação de email

Em produção real (com SMTP configurado), o fornecedor recebe um email com link de confirmação. Sem SMTP (estado piloto atual):

- Marque manualmente como verificado: a Fabricia entra em **Admin → Usuários → \[o vendor\]**, ou roda SQL:

```sql
UPDATE "user" SET email_verified = true WHERE email = '<email-do-vendor>';
```

> Sem `email_verified = true`, o fornecedor não consegue logar (Better Auth bloqueia).

### 4.3 Reservar um lote

Logado como fornecedor:

1. `/{slug}/marketplace` → lista de eventos abertos
2. Clique no evento desejado
3. Clique em **"Ver planta"** (ou no botão equivalente)
4. A planta carrega com os lotes coloridos:
   - **Verde:** disponível
   - **Cinza:** reservado por outro
   - **Vermelho:** vendido
5. Clique em um lote **verde**
6. Sidebar direita mostra:
   - ID do lote
   - Categoria
   - Preço (em reais)
   - Botão **"Confirmar reserva e ir para o checkout"**
7. Clique → cria reserva (válida por 15 min) → redireciona para `/{slug}/checkout/{reservation-id}`

> A reserva tem TTL de 15 minutos. Se o fornecedor não fechar o checkout nesse prazo, o lote volta a ficar disponível.

### 4.4 Pagar (checkout)

Na tela do checkout, o fornecedor vê:
- Resumo do carrinho: lote selecionado + preço
- Forma de pagamento: **PIX** ou **Cartão de crédito**
- (Opcional) Add-ons do evento (energia, água, etc) — se a organizadora cadastrou
- Botão **"Pagar agora"**

**Fluxo real (Pagar.me ativo):**
- PIX: gera QR Code + copia-cola para o fornecedor pagar
- Cartão: tokeniza no Pagar.me, processa
- Webhook recebe `payment.paid` → outbox.drain processa → marca lote como vendido + envia email de confirmação

**Fluxo simulado (piloto, sem chaves Pagar.me):**
- Banner vermelho **"Modo simulação"** aparece com 2 botões: "Simular aprovado" / "Simular recusado"
- A operadora ou o próprio fornecedor clica para testar o fluxo
- Em ~60 segundos o outbox processa e o lote vira vendido

---

## 5. Simuladores (piloto sem Pagar.me/ZapSign reais)

Enquanto a Fabricia/GRU não emitir credenciais reais de Pagar.me e ZapSign, o sistema opera em **modo simulação** controlado por variáveis de ambiente no Coolify:

| Variável | Valor | Efeito |
|---|---|---|
| `PAYMENT_SIMULATOR_ENABLED` | `true` | Substitui chamadas à API Pagar.me por respostas falsas com IDs `SIM_<uuid>`. No checkout aparece banner vermelho com botões "Simular aprovado / recusado". |
| `ZAPSIGN_SIMULATOR_ENABLED` | `true` | Simula envio de contrato. Hoje o checkout cria um contrato auto-assinado (não dispara ZapSign), então essa flag tem efeito menor no fluxo principal. |

**Para desligar quando as credenciais reais chegarem:**

1. Coolify UI → Application FB_EVENTOS → Environment Variables:
   - Adicione `PAGARME_SECRET_KEY = <chave-real>`
   - Adicione `ZAPSIGN_TOKEN = <token-real>`
   - Mude `PAYMENT_SIMULATOR_ENABLED = false` (ou remova)
   - Mude `ZAPSIGN_SIMULATOR_ENABLED = false` (ou remova)
2. Clique **Restart** no app

O código volta a chamar as APIs reais automaticamente. Sem mudança de versão.

---

## 6. Operações administrativas via SQL

Acesso ao servidor:

```bash
ssh root@76.13.171.196
PG=$(docker ps --filter "name=postgres-q8o0k84c8o4k8kc00woksgw8" --format "{{.Names}}" | head -1)
```

### Marcar email do user como verificado

```bash
docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "SET row_security = off; UPDATE \"user\" SET email_verified = true WHERE email = '<email>';"
```

### Aprovar fornecedor sem usar a UI

```bash
docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "SET row_security = off; UPDATE vendors SET status='approved' WHERE email = '<email>';"
```

### Tornar usuário super admin

```bash
docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "UPDATE \"user\" SET is_super_admin = true WHERE email = '<email>';"
```

### Listar últimos eventos cadastrados

```bash
docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "SET row_security = off; SELECT e.id, e.name, e.status, t.slug AS org FROM events e JOIN tenants t ON t.id = e.tenant_id ORDER BY e.created_at DESC LIMIT 10;"
```

### Ver outbox events não processados (debug de drain)

```bash
docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "SET row_security = off; SELECT event_type, aggregate_id, processed_at, processing_status, attempt_count FROM outbox_events ORDER BY created_at DESC LIMIT 10;"
```

### Limpar reservas + pagamentos de um fornecedor (para refazer smoke test)

```bash
VENDOR_ID=$(docker exec "$PG" psql -U postgres -d fb_eventos_dev -tAc "SET row_security = off; SELECT id FROM vendors WHERE email = '<email>' LIMIT 1;")

docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "
SET row_security = off;
DELETE FROM pagarme_orders WHERE payment_id IN (SELECT p.id FROM payments p JOIN contracts c ON c.id = p.contract_id WHERE c.vendor_id = '$VENDOR_ID');
DELETE FROM payments WHERE contract_id IN (SELECT id FROM contracts WHERE vendor_id = '$VENDOR_ID');
DELETE FROM contracts WHERE vendor_id = '$VENDOR_ID';
DELETE FROM lot_reservations WHERE vendor_id = '$VENDOR_ID';"
```

---

## 7. Troubleshooting

### Fornecedor não consegue logar

Causa mais comum: `email_verified = false`. Atalho: ver seção 6 ("Marcar email do user como verificado").

Causa secundária: senha errada. Solução: super admin entra em `/admin/usuarios/<id>` e usa o painel âmbar **"Redefinir senha (admin)"** para definir nova senha.

### Lote ficou em "reservado" mesmo após pagamento aprovado

O outbox.drain deveria processar em ~60 segundos. Se não processou:

1. Verifique se o worker está rodando: `docker ps | grep worker`
2. Veja se há eventos pendentes: comando da seção 6 ("Ver outbox events")
3. Logs do worker: `docker logs --since 5m $(docker ps --filter "name=worker-" --format "{{.Names}}" | head -1) | grep outbox`
4. Atalho de emergência: marcar lote como vendido direto via SQL:
   ```bash
   docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "SET row_security = off; UPDATE lots SET status='sold' WHERE id='<lot-id>';"
   ```

### Preço aparece dividido por 100 ou multiplicado por 100

Confirme que o **preço base fixo** da categoria foi cadastrado em **reais** (ex: `500.00`), não em centavos. Se ficou errado, edite a categoria ou rode SQL:

```bash
docker exec "$PG" psql -U postgres -d fb_eventos_dev -c "SET row_security = off; UPDATE lot_categories SET base_fixed = 500.00 WHERE name = 'Área VIP';"
```

### Bucket MinIO não existe (upload de planta falha)

Quando criar uma nova organizadora via wizard, o bucket é criado automaticamente. Se algum passou batido:

```bash
MINIO=$(docker ps --filter "name=minio-q8o0k84c8o4k8kc00woksgw8" --format "{{.Names}}" | head -1)
docker exec "$MINIO" sh -c "mc alias set local http://localhost:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD && mc mb -p local/{slug}-uploads"
```

Substitua `{slug}-uploads` pelo slug correto.

### Página dá 403

- **`/{slug}/dashboard`**: o usuário não tem membership nessa org, OU a `active_organization_id` da sessão não bate com o tenant. Super admin: tente acessar via `/admin/organizadoras/<id>` → botão "Acessar como organizadora" (auto-flipa a sessão).
- **Outras páginas**: verifique session expirada (logout + login).

### Email não chega (SMTP)

O SMTP está desativado neste piloto (`SMTP_USER` / `SMTP_PASS` vazios). Resultado: emails de verificação, redefinição, confirmação de pagamento, etc, não saem. Use os atalhos SQL da seção 6 para destravar usuários. **Configure SMTP no Coolify** quando tiver credenciais.

---

## 8. Glossário

| Termo | Significado |
|---|---|
| **Tenant** | Espaço isolado de uma organizadora no banco. Cada tenant tem seus próprios usuários, eventos, lotes, etc. |
| **Slug** | Identificador legível para URL (ex: `paroquia-guia` em `eventos.fbtax.cloud/paroquia-guia/...`). |
| **Lote** | Espaço físico individual que o fornecedor compra (ex: stand de feira, área VIP). Desenhado como polígono sobre a planta. |
| **Categoria** | Faixa de preço dos lotes (ex: VIP, Comum, Backstage). |
| **Reserva** | Hold de 15 min sobre um lote enquanto o fornecedor faz o checkout. Após o TTL ou pagamento falho, o lote volta para `available`. |
| **Outbox** | Tabela `outbox_events` que recebe eventos de negócio (lot.reserved, payment.paid, etc). O worker drena a cada 60s e dispara handlers. |
| **Super admin** | Usuário com flag `is_super_admin = true`. Acessa `/admin` global e pode atuar como qualquer organizadora. |
| **RLS** | Row-Level Security do Postgres. Garante que uma organizadora não enxergue dados da outra mesmo com bug de query. |
| **Simulador** | Modo "fake" do Pagar.me e ZapSign para testar o fluxo sem credenciais reais. Controlado por env vars no Coolify. |

---

> **Última atualização:** 2026-06-17 — piloto inicial pré-Pagar.me.
> **Próximos passos da plataforma:** SMTP real, credenciais Pagar.me/ZapSign, planta-buyer portal completo (Plan 02-08), refunds (Plan 02-07).
