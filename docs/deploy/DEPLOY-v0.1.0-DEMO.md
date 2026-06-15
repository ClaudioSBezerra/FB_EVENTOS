# Deploy v0.1.0 demo — Coolify Docker Compose stack

**Padrão:** Coolify clona o repositório e roda `docker compose up -d` no `docker-compose.yml` da raiz. Tudo (web + worker + postgres + minio) sobe num único stack. Mesmo fluxo do FB_APU04.

**Domínio:** `eventos.fbtax.cloud` (root) na Hostinger DNS.

**Estado do código:** main em `https://github.com/ClaudioSBezerra/FB_EVENTOS` (público). Phase 1 organizadora end-to-end + Phase 2 com 5/8 plans.

---

## Sequência

### 1. DNS (Hostinger)

No painel Hostinger DNS:
- Tipo `A`: `eventos.fbtax.cloud` → `<IP_COOLIFY>`
- Tipo `A`: `minio.eventos.fbtax.cloud` → `<IP_COOLIFY>` (mesmo IP)

TTL 300s.

### 2. Coolify — criar a Application

**Resources → Add Resource → Application → Public Repository.**

| Campo | Valor |
|-------|-------|
| **Repository URL** | `https://github.com/ClaudioSBezerra/FB_EVENTOS` |
| **Branch** | `main` |
| **Build pack** | **Docker Compose** |
| **Docker Compose Location** | `/docker-compose.yml` (raiz do repo) |

### 3. Coolify — variáveis de ambiente

Coolify substitui os `${VAR}` no `docker-compose.yml` no momento do `docker compose up`. Configure no painel **Environment Variables** da Application:

```env
# ─── DB superuser + role passwords (init scripts criam roles/users) ───
POSTGRES_SUPERUSER_PASSWORD=<gerar com openssl rand -hex 24>
FB_APP_PASSWORD=<gerar com openssl rand -hex 24>
FB_MIGRATOR_PASSWORD=<gerar com openssl rand -hex 24>

# ─── Build args / runtime ───
APP_VERSION=0.1.0

# ─── Auth (gerar com openssl rand -hex 32) ───
BETTER_AUTH_SECRET=<32+ bytes hex>
BETTER_AUTH_URL=https://eventos.fbtax.cloud
NEXT_PUBLIC_APP_URL=https://eventos.fbtax.cloud

# ─── SMTP (Hostinger — usa caixa @fbtax.cloud existente) ───
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@fbtax.cloud
SMTP_PASS=<senha da caixa Hostinger>
SMTP_SECURE=true
SMTP_FROM=FB_EVENTOS <no-reply@eventos.fbtax.cloud>

# ─── MinIO ───
MINIO_ROOT_USER=<gerar com openssl rand -hex 16>
MINIO_ROOT_PASSWORD=<gerar com openssl rand -hex 32>
MINIO_DEFAULT_BUCKET=fb-eventos
MINIO_PUBLIC_ENDPOINT=https://minio.eventos.fbtax.cloud

# ─── Pagar.me (SANDBOX para a demo) ───
PAGARME_SECRET_KEY=sk_test_<token sandbox>
PAGARME_ENV=sandbox
PAGARME_WEBHOOK_USER=<basic auth user, configurar igual no painel Pagar.me>
PAGARME_WEBHOOK_PASS=<basic auth pass>
PAGARME_WEBHOOK_SIGNING_SECRET=<signing secret do dashboard Pagar.me>

# ─── ZapSign (opcional para a demo) ───
ZAPSIGN_TOKEN=<sandbox token>
ZAPSIGN_ENV=sandbox
ZAPSIGN_WEBHOOK_USER=<basic auth>
ZAPSIGN_WEBHOOK_PASS=<basic auth>

# ─── Observability (opcional) ───
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
LOG_LEVEL=info
```

> ⚠️ **Senhas:** gere TUDO com `openssl rand -hex N`. Nada de "trindade123" — esse domínio é público e o repo é público.

### 4. Coolify — Traefik labels (dois domínios)

Na **Application**, no painel "Domains" ou "Labels":

**Domain primário** (rota o serviço `web`):
- Host: `eventos.fbtax.cloud`
- Target service: `web`
- Target port: `3000`
- TLS via Let's Encrypt (Coolify automático)

**Domain secundário** (rota o console MinIO):
- Host: `minio.eventos.fbtax.cloud`
- Target service: `minio`
- Target port: `9001` (console UI; 9000 é a API S3 — só interno)
- TLS via Let's Encrypt

### 5. Coolify — deploy

Clica em **Deploy**. Sequência:

1. Coolify clona `main`
2. `docker compose build` → builda 2 imagens (web + worker, ambas com Node 22-alpine)
3. `docker compose up -d` → sobe postgres (init scripts criam roles+users+extensions) → minio → web → worker
4. Healthcheck do web bate em `/api/health` → flip green
5. Traefik abre TLS no `eventos.fbtax.cloud`

**Pre-deploy migrations:** o web container faz isso AUTOMATICAMENTE no entrypoint via `node dist/scripts/migrate.js`. Não precisa configurar pre-deploy hook separado quando usando Docker Compose.

### 6. Smoke test

```bash
# Health
curl https://eventos.fbtax.cloud/api/health
# Esperado: 200 { "status": "ok", "checks": { "db": true } }

# MinIO console
open https://minio.eventos.fbtax.cloud
# Login com MINIO_ROOT_USER / MINIO_ROOT_PASSWORD → criar bucket "fb-eventos" se não existir

# Página inicial
curl -I https://eventos.fbtax.cloud/
# Esperado: HTTP/2 200
```

### 7. Demo — fluxo Phase 1 organizadora

1. `/signup` — criar conta organizadora (email + senha + nome da org + slug + LGPD consent)
2. Email de verificação chega via SMTP → clica → login automático
3. `/${slug}/eventos/novo` — criar evento "Festa de Trindade 2026"
4. Upload da planta PDF/JPG (browser → MinIO direct via presigned URL)
5. `/${slug}/eventos/${eventId}/planta` — desenhar lotes no Konva editor
6. Definir categorias + preços (R$/m²)
7. `/${slug}/fornecedores` — cadastrar fornecedor manualmente → aprovar
8. Atribuir lote → gerar link de cobrança Pagar.me

### 8. Demo — Phase 2 (disponível mas não enfatizado para apresentação)

- `/${slug}/fornecedor/cadastro` — cadastro self-service de fornecedor
- `/${slug}/marketplace` — listagem de eventos publicados
- `/${slug}/marketplace/${eventId}/planta` — modo buyer (clica em lote disponível → reserva 15min)
- Checkout PIX/cartão via Pagar.me sandbox
- SSE real-time: lote reservado por outro fornecedor vira cinza em <1s

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---------|---------------|-----|
| `Docker Compose file not found` | Coolify configurado em modo Dockerfile direto | Mudar Build pack para "Docker Compose" + path `/docker-compose.yml` |
| Postgres init falha (`role exists`) | Re-deploy sobre volume antigo com roles já criados | Init scripts usam `IF NOT EXISTS` — é seguro; pode ignorar warnings |
| Web restart loop | Migrations falharam | Logs do container `fb-eventos-web` → procurar erro de connection ou DDL |
| `/api/health` 503 | `DATABASE_URL` errada ou Postgres não healthy | `docker exec fb-eventos-web env | grep DATABASE` |
| Upload planta falha | DNS `minio.eventos.fbtax.cloud` errado, ou Traefik label faltando | Testa direto: `curl https://minio.eventos.fbtax.cloud/minio/health/live` |
| Better Auth "invalid origin" | URLs divergentes | `BETTER_AUTH_URL` == `NEXT_PUBLIC_APP_URL` exatos (sem trailing slash) |

## Limitações desta versão

- **Sem Pagar.me real produção** — sandbox apenas (operator-approved flip para sk_live_* é Phase 2 Plan 02-08 D-14 gate, ainda pendente)
- **Sem refund self-service** (Plan 02-07 pendente)
- **Sem portal completo do fornecedor** (Plan 02-08 pendente)
- **Sem LGPD self-service completo** (Phase 4)

## O que NÃO está neste compose

- **Mailpit** (caixa SMTP local de dev) — sai do compose de produção; substituído por SMTP Hostinger real
- **Sentry server** — opcional, configurável via SENTRY_DSN
- **Watchtower / image auto-update** — contractualmente banido (CLAUDE.md T-0-07)

## Source of truth complementar

- [`docker/coolify/postgres.service.md`](../../docker/coolify/postgres.service.md) — RLS + dual-role rationale
- [`docker/coolify/minio.service.md`](../../docker/coolify/minio.service.md) — bucket lifecycle + LGPD retention
- [`docker/coolify/web.service.md`](../../docker/coolify/web.service.md) — env var contract completo
- [`docker/coolify/worker.service.md`](../../docker/coolify/worker.service.md) — Graphile-Worker runtime
- [`docs/RUNBOOK.md`](../RUNBOOK.md) — incident response
