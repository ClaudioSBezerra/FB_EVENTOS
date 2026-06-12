# Traefik Labels — `fb-eventos-web`

> **RESEARCH Open Question A4 / LOW confidence:** these labels match the
> Traefik v3 convention bundled with Coolify but the EXACT label-naming
> shape may differ in your Coolify version's UI. Verify against the
> Coolify dashboard on first deploy and update this file with the actual
> production-tested labels. Phase 1 retrospective will confirm.

Plan 07, Phase 0 — TLS-terminated routing for the Next.js web container
via Traefik + Let's Encrypt.

---

## Phase 0 Scope

Single host: `app.fbeventos.com.br` (or `{{PRODUCTION_HOST}}` placeholder).

**Phase 4 (multi-tenant subdomain) NOT in scope here:** wildcard cert
`*.fbeventos.com.br` + per-tenant `Host()` routing is deferred. Phase 4's
infrastructure plan will replace the single-Host rule with a regex-Host
rule and add a wildcard ACME challenge (DNS-01 via Cloudflare).

## Labels (Traefik v3, Coolify-managed)

Apply these labels via the Coolify service "Labels" / "Custom Configuration"
panel for `fb-eventos-web`:

```yaml
# Enable Traefik routing for this service.
traefik.enable: "true"

# === HTTPS entrypoint (port 443) ===
traefik.http.routers.fb-eventos.rule: "Host(`{{PRODUCTION_HOST}}`)"
traefik.http.routers.fb-eventos.entrypoints: "websecure"
traefik.http.routers.fb-eventos.tls: "true"
traefik.http.routers.fb-eventos.tls.certresolver: "letsencrypt"

# === HTTP -> HTTPS redirect ===
traefik.http.routers.fb-eventos-http.rule: "Host(`{{PRODUCTION_HOST}}`)"
traefik.http.routers.fb-eventos-http.entrypoints: "web"
traefik.http.routers.fb-eventos-http.middlewares: "redirect-to-https"
traefik.http.middlewares.redirect-to-https.redirectscheme.scheme: "https"
traefik.http.middlewares.redirect-to-https.redirectscheme.permanent: "true"

# === Upstream service ===
traefik.http.services.fb-eventos.loadbalancer.server.port: "3000"

# === Active healthcheck (Traefik polls upstream) ===
traefik.http.services.fb-eventos.loadbalancer.healthcheck.path: "/api/health"
traefik.http.services.fb-eventos.loadbalancer.healthcheck.interval: "30s"
traefik.http.services.fb-eventos.loadbalancer.healthcheck.timeout: "3s"

# === Security headers middleware ===
traefik.http.routers.fb-eventos.middlewares: "fb-eventos-security-headers"
traefik.http.middlewares.fb-eventos-security-headers.headers.stsSeconds: "31536000"
traefik.http.middlewares.fb-eventos-security-headers.headers.stsIncludeSubdomains: "true"
traefik.http.middlewares.fb-eventos-security-headers.headers.stsPreload: "true"
traefik.http.middlewares.fb-eventos-security-headers.headers.contentTypeNosniff: "true"
traefik.http.middlewares.fb-eventos-security-headers.headers.browserXssFilter: "true"
traefik.http.middlewares.fb-eventos-security-headers.headers.referrerPolicy: "strict-origin-when-cross-origin"
```

## ACME (Let's Encrypt) Configuration

Coolify pre-configures the `letsencrypt` cert resolver. To verify:

1. Coolify dashboard → "Servers" → your server → "Traefik".
2. Confirm `letsencrypt` cert resolver is configured with HTTP-01
   challenge (Phase 0 single-host is fine with HTTP-01; Phase 4 wildcard
   will require DNS-01 + Cloudflare credentials).
3. Confirm the ACME storage path is mounted on a persistent volume
   (Coolify default — but if you moved Traefik to a custom path, re-verify).

## DNS Setup (one-time)

Add to your DNS provider (Cloudflare recommended for Phase 4 DNS-01):

```
A     {{PRODUCTION_HOST}}    {{SERVER_PUBLIC_IP}}
AAAA  {{PRODUCTION_HOST}}    {{SERVER_PUBLIC_IPV6}}     (optional)
```

If using Cloudflare, set DNS-only (gray cloud) for the first deploy —
HTTP-01 challenge needs to reach the Traefik instance directly. After
first successful cert issuance, you may enable proxy (orange cloud) IF
you set Cloudflare SSL mode to "Full (strict)".

## Verification (post-deploy)

```bash
# 1. DNS resolves to your server.
dig +short {{PRODUCTION_HOST}}
#   Expected: {{SERVER_PUBLIC_IP}}

# 2. HTTPS reachable + cert valid.
curl -fsSL -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' \
  https://{{PRODUCTION_HOST}}/api/health
#   Expected: 200 0

# 3. Cert was issued by Let's Encrypt.
echo | openssl s_client -servername {{PRODUCTION_HOST}} \
  -connect {{PRODUCTION_HOST}}:443 2>/dev/null | \
  openssl x509 -noout -issuer -subject -dates
#   Expected: issuer=C=US, O=Let's Encrypt, CN=R3 (or successor CA)

# 4. HTTP -> HTTPS redirect works.
curl -fsSL -o /dev/null -w '%{http_code}\n' http://{{PRODUCTION_HOST}}/api/health
#   Expected: 301 (Traefik permanent redirect to https://)
```

## Rate Limiting (deferred to Phase 1)

Phase 0 does not configure Traefik rate limits. Phase 1's first
production-facing endpoint (signup, login, password-reset) will need
edge rate limits — add a `rate-limit` middleware here at that time.

## Caveats / Verify on First Deploy

- **Coolify label syntax may differ.** Some Coolify versions use
  `compose.yaml` overrides instead of label panels. If the labels above
  do not apply cleanly, check the Coolify docs for your version and
  update this file with the production-tested form.
- **`letsencrypt` resolver name** may be different in your install
  (Coolify's default is usually `letsencrypt`, but some deployments use
  `acme` or a custom name).
- **Healthcheck path 200 requirement.** Traefik considers any 2xx
  response healthy; our `/api/health` returns 200 on success and 503 on
  DB failure — Traefik will route around an unhealthy container.

## See Also

- `docker/coolify/web.service.md` — web service manifest.
- `docs/deploy/COOLIFY.md` — end-to-end deploy runbook.
