# Deploy v0.1.0 demo — passo a passo

**Objetivo:** subir a versão `v0.1.0` no Coolify para apresentação, com domínio `eventos.fbtax.cloud`.

**Pré-requisitos atendidos:**
- Repo GitHub publicado em `https://github.com/ClaudioSBezerra/FB_EVENTOS`
- Tag `v0.1.0` pushada → workflow `build-and-push.yml` está rodando
- Ambiente Coolify criado pelo operador

**Pré-requisitos restantes (suas tarefas):**
1. Verificar build & push do GHCR completou
2. Apontar DNS `eventos.fbtax.cloud` → IP do Coolify (Hostinger)
3. Subir os 3 serviços no Coolify nesta ordem: Postgres → MinIO → Web/Worker

Este doc é um "quick-start" focado nesta versão. Para detalhes profundos sobre roles, extensões, backups, healthchecks, ver [`docs/deploy/COOLIFY.md`](COOLIFY.md) e os manifests em [`docker/coolify/`](../../docker/coolify/).

---

## 1. Verificar o build da imagem

```bash
gh run list --workflow=build-and-push.yml --limit 3
gh run watch <RUN_ID>
```

**Resultado esperado:** duas imagens publicadas em GHCR:
- `ghcr.io/claudiosbezerra/fb_eventos-web:0.1.0`
- `ghcr.io/claudiosbezerra/fb_eventos-worker:0.1.0`

(GHCR normaliza nomes para lowercase — `ClaudioSBezerra/FB_EVENTOS` vira `claudiosbezerra/fb_eventos`.)

Verificar visualmente:
- https://github.com/users/ClaudioSBezerra/packages?repo_name=FB_EVENTOS

Se os packages estão privados (default GHCR), torne públicos OU configure o Coolify com PAT `read:packages`.

## 2. DNS Hostinger

No painel Hostinger:
- Tipo `A`: `eventos.fbtax.cloud` → `<IP_COOLIFY>`
- Tipo `A`: `minio.eventos.fbtax.cloud` → `<IP_COOLIFY>` (mesmo IP)

TTL 300s (5min) durante a fase de testes; aumentar depois.

## 3. Provisionar Postgres 16

Coolify dashboard → "Resources" → "Add Resource" → "Database" → "Postgres 16".

Anote do Coolify:
- Internal hostname (algo como `fb-eventos-postgres-internal`)
- Superuser password (gerada pelo Coolify)

**Bootstrap das roles** (execute UMA vez no terminal do container Postgres no Coolify, ou via psql via túnel):

```bash
PG_BOOTSTRAP_URL='postgresql://postgres:<superuser_password>@<host_interno>:5432/postgres' \
  bash scripts/db/setup-roles.sh
```

Isso cria: database `fb_eventos_dev` (note: o script usa o nome `_dev` mesmo em produção — não bloqueante para a demo), roles `fb_eventos_app` (NOBYPASSRLS), `fb_eventos_migrator` (DDL), `fb_eventos_sysreader` (BYPASSRLS para SECURITY DEFINER), e logins `fb_app_user` / `fb_migrator`.

> Para uma demo "limpa", se preferir database `fb_eventos` (sem `_dev`), edite o script antes — ou roda o setup, depois `CREATE DATABASE fb_eventos WITH TEMPLATE fb_eventos_dev` no psql.

**Habilitar extensões** (no database `fb_eventos_dev`):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

## 4. Provisionar MinIO

Seguir [`docker/coolify/minio.service.md`](../../docker/coolify/minio.service.md) — Coolify "Add Resource" → "Service" → imagem `minio/minio:RELEASE.2025-01-20T14-49-07Z`.

Env vars do MinIO:
```
MINIO_ROOT_USER=<gerar com openssl rand -hex 16>
MINIO_ROOT_PASSWORD=<gerar com openssl rand -hex 32>
MINIO_BROWSER_REDIRECT_URL=https://minio.eventos.fbtax.cloud
```

Configurar Traefik labels para o subdomínio (do `traefik-labels.md` adaptado para minio):
- `Host(\`minio.eventos.fbtax.cloud\`)` → porta `9001` (console)
- `Host(\`minio.eventos.fbtax.cloud\`) && PathPrefix(\`/api\`)` → porta `9000` (S3 API)

**Criar bucket `fb-eventos`** após o MinIO subir, via console (`minio.eventos.fbtax.cloud`) ou `mc alias set ... && mc mb local/fb-eventos`.

## 5. Configurar serviço `fb-eventos-web` no Coolify

Coolify → "Add Resource" → "Application" → "Docker Image":

**Image:** `ghcr.io/claudiosbezerra/fb_eventos-web:0.1.0`
**Port:** `3000`
**Domínio:** `eventos.fbtax.cloud` (com TLS via Let's Encrypt — Coolify gerencia automaticamente)

**Environment variables** (preencha CHANGE_ME com valores reais):

```env
# DB — apontar para o Postgres provisionado em §3
DATABASE_URL=postgresql://fb_app_user:fb_app_dev_pw@<pg_host>:5432/fb_eventos_dev

# Auth — gere o secret com: openssl rand -hex 32
BETTER_AUTH_SECRET=CHANGE_ME_32_BYTES_HEX
BETTER_AUTH_URL=https://eventos.fbtax.cloud
NEXT_PUBLIC_APP_URL=https://eventos.fbtax.cloud

# SMTP (transactional email — para verificação de email + reset)
# Hostinger oferece SMTP nativo — usar credenciais de uma caixa @fbtax.cloud
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=no-reply@fbtax.cloud
SMTP_PASS=CHANGE_ME
SMTP_SECURE=false
SMTP_FROM="FB_EVENTOS <no-reply@eventos.fbtax.cloud>"

# MinIO — apontar para o MinIO provisionado em §4
MINIO_ENDPOINT=fb-eventos-minio          # hostname interno do Coolify
MINIO_PORT=9000
MINIO_ACCESS_KEY=<MINIO_ROOT_USER ou access key dedicada>
MINIO_SECRET_KEY=<MINIO_ROOT_PASSWORD ou secret key dedicada>
MINIO_USE_SSL=false
MINIO_DEFAULT_BUCKET=fb-eventos
MINIO_PUBLIC_ENDPOINT=https://minio.eventos.fbtax.cloud
MINIO_ROOT_USER=<mesmo de §4>
MINIO_ROOT_PASSWORD=<mesmo de §4>
MINIO_BROWSER_REDIRECT_URL=https://minio.eventos.fbtax.cloud

# Pagar.me — SANDBOX para demo (criar conta sandbox em pagar.me se ainda não)
PAGARME_SECRET_KEY=sk_test_CHANGE_ME
PAGARME_ENV=sandbox
PAGARME_WEBHOOK_USER=CHANGE_ME
PAGARME_WEBHOOK_PASS=CHANGE_ME
PAGARME_WEBHOOK_SIGNING_SECRET=CHANGE_ME

# Observability (opcional para demo — pode deixar vazio)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
LOG_LEVEL=info

# Runtime
NODE_ENV=production
TZ=America/Sao_Paulo
NEXT_TELEMETRY_DISABLED=1
```

**Pre-Deploy Hook (CRITICAL — rodar migrations antes do container subir):**

Coolify → service `fb-eventos-web` → "Pre-Deploy Command":

```bash
node dist/scripts/migrate.js
```

**Env vars APENAS para o pre-deploy** (se Coolify permitir; senão coloque no env geral mas o runtime ignora):

```env
DATABASE_MIGRATOR_URL=postgresql://fb_migrator:fb_migrator_dev_pw@<pg_host>:5432/fb_eventos_dev
```

**Healthcheck:**
- Path: `/api/health`
- Interval: 30s, Timeout: 3s, Retries: 3, Start period: 10s

**Traefik labels:** seguir [`docker/coolify/traefik-labels.md`](../../docker/coolify/traefik-labels.md) substituindo `{{PRODUCTION_HOST}}` por `eventos.fbtax.cloud`.

## 6. Configurar serviço `fb-eventos-worker` no Coolify

Mesma stack do web service, mas:

**Image:** `ghcr.io/claudiosbezerra/fb_eventos-worker:0.1.0`
**Port:** nenhum (worker não escuta — só consome filas do Postgres via Graphile-Worker)
**Env vars:** as mesmas do `fb-eventos-web`
**Sem pre-deploy hook** (web faz as migrations; worker só conecta no DB pronto)
**Sem healthcheck HTTP** (Coolify monitora exit code apenas)

Detalhes: [`docker/coolify/worker.service.md`](../../docker/coolify/worker.service.md).

## 7. Smoke test após o deploy

Quando ambos web + worker estiverem "Healthy" no Coolify:

```bash
# Healthcheck
curl https://eventos.fbtax.cloud/api/health
# Esperado: 200 { "status": "ok", "checks": { "db": true } }

# Página inicial (deve servir o Next.js)
curl -I https://eventos.fbtax.cloud/
# Esperado: HTTP/2 200 + content-type: text/html
```

**Caminho feliz manual:**
1. Acessar `https://eventos.fbtax.cloud/`
2. Criar conta como organizadora (signup → confirmar email via SMTP → login)
3. Criar evento (Festa de Trindade)
4. Upload da planta (PDF/JPG/PNG até 25 MB) → vai pro MinIO
5. Desenhar lotes no Konva editor
6. Definir categorias + preços
7. Cadastrar fornecedor → aprovar
8. Atribuir lote para o fornecedor
9. Gerar link de cobrança Pagar.me

Esse é o fluxo Phase 1 completo da demo.

## 8. Troubleshooting comum

| Sintoma | Causa provável | Fix |
|---------|---------------|-----|
| Web container restart loop | Migrations falharam no pre-deploy hook | Logs do pre-deploy → comum: roles não criadas (§3 não foi rodado) ou `DATABASE_MIGRATOR_URL` errada |
| `/api/health` retorna 503 | `DATABASE_URL` errada ou role sem permissão | Conectar via psql com a URL exata; checar `\du fb_app_user` |
| Upload de planta falha (403/timeout) | MinIO endpoint público inacessível | Confere DNS de `minio.eventos.fbtax.cloud` + Traefik labels + bucket existe |
| Email de verificação não chega | SMTP_USER / SMTP_PASS errados ou rate limit Hostinger | Mailpit local não vale em prod — usar SMTP real; logs do Pino mostram `smtp connection refused` ou auth fail |
| Better Auth retorna "invalid origin" | `BETTER_AUTH_URL` ≠ `NEXT_PUBLIC_APP_URL` | Os dois precisam ser `https://eventos.fbtax.cloud` (sem trailing slash) |
| Pagar.me webhook não dispara | URL de webhook não configurada no painel sandbox | No painel Pagar.me sandbox: webhooks → adicionar `https://eventos.fbtax.cloud/api/webhooks/pagarme` |

## 9. Para a apresentação

**Cenário sugerido:** "Festa de Trindade está se aproximando — vamos cadastrar o evento agora."
1. Login como organizadora
2. Criar evento "Festa de Trindade 2026"
3. Subir uma planta de exemplo (PDF do espaço)
4. Desenhar 5-10 lotes visualmente
5. Mostrar dashboards (mesmo vazios mostram a estrutura)

**Limitações conhecidas desta versão (Phase 1):**
- Fornecedor self-service: signup funciona, marketplace lista eventos, mas o fluxo de reserva + checkout PIX (Plans 02-03..02-05) já está em `main` mas ainda não foi integrado E2E. Pode demonstrar como roadmap.
- Sem refund self-service (Plan 02-07 pendente)
- Sem portal fornecedor (Plan 02-08 pendente)
- Sem LGPD self-service completo (Phase 4)

---

**Source of truth para detalhes:** [`docs/deploy/COOLIFY.md`](COOLIFY.md) (~250 linhas, cobre TODOS os cenários).
