# FB_EVENTOS Operations Runbook

**Plan 07, Phase 0 — FOUND-13. Load-bearing on-call document.**

This runbook is the canonical source-of-truth for incident response. Every
section assumes the deploy pipeline is healthy per `docs/deploy/COOLIFY.md`.

> **Lesson from FB_APU04 (2026-05-07 data-loss incident):** the prior
> project shipped without a runbook. One unguarded DELETE wiped four
> months of data; no rollback was documented; recovery took 18 hours.
> Phase 0 ships this runbook BEFORE any production data exists so the
> muscle memory is in place.

---

## Operator Substitution Table

The deploy manifests use `{{PLACEHOLDER}}` syntax. Set these in the
Coolify env UI before triggering the first deploy:

| Placeholder                  | What                                                | Where to find it                                                  |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `{{GHCR_ORG}}`               | GitHub org/user owning the GHCR images              | Your GitHub org slug                                              |
| `{{APP_VERSION}}`            | Semver of the release                               | `package.json` after `pnpm version`                               |
| `{{COOLIFY_URL}}`            | Coolify dashboard URL                               | Coolify install output                                            |
| `{{COOLIFY_PG_HOST}}`        | Coolify-internal Postgres hostname                  | Coolify Postgres service "Internal Host" field                    |
| `{{COOLIFY_PG_SUPERUSER}}`   | Postgres superuser for bootstrap                    | Coolify Postgres "Credentials"                                    |
| `{{COOLIFY_PG_SUPERUSER_PW}}`| Postgres superuser password                         | Coolify Postgres "Credentials"                                    |
| `{{DB_APP_PASSWORD}}`        | `fb_eventos_app` role password                      | `scripts/db/setup-roles.sh` output (Coolify vault)                |
| `{{DB_MIGRATOR_PASSWORD}}`   | `fb_eventos_migrator` role password                 | `scripts/db/setup-roles.sh` output (Coolify vault)                |
| `{{BETTER_AUTH_SECRET}}`     | 32-byte random secret for session signing           | `openssl rand -hex 32` (one-time, store in Coolify vault)         |
| `{{RESEND_API_KEY}}`         | Resend API key                                      | Resend dashboard → API Keys                                       |
| `{{SENTRY_DSN}}`             | Sentry server-side DSN                              | Sentry → Project Settings → Client Keys (DSN)                     |
| `{{SENTRY_AUTH_TOKEN}}`      | Sentry source-map upload token                      | Sentry → Settings → Auth Tokens (`project:releases` scope)        |
| `{{MINIO_ACCESS_KEY}}`       | MinIO service account access key                    | MinIO Console → Identity → Service Accounts                       |
| `{{MINIO_SECRET_KEY}}`       | MinIO service account secret key                    | MinIO Console → Identity → Service Accounts                       |
| `{{PRODUCTION_HOST}}`        | Production hostname (e.g. `app.fbeventos.com.br`)   | Your chosen hostname                                              |
| `{{SERVER_PUBLIC_IP}}`       | Coolify host's public IPv4                          | Your VM provider dashboard                                        |

---

## On-Call Contact

> **TODO Phase 1:** populate when the team grows beyond solo dev.
>
> Phase 0 piloto: claudio_bezerra@hotmail.com (primary; solo). Escalation:
> none. The single-point-of-failure risk is acknowledged and accepted
> for the piloto.

---

## Incident: Service Down

**Symptoms:** `/api/health` returns 5xx; users report site unreachable.

### Triage

1. Check `/api/health` directly:
   ```bash
   curl -fsSL https://{{PRODUCTION_HOST}}/api/health
   ```
2. Check Coolify dashboard → `fb-eventos-web` service status.
   - "Stopped" → container crashed. Continue to Mitigation.
   - "Running" but 503 → DB unreachable. See "Incident: DB unreachable".
   - "Deploying" → wait 60s, re-check; deploy may be mid-flight.

### Mitigation

1. Coolify dashboard → `fb-eventos-web` → "Logs". Look for:
   - Crash stack trace at startup (env var missing, migration mismatch).
   - "EADDRINUSE :::3000" → port conflict, restart service.
2. If the crash is reproducible, **rollback to the previous semver**
   (see `docs/deploy/COOLIFY.md` Section 4).
3. If the rollback also fails, fall back to direct Postgres verification:
   ```bash
   psql "{{DATABASE_URL}}" -c "SELECT 1;"
   ```
4. If Postgres is also down → see "Incident: DB unreachable".

### Escalation

If the service is down for >15 min and rollback fails, open a Sentry
incident issue tagged `severity:critical`. Document the incident in
`docs/incidents/YYYY-MM-DD-<slug>.md` per the post-mortem template
(Phase 1+ — for now write a short note in this section).

---

## Incident: DB Unreachable

**Symptoms:** `/api/health` returns 503 + `{checks:{db:false}}`. Coolify
web logs show postgres.js connection-refused errors.

### Triage

1. Coolify dashboard → `fb-eventos-postgres` → status.
2. If Postgres is "Stopped": Coolify will auto-restart. If it does not,
   click "Restart Service" manually.
3. If Postgres is "Running" but unreachable from web:
   - Network issue between Coolify services. Restart Coolify's Traefik:
     dashboard → Servers → your server → "Restart Traefik".
   - DNS resolution issue inside Coolify network. Verify
     `{{COOLIFY_PG_HOST}}` resolves from the web container shell.

### Mitigation

1. If a recent deploy preceded the failure, **rollback Postgres image
   tag** is NOT a thing (Coolify-managed) — instead, restore from
   backup per `docs/deploy/BACKUP.md`.
2. If the disk is full (very common cause):
   ```sql
   SELECT pg_size_pretty(pg_database_size('fb_eventos'));
   SELECT pg_size_pretty(pg_total_relation_size('audit_log'));
   ```
   Then per the LGPD retention table, schedule a purge of expired audit
   rows (Phase 4+ has the automation; Phase 0 may need a manual DELETE
   inside a backup window).

---

## Incident: Data Corruption Suspected

**Symptoms:** Application returns wrong data for a user; audit_log shows
unexpected mutations; user reports "my data is gone".

> **CRITICAL:** Stop write traffic FIRST. Snapshot, THEN investigate.

### Step 1 — STOP writes (read-only mode kill switch)

Phase 0 does NOT ship an automated read-only mode (that's OPS-05 in
Phase 4). For now, the manual procedure:

```bash
# Connect as fb_eventos_migrator (DDL-capable).
psql "{{DATABASE_MIGRATOR_URL}}"

# Revoke write permissions from the runtime role.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM fb_eventos_app;

# Verify.
SELECT has_table_privilege('fb_eventos_app', 'user', 'INSERT');  -- expect f
SELECT has_table_privilege('fb_eventos_app', 'user', 'SELECT');  -- expect t
```

The site keeps serving reads (Server Components, dashboard) but every
mutation fails with a Postgres permission error. Users see a friendly
error message; on-call has time to investigate.

**To restore writes:**
```sql
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fb_eventos_app;
-- Then re-revoke audit_log UPDATE/DELETE (LGPD-04 append-only guarantee):
REVOKE UPDATE, DELETE ON audit_log FROM fb_eventos_app;
```

### Step 2 — Snapshot the DB

```bash
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
pg_dump --format=custom \
        --file=/var/backups/incident-${TIMESTAMP}.dump \
        "{{DATABASE_URL}}"
```

Even though the runtime role is in read-only mode, `pg_dump` works.
Store the dump on a separate volume (or upload to MinIO):
```bash
mc cp /var/backups/incident-${TIMESTAMP}.dump fb-eventos/backups/
```

### Step 3 — Inspect

Use a separate read-only psql session. Cross-reference `audit_log`:

```sql
SELECT created_at, user_id, action, entity, entity_id, payload
FROM audit_log
WHERE tenant_id = '{{tenant_uuid}}'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 200;
```

### Step 4 — Decide: rollback DB OR roll forward with a fix

- **Rollback DB** if the corruption is recent and traceable to a specific
  deploy: see `docs/deploy/BACKUP.md` "Restore Procedure".
- **Roll forward** if the corruption is from a user action (not a bug):
  craft an `UPDATE` (or `INSERT`-corrective audit-log row) inside a
  transaction with an audit-log entry explaining the operator action.

### Step 5 — Document the incident

Write to `docs/incidents/YYYY-MM-DD-<slug>.md`. Even short notes are
valuable — see the FB_APU04 retro for why this matters.

---

## Incident: Cross-Tenant Data Leak

**Symptoms:** User from tenant A reports seeing tenant B's data; or
automated test in `tests/auth/tenant-isolation-e2e.test.ts` starts
failing in CI (this is the load-bearing TENA-07 proof — DO NOT
disable the test, fix the regression).

### Step 1 — STOP

This is the single most serious incident class for a multi-tenant SaaS.
Apply the read-only mode kill switch IMMEDIATELY (see "Data Corruption
Suspected" Step 1).

### Step 2 — Scan audit_log for cross-tenant access

```sql
-- Identify suspicious user actions where the tenant_id does NOT match
-- the user's tenant membership.
SELECT a.created_at, a.user_id, a.tenant_id AS action_tenant, m.tenant_id AS member_tenant
FROM audit_log a
LEFT JOIN member m ON m.user_id = a.user_id AND m.tenant_id = a.tenant_id
WHERE m.tenant_id IS NULL
ORDER BY a.created_at DESC
LIMIT 200;
```

Any row in the result is a candidate leak.

### Step 3 — Revoke active sessions + rotate secrets

```sql
-- Invalidate all sessions (forces re-login).
UPDATE session SET expires_at = NOW();
-- Better Auth will reject any cookie with a session past expiry.
```

Then rotate `BETTER_AUTH_SECRET` via Coolify env UI + redeploy. Every
existing cookie is now cryptographically invalid.

### Step 4 — Verify the load-bearing TENA-07 invariants

Run `tests/auth/tenant-isolation-e2e.test.ts` against the live DB
(temporarily point `DATABASE_URL` at the production replica). Four
assertions must hold:
1. `withTenant(acme.id)` sees ONLY acme orgs/members.
2. `withTenant(globex.id)` sees ONLY globex orgs.
3. `appPool.select` without `withTenant` returns 0 rows.
4. `withTenant(acme.id)` cannot read globex by PK.

If any fail, FORCE RLS is broken at the catalog level. Re-verify
Plan 03's migration 0002 (FORCE RLS) actually applied:

```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN ('user','session','account','verification',
                  'organization','member','invitation',
                  'audit_log','consent_records');
-- Every row must show t,t. If any show f,f, re-run migration 0002.
```

### Step 5 — File LGPD incident notification

Per LGPD Art. 48, a security incident affecting personal data must be
reported to ANPD within a "reasonable time" (no fixed window, but
practice = 72 hours). Notify the DPO (Phase 0: solo founder until DPO
is appointed in Phase 1).

---

## Incident: Backup Restore Drill

See `docs/deploy/BACKUP.md` Section "Verification Drill".

---

## Read-Only Mode Kill Switch

See "Incident: Data Corruption Suspected" Step 1 above. Manual procedure
for Phase 0; Phase 4 OPS-05 will ship an automated flag.

---

## Watchtower & Floating Tags — BANNED

**CLAUDE.md "What NOT to Use" entry:**

> **Watchtower auto-pulling `:latest`** — FB_APU04 bridge ships any
> `:latest` to all tenants within 5 min, no canary. → Version-tagged
> Docker images (`fb-eventos-web:1.2.3`). Coolify deploys are
> deliberate. No Watchtower.

If during an incident you find yourself reaching for "just one quick
auto-update": STOP. The 2026-05-07 FB_APU04 incident happened because
Watchtower pulled an untested `:latest` to production at 14:32 on a
Friday. Every Coolify deploy of FB_EVENTOS is **manual + semver-tagged**.
CI gates this at every PR (`.github/workflows/ci.yml` job
`verify-no-latest-in-workflows`) AND at every release
(`.github/workflows/build-and-push.yml` re-checks).

---

## Lessons from FB_APU04 (2026-05-07 Data Loss)

The prior project lost 4 months of production data in 18 hours of
downtime. The root causes that FB_EVENTOS structurally prevents:

| FB_APU04 anti-pattern                                        | FB_EVENTOS guard                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `DROP TABLE schema_migrations` on every backend boot         | drizzle-kit migrate runs ONCE in pre-deploy hook              |
| `:latest` floating tag + Watchtower                          | CI grep gate + Coolify deploys are explicit semver            |
| AuthMiddleware silently admin-bypassed all roles             | Better Auth + explicit `requireRole('admin', {explicit:true})`|
| No tests                                                     | 61 Vitest tests + Playwright walking-skeleton in CI           |
| No audit log                                                 | `audit_log` table with FORCE RLS + REVOKE UPDATE/DELETE       |
| No backups                                                   | Coolify Postgres backup tier + pg_dump→MinIO supplement       |
| Single env file with real secrets committed                  | `.env.local` gitignored + gitleaks pre-commit + CI gate       |
| Reset/Truncate endpoints unguarded                           | None ship in Phase 0; future ones require confirmation token  |
| `fb_apu01` module name still in import paths                 | Project name = `fb-eventos`; CI grep gate against legacy      |

See `docs/PITFALLS.md` (Phase 0 captured separately) for the full
catalog.

---

## Phase 1 — D-14 Gate Sandbox→Production Flip

**Origin:** Phase 1 Plan 01-08 (Walking-Skeleton + D-14 Gate). The "D-14"
nickname refers to the 14-day countdown to the Festa de Trindade piloto —
fourteen days before the event, the gate must be GREEN end-to-end in
sandbox before the operator flips the staging container to production
gateway credentials.

### Pre-conditions

Before invoking this checklist, BOTH must be true:

1. The four D-14 steps pass GREEN in CI:
   ```bash
   pnpm test:e2e --project=d14-gate --grep "D-14 gate"
   ```
   Expected output (per spec at `tests/e2e/walking-skeleton.spec.ts`):
   - ✅ Step 1: signup organizadora → setActiveOrg trindade
   - ✅ Step 2: event + planta upload + 1 lot drawn + assigned to vendor
   - ✅ Step 3: contract emit + sandbox sign both signers → status='signed'
   - ✅ Step 4: PIX charge + sandbox payment → status='paid'

2. The operator (you, claudio_bezerra@hotmail.com) explicitly approves the
   flip in writing (commit message or audit-log row) — the checkpoint in
   the plan is NOT auto-approved by the executor.

### Operator Checklist (numbered, in order)

> **CRITICAL:** Each step changes a real production credential. Run them
> in order. Stop at the first failure and execute the **Rollback** below.

1. **Verify Resend production API key**
   - Coolify dashboard → `fb-eventos-web` → Environment → confirm
     `RESEND_API_KEY` is the **production** key from
     https://resend.com/api-keys (not the dev sandbox key).
   - Send a test email via Resend dashboard "Send test" feature to
     yourself; confirm delivery within 30 seconds.

2. **Flip Pagar.me to production**
   - Coolify env edits:
     ```
     PAGARME_ENV=sandbox     → PAGARME_ENV=production
     PAGARME_SECRET_KEY=sk_test_xxx → PAGARME_SECRET_KEY={{prod}}
     ```
   - Production secret key is at https://dashboard.pagar.me → Configurações →
     Keys → "Live mode".
   - Save Coolify env; **do not restart yet** — restart after step 3.

3. **Flip ZapSign to production**
   - Coolify env edits:
     ```
     ZAPSIGN_ENV=sandbox     → ZAPSIGN_ENV=production
     ZAPSIGN_TOKEN={{sandbox}} → ZAPSIGN_TOKEN={{prod}}
     ```
   - Production token is at https://app.zapsign.com.br → Conta → API.
   - Save Coolify env.

4. **Restart staging container**
   - Coolify dashboard → `fb-eventos-web` → Restart.
   - Wait 60s; curl the health probe:
     ```bash
     curl -fsSL https://{{PRODUCTION_HOST}}/api/health
     ```
   - Expected: `{ "ok": true, "checks": { "db": true, "redis": true } }`.

5. **Run low-value smoke charge against real Pagar.me production**
   - Create a real "Stand 1 m²" lot in the production trindade tenant
     (R$ 1,00).
   - Drive the full UI flow as a real fornecedor: signup → approve →
     create contract → assinar via ZapSign **production** → PIX charge
     R$ 1,00 → confirm payment receipt in the Pagar.me production
     dashboard within 5 minutes.
   - Confirm the `payments` row in the production DB transitions
     `pending → paid` with `paid_at` populated.
   - Confirm the `pagamento_recebido` Resend email lands in the operator
     inbox.

6. **Audit-log the flip (LGPD-04)**
   - Manually INSERT an `audit_log` row tagged with the operator's
     identity + timestamp. Use the migrator pool (BYPASSRLS) since this
     is a cross-tenant operational event:
     ```sql
     INSERT INTO audit_log (
       tenant_id, user_id, action, entity, entity_id, payload, created_at
     ) VALUES (
       '{{TRINDADE_TENANT_ID}}', '{{OPERATOR_USER_ID}}',
       'd14_gate.production_flip', 'system', NULL,
       jsonb_build_object(
         'pagarme_env_before', 'sandbox',
         'pagarme_env_after', 'production',
         'zapsign_env_before', 'sandbox',
         'zapsign_env_after', 'production',
         'smoke_charge_payment_id', '{{SMOKE_PAYMENT_ID}}',
         'operator_email', 'claudio_bezerra@hotmail.com'
       ),
       NOW()
     );
     ```
   - This row is the legal record that the flip happened, by whom, at
     what UTC time. It is append-only by GRANT layer — once written it
     cannot be tampered with from the runtime app role.

### Rollback (if any step above fails)

1. Revert env vars in Coolify:
   ```
   PAGARME_ENV=production   → PAGARME_ENV=sandbox
   PAGARME_SECRET_KEY={{prod}} → PAGARME_SECRET_KEY=sk_test_xxx
   ZAPSIGN_ENV=production   → ZAPSIGN_ENV=sandbox
   ZAPSIGN_TOKEN={{prod}}   → ZAPSIGN_TOKEN={{sandbox}}
   ```
2. Restart the container.
3. Verify the D-14 sandbox E2E suite still GREEN.
4. Insert an audit-log row with `action='d14_gate.production_flip_rolled_back'`
   + the failure reason in payload.
5. Investigate the failed step BEFORE re-attempting the flip.

### Operator Substitution Variables (for this section)

| Placeholder                     | Description                                              |
| ------------------------------- | -------------------------------------------------------- |
| `{{PAGARME_SECRET_KEY_PROD}}`   | Pagar.me v5 production secret key (sk_live_*)            |
| `{{ZAPSIGN_TOKEN_PROD}}`        | ZapSign production API token                             |
| `{{TRINDADE_TENANT_ID}}`        | UUID of the trindade tenant in production DB             |
| `{{OPERATOR_USER_ID}}`          | Better Auth `user.id` of claudio_bezerra                 |
| `{{SMOKE_PAYMENT_ID}}`          | `payments.id` of the R$ 1,00 smoke charge from step 5    |

---

## See Also

- `docs/deploy/COOLIFY.md` — deploy procedure.
- `docs/deploy/BACKUP.md` — backup + restore.
- `docs/LGPD.md` — LGPD compliance reference.
- `docs/adr/0001-queue-backend.md` — job-queue architecture decision.
- `docker/coolify/*.md` — per-service manifests.
- `tests/e2e/walking-skeleton.spec.ts` — walking-skeleton + D-14 gate E2E suite.
