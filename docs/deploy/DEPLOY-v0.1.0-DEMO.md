# Deploy v0.1.0 demo — Coolify build-from-Git

**Padrão:** Coolify clona o repositório e builda a imagem **dentro do servidor dele** com as env vars reais já populadas. Mesmo fluxo do FB_APU04 — não usamos GHCR para a demo.

**Domínio:** `eventos.fbtax.cloud` (root) na Hostinger DNS.

**Estado do código:** main em `https://github.com/ClaudioSBezerra/FB_EVENTOS` (público). Phase 1 organizadora end-to-end + Phase 2 com 5/8 plans (signup + marketplace + reservation + SSE + checkout PIX/cartão).

---

## Sequência completa

### 1. DNS (Hostinger)

No painel Hostinger DNS:
- Tipo `A`: `eventos.fbtax.cloud` → `<IP_COOLIFY>`
- Tipo `A`: `minio.eventos.fbtax.cloud` → `<IP_COOLIFY>` (mesmo IP)

TTL 300s durante testes.

### 2. Postgres 16 (Coolify)

Resources → Add Resource → **Database → Postgres 16**.

Anote:
- Internal hostname (ex.: `fb-eventos-postgres-internal`)
- Superuser password (gerada pelo Coolify)

**Bootstrap roles** (rodar UMA vez no terminal do container Postgres):

```bash
PG_BOOTSTRAP_URL='postgresql://postgres:<senha-coolify>@<host-interno>:5432/postgres' \
  bash scripts/db/setup-roles.sh
```

Cria `fb_eventos_app` (NOBYPASSRLS), `fb_eventos_migrator` (DDL), `fb_eventos_sysreader` (BYPASSRLS), `fb_app_user`, `fb_migrator`, e database `fb_eventos_dev`.

**Extensões:**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 3. MinIO (Coolify)

Resources → Add Resource → **Service → minio/minio**.

Pin a versão `minio/minio:RELEASE.2025-01-20T14-49-07Z` (sem `:latest`).

Env vars do MinIO:
```
MINIO_ROOT_USER=<gerar com `openssl rand -hex 16`>
MINIO_ROOT_PASSWORD=<gerar com `openssl rand -hex 32`>
MINIO_BROWSER_REDIRECT_URL=https://minio.eventos.fbtax.cloud
```

Traefik labels para o subdomínio:
- `Host(\`minio.eventos.fbtax.cloud\`)` → porta `9001` (console)
- API S3 na porta `9000` (servido interno apenas)

**Após o MinIO subir**, criar bucket `fb-eventos` via console ou `mc`.

### 4. fb-eventos-web (Coolify — build from Git)

**Resources → Add Resource → Application → Public Repository.**

| Campo | Valor |
|-------|-------|
| **Repository URL** | `https://github.com/ClaudioSBezerra/FB_EVENTOS` |
| **Branch** | `main` |
| **Build pack** | `Dockerfile` |
| **Dockerfile location** | `docker/Dockerfile` |
| **Domain** | `eventos.fbtax.cloud` |
| **Port (internal)** | `3000` |

**Pre-Deploy Command:**
```bash
node dist/scripts/migrate.js
```

**Healthcheck:** `/api/health` (interval 30s, timeout 3s, retries 3)

**Environment Variables** (preencher CHANGE_ME com valores reais — Coolify substitui no momento do build E do runtime):

```env
# DB — runtime (NOBYPASSRLS app role)
DATABASE_URL=postgresql://fb_app_user:fb_app_dev_pw@<pg-internal-host>:5432/fb_eventos_dev

# DB — migrations (DDL-capable migrator role) — usado no pre-deploy hook + webhook tenant lookup
DATABASE_MIGRATOR_URL=postgresql://fb_migrator:fb_migrator_dev_pw@<pg-internal-host>:5432/fb_eventos_dev

# Auth (gerar com: openssl rand -hex 32)
BETTER_AUTH_SECRET=CHANGE_ME_32_BYTES_HEX
BETTER_AUTH_URL=https://eventos.fbtax.cloud
NEXT_PUBLIC_APP_URL=https://eventos.fbtax.cloud

# SMTP (Hostinger — usar email @fbtax.cloud)
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@fbtax.cloud
SMTP_PASS=CHANGE_ME
SMTP_SECURE=true
SMTP_FROM="FB_EVENTOS <no-reply@eventos.fbtax.cloud>"

# MinIO — interno (web→minio dentro da rede Coolify)
MINIO_ENDPOINT=fb-eventos-minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=<MINIO_ROOT_USER do §3>
MINIO_SECRET_KEY=<MINIO_ROOT_PASSWORD do §3>
MINIO_USE_SSL=false
MINIO_DEFAULT_BUCKET=fb-eventos
# MinIO — público (URLs assinadas servidas ao browser)
MINIO_PUBLIC_ENDPOINT=https://minio.eventos.fbtax.cloud

# Pagar.me — SANDBOX para a demo
PAGARME_SECRET_KEY=sk_test_CHANGE_ME
PAGARME_ENV=sandbox
PAGARME_WEBHOOK_USER=CHANGE_ME
PAGARME_WEBHOOK_PASS=CHANGE_ME
PAGARME_WEBHOOK_SIGNING_SECRET=CHANGE_ME

# Observability (opcional para demo)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
LOG_LEVEL=info

# Runtime
NODE_ENV=production
TZ=America/Sao_Paulo
NEXT_TELEMETRY_DISABLED=1
```

Como o Coolify builda do Git com essas env vars **já presentes**, o `src/lib/env.ts` valida normalmente — não precisa de `SKIP_ENV_VALIDATION`.

### 5. fb-eventos-worker (Coolify — build from Git)

Mesma config do web, mas:

| Campo | Valor |
|-------|-------|
| **Dockerfile location** | `docker/Dockerfile.worker` |
| **Domain** | (nenhum — worker não escuta HTTP) |
| **Port** | (nenhum) |
| **Pre-Deploy** | (nenhum — web já roda migrations) |
| **Healthcheck** | exit-code only |

Env vars: **as mesmas** do web service.

### 6. Smoke test

```bash
# Health
curl https://eventos.fbtax.cloud/api/health
# Esperado: 200 { "status": "ok", "checks": { "db": true } }

# Página inicial
curl -I https://eventos.fbtax.cloud/
# Esperado: HTTP/2 200
```

**Fluxo de demonstração (Phase 1 organizadora):**
1. Signup como organizadora (`/signup`)
2. Verificar email (chega via SMTP)
3. Login (`/login`)
4. Criar evento "Festa de Trindade 2026"
5. Upload da planta PDF/JPG (browser → MinIO direct via presigned URL)
6. Desenhar lotes no editor Konva
7. Definir categorias + preços (R$/m²)
8. Cadastrar fornecedor → aprovar manualmente
9. Atribuir lote ao fornecedor
10. Gerar link de cobrança Pagar.me

**Phase 2 (parcial — disponível em `main` mas não enfatizado):**
- Cadastro self-service de fornecedor em `/{slug}/fornecedor/cadastro`
- Marketplace de eventos em `/{slug}/marketplace`
- Reserva de lote com TTL 15min
- Checkout PIX/cartão (sandbox)
- SSE real-time (lote reservado por outro fornecedor → vira cinza no browser)

## Troubleshooting

| Sintoma | Causa | Fix |
|---------|-------|-----|
| Web container restart loop | Pre-deploy migrations falharam | Coolify logs do pre-deploy. Comum: roles não criadas (§2 não rodado) ou `DATABASE_MIGRATOR_URL` errada |
| `/api/health` 503 | `DATABASE_URL` errada | Conferir via psql; checar `\du fb_app_user` no Postgres |
| Upload planta 403/timeout | MinIO público inacessível | DNS `minio.eventos.fbtax.cloud` + Traefik labels + bucket `fb-eventos` existe |
| Email não chega | SMTP credenciais | Logs Pino mostram `smtp connection refused` ou auth fail |
| Better Auth "invalid origin" | URLs divergentes | `BETTER_AUTH_URL` == `NEXT_PUBLIC_APP_URL` exatos (sem trailing slash) |
| Build do Coolify falha em `pnpm build` | env var faltando | Configurar TODAS as env vars no Coolify ANTES do primeiro deploy |

## Notas técnicas

**Por que NÃO GHCR para a demo:**
- Coolify build-from-Git tem env vars reais no build → `next build` faz page-data collection com URLs válidas → sem erros de validação
- O Dockerfile `SKIP_ENV_VALIDATION=1` defensivo permanece como segurança no caso de alguém buildar manualmente fora do Coolify

**Por que NÃO usar `next start` standalone:**
- O `docker/Dockerfile` usa Node 22-alpine multi-stage; `pnpm build` gera `.next/standalone`; runner roda `node server.js`. Standard Next.js production output.

**Source of truth para detalhes complementares:** [`docker/coolify/*.md`](../../docker/coolify/) (5 manifests por serviço) e [`docs/RUNBOOK.md`](../RUNBOOK.md) (incident response).
