# Pitfalls Research

**Domain:** Brazilian multi-tenant SaaS event management platform (large-scale events, vendor space sales, ticketing, payments)
**Researched:** 2026-06-11
**Confidence:** HIGH (FB_APU04 case study fully documented; PostgreSQL/RLS/PIX patterns are well-established industry knowledge; LGPD requirements are codified in law)

> Note: WebSearch was unavailable during this research. Findings rest on (a) directly verified FB_APU04 code (`/tmp/FB_APU04/.planning/codebase/CONCERNS.md`, `INTEGRATIONS.md`), (b) PostgreSQL/payments/LGPD knowledge from training data with publication dates predating the cutoff. Where a recommendation depends on a specific gateway's current API behavior (PIX endpoints, Sympla v2), it is flagged with `[VERIFY-PHASE]` so the owning phase confirms against current docs before implementation.

---

## Critical Pitfalls

### Pitfall 1: The Embedded-DB Trap (HIGHEST PRIORITY — explicit user contract)

**What goes wrong:**
A developer reaches for SQLite, a `.json` state file, a file-based queue, or "just a small `.db` next to the binary" to track watermarks, jobs, sessions, rate limits, or any persistent state. It looks like a harmless shortcut. In production it breaks in five ways that compound:

1. **Unbounded growth** — There is no retention policy because nobody owns the file. It grows until disk is full or queries crawl.
2. **Tenant isolation by filename** — Files like `tracker-<config-stem>.db` use the config filename as the tenant boundary. Rename `config-trindade.yaml` to `trindade.yaml` and the bridge silently reads the wrong tracker, sending tenant A's data to tenant B.
3. **No backup/PITR** — `pg_basebackup`, WAL archiving, point-in-time recovery do not apply to a `.db` next to the binary. When the container restarts on a different node, the state vanishes.
4. **Lock contention / corruption** — SQLite single-writer lock blocks the daemon; an unclean shutdown corrupts the file; concurrent daemon processes (canary + production) compete for the same file.
5. **No observability** — There are no `pg_stat_*` views, no Prometheus exporters, no audit trail of who/what wrote what. Debugging means SSH + `sqlite3` REPL.

**Why it happens:**
- "I just need a tiny watermark, Postgres is overkill"
- "It's faster to ship — I'll migrate later" (never happens)
- Developer is used to local prototyping habits and carries them into production
- Library choice (e.g., a Python ETL example uses SQLite by default)

**FB_APU04 case study (direct evidence from the sibling repo):**
- `erp-bridge-aws/bridge.py:44-65` — config-stem derives both `tracker-<stem>.db` and `logs-<stem>/`. No validation that stems are unique per tenant. `INTEGRATIONS.md` confirms: "Tracker isolation silently breaks — the bridge will read/write a tracker matching the stem, which may be the wrong one."
- `tracker-config-apu04.db` keeps watermark per `(servidor, tipo, chave)` *forever*. CONCERNS.md scaling section: "After ~1M rows, query latency for `ja_enviado` lookups grows."
- Zero Python tests (`erp-bridge-aws/`); zero coverage of the watermark logic, retry logic, or stem-split logic. CONCERNS.md: "Schema changes in `s4i_nfe`, `s4i_nfe_impostos`, `FORN`, `CLIE` are detected only in production."
- The same daemon re-opens the file every iteration (line 88), trading correctness for filesystem churn.

**How to avoid (CONTRACTUAL — see PROJECT.md Out-of-Scope and Constraints sections):**

1. **Single source of truth = PostgreSQL.** Every persistent value lives in a Postgres table. No exceptions. No "small" exceptions. No "just for dev" exceptions (because "just for dev" patterns get copy-pasted into prod).
2. **Job queue = Postgres-backed.** Use one of:
   - **River** (Go-native, transactional, modern — recommended if stack is Go) [VERIFY-PHASE: confirm latest version supports the throughput target]
   - **Graphile-Worker** (Node.js, `SKIP LOCKED`-based) if stack is Node
   - **Plain Postgres + `FOR UPDATE SKIP LOCKED` worker** (rolling our own is acceptable for FB_EVENTOS scale; <100 jobs/sec)
3. **Rate limits = Redis or Postgres.** Redis is already provisioned in the FB_APU04 docker-compose (`docker-compose.prod.yml:85-99`) but unused. For FB_EVENTOS, start with Postgres-based rate limit (token bucket in a small table) and only add Redis when measurements demand it.
4. **Sessions = Postgres-backed or signed stateless JWT cookies.** Never a `sessions/` directory.
5. **Watermarks / sync state = explicit `sync_state` table** with `(tenant_id, source, last_offset, updated_at)` and `FOREIGN KEY (tenant_id) REFERENCES tenants(id)`. Tenant isolation is enforced by FK, not filename.
6. **CI grep gate.** Add a CI check that fails on any of: `\.db['"\s]`, `sqlite3`, `import sqlite`, `database/sql/sqlite`, `mattn/go-sqlite3`, `better-sqlite3`. Apply to all directories that ship to production.
7. **Code review checklist item:** "Is there any persistent state that does not live in PostgreSQL?"

**Warning signs:**
- A PR adds a dependency that contains "sqlite" in the name
- A PR adds `*.db`, `*.sqlite`, `state/`, or `tracker/` to `.gitignore` (the file exists somewhere)
- A daemon/worker has a config field like `tracker_path` or `state_file`
- Tests pass locally but fail in CI because "the file is not there"
- A bug report mentions "after restart, the job re-processed everything"

**Phase to address:**
**Phase 1 (Organizadora foundation)** — the contract must be enforced from commit #1. The CI grep gate ships in the Phase 1 bootstrap PR alongside the migration runner and the multi-tenant data model. **Ongoing** afterward — every new component is reviewed against this rule.

---

### Pitfall 2: Multi-Tenant Data Leak (cross-tenant query returns another tenant's data)

**What goes wrong:**
A handler writes `SELECT * FROM eventos WHERE id = $1` and forgets `AND tenant_id = $2`. A vendor logs in to Organizer A's event and sees Organizer B's vendor list. A worker job that "processes all events" iterates without scoping, sending Organizer A's emails to Organizer B's contacts. The bug ships because:
- Local dev only had one tenant, so missing `tenant_id` filters returned the right answer by coincidence.
- Integration tests only have one tenant.
- An admin endpoint legitimately needs cross-tenant access; the developer copies its pattern to a non-admin endpoint by mistake.
- A `JOIN` chain forgets to scope an intermediate table (e.g., `eventos JOIN lotes JOIN reservas`).
- The Go backend (per FB_APU04 pattern) uses `X-Company-ID` header read by `GetEffectiveCompanyID(...)` — easy to forget on a new handler.

**Why it happens:**
- Tenant scoping at the application layer relies on developer discipline. Humans forget. AI assistants forget too.
- ORMs / query builders make it easy to omit the `WHERE` clause.
- Background workers run as superuser/service role and have no per-request tenant context.
- A new table is created without RLS enabled (Postgres allows this silently).

**How to avoid:**

1. **PostgreSQL Row-Level Security (RLS) with `FORCE`** on every tenant-scoped table:
   ```sql
   ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;
   ALTER TABLE eventos FORCE ROW LEVEL SECURITY;  -- applies to table owner too
   CREATE POLICY tenant_isolation ON eventos
     USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
   ```
   `FORCE` is critical: without it, the table owner (your migration role) bypasses RLS. With it, even a buggy admin query is filtered.

2. **Dedicated application role**, NOT `postgres` superuser. FB_APU04 violated this — CONCERNS.md: "All env templates default to `DB_USER=postgres`... If the API binary is compromised, attacker has full DDL access." For FB_EVENTOS:
   - `fb_eventos_migrator` (DDL only, used by migration runner)
   - `fb_eventos_app` (DML on tenant tables, RLS applies)
   - `fb_eventos_admin` (cross-tenant read for support, RLS bypassed via `BYPASSRLS` attribute, only used by support tooling with audit log)

3. **Tenant context set per request**:
   ```sql
   SET LOCAL app.current_tenant_id = '<uuid>';
   ```
   Set in middleware, inside the transaction. `SET LOCAL` resets on COMMIT — no leakage between requests via connection pooling.

4. **Tenant assertion middleware**: every request must (a) authenticate, (b) resolve tenant from JWT (NOT from `X-Company-ID` header — that header is trivially spoofable; tenant lives in the signed JWT claim), (c) `SET LOCAL app.current_tenant_id`, (d) reject if not set.

5. **Background workers**: each job row includes `tenant_id`. The worker sets `app.current_tenant_id` before executing job logic. The job's `tenant_id` is verified against the resource's `tenant_id` (defense in depth).

6. **Migration template** that enforces RLS on new tenant tables:
   ```sql
   -- All new tenant-scoped tables MUST include:
   CREATE TABLE foo (
     id uuid PRIMARY KEY,
     tenant_id uuid NOT NULL REFERENCES tenants(id),
     -- ... other columns ...
   );
   CREATE INDEX ON foo(tenant_id);
   ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
   ALTER TABLE foo FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON foo
     USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
   ```
   CI lint: every new table file must contain `FORCE ROW LEVEL SECURITY` or be in an allow-list (e.g., `tenants`, `users` global tables).

7. **Integration test suite** with TWO tenants seeded. Every handler test asserts that Tenant A's request never returns Tenant B's row. If a handler doesn't have this test, it doesn't ship.

**Warning signs:**
- A new migration adds a table without `ENABLE ROW LEVEL SECURITY`
- A handler reads `X-Company-ID` from request header instead of JWT
- A query in code review contains no `tenant_id` filter (RLS may be saving you — but verify)
- A worker runs as `postgres` superuser
- The integration test suite has only one tenant fixture

**Phase to address:**
**Phase 1 (Organizadora foundation)** — RLS, `FORCE`, dedicated roles, tenant assertion middleware, and the two-tenant integration test fixture are part of the bootstrap PR. **Ongoing** — every new table goes through the migration template; every new handler gets a two-tenant test.

---

### Pitfall 3: Floor-Plan / Booth Reservation Race Conditions

**What goes wrong:**
Two vendors open the same event plan at the same time. Both see lot #42 as available. Both click "Reserve". Both get a confirmation. Both pay. Now Organizadora has to refund one and apologize. Variants:
- Vendor A reserves but doesn't pay within 15 min. The TTL doesn't release the lot — it stays "pending" forever. Lot #42 is now unsellable.
- Vendor A's payment fails (PIX timeout). The reservation isn't rolled back. Same outcome.
- The plan UI shows "available" because it cached the floor plan client-side and didn't subscribe to updates.

**Why it happens:**
- Naive flow: `SELECT status FROM lotes WHERE id=42` → application checks `if status == 'free'` → `UPDATE lotes SET status='reserved'`. Time-of-check vs. time-of-use (TOCTOU) race.
- No transactional locking — the read and the write are in separate transactions.
- TTL released by application timer (in-memory `setTimeout`) instead of a server-side scheduled job. App restart loses the timers.
- Payment is treated as fire-and-forget instead of a SAGA with compensation.

**How to avoid:**

1. **Transactional reservation with `SELECT ... FOR UPDATE`**:
   ```sql
   BEGIN;
   SELECT id, status FROM lotes
     WHERE id = $1 AND tenant_id = current_setting('app.current_tenant_id')::uuid
     FOR UPDATE;
   -- application checks status = 'free'
   INSERT INTO reservas (lote_id, fornecedor_id, expires_at, status)
     VALUES ($1, $2, now() + interval '15 minutes', 'pending');
   UPDATE lotes SET status='reserved' WHERE id=$1;
   COMMIT;
   ```
   The row lock blocks the second vendor's transaction until the first commits or rolls back. The second vendor then sees `status='reserved'` and is told the lot was just taken.

2. **Server-side TTL cleanup**: a scheduled job (Postgres `pg_cron` or River/Graphile recurring job) runs every minute:
   ```sql
   UPDATE lotes SET status='free'
     WHERE id IN (
       SELECT lote_id FROM reservas
       WHERE status='pending' AND expires_at < now()
     );
   UPDATE reservas SET status='expired'
     WHERE status='pending' AND expires_at < now();
   ```
   This guarantees release even if the API server is down.

3. **SAGA pattern for payment**: state machine `pending → paid → confirmed` (or `pending → payment_failed → released`). The state transitions are persisted, idempotent, and triggered by webhook receipt OR scheduled timeout.

4. **Optimistic UI with server reconciliation**: when a vendor clicks "Reserve", show "Reserving..." then trust the server response. Use Postgres `LISTEN/NOTIFY` or WebSocket push to update other open clients in real time.

5. **Compensation log**: every state change writes to `reservas_log` (append-only) with timestamp, actor, before/after. This is the audit trail when a vendor disputes "I reserved first".

**Warning signs:**
- Reservation logic does `SELECT` then `UPDATE` without `BEGIN ... FOR UPDATE ... COMMIT`
- TTL is implemented with `setTimeout`, `time.AfterFunc`, or an in-process scheduler
- Load test (10 concurrent clients reserving the same lot) is not in the test suite
- A reservation table has no `expires_at` column
- The floor-plan UI doesn't reload on focus / doesn't subscribe to updates

**Phase to address:**
**Phase 1 (initial reservation flow, even if pre-payment) and Phase 2 (Fornecedor self-service checkout)** — the locking pattern must exist from the first reservation feature. Load test the race condition before shipping Phase 2 to production.

---

### Pitfall 4: PIX Webhook Not Idempotent → Double-Charge / Double-Confirmation

**What goes wrong:**
The PIX gateway (Mercado Pago, Pagar.me, Stripe BR, Asaas, etc.) retries webhooks on any non-2xx response. It also retries when its retry policy fires regardless of your response (some gateways send "at-least-once" deliberately). Your webhook handler:
- Marks the reservation `paid`
- Sends the confirmation email
- Generates the contract PDF
- Credits the platform commission

On the second delivery, all of this happens again. Double email, double PDF, double commission credit. If the handler also calls back to the gateway to "complete capture", you can double-charge.

PIX-specific variants:
- PIX QR Code expiry on the gateway differs from your stored expiry. Vendor scans an "expired" QR (per your clock) but the gateway accepts it. Your system shows "expired" while the money has been transferred.
- PIX has no "authorize then capture" — it's instant transfer. Refund is a separate API. If your reservation rollback only "cancels", the money is still in the merchant account.
- Webhook signature verification skipped because "the URL is secret enough". An attacker who guesses the URL fires fake webhooks marking reservations as paid.

**Why it happens:**
- Developer treats webhook as a function call (must return success once); gateway treats it as event delivery (will retry until acked, may deliver twice anyway).
- "First write wins" is the default DB behavior — repeated INSERTs add duplicate rows.
- Webhook handler does the work synchronously instead of acking fast and enqueueing.

**How to avoid:**

1. **Idempotency key from the gateway**: every PIX gateway provides a payment ID (`transaction_id`, `payment_id`, `e2eId`). Store it as `UNIQUE` on the `pagamentos` table:
   ```sql
   CREATE TABLE pagamentos (
     id uuid PRIMARY KEY,
     tenant_id uuid NOT NULL,
     gateway_payment_id text NOT NULL,
     gateway text NOT NULL,
     UNIQUE (gateway, gateway_payment_id),
     ...
   );
   ```
   Webhook handler does `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. If no row returned, this is a duplicate — return 200 and exit.

2. **Webhook handler returns 200 fast, enqueues work**:
   - Verify signature (HMAC-SHA256 with shared secret — every gateway provides this; never skip).
   - Persist raw payload to `webhook_events` table with `UNIQUE (gateway, gateway_event_id)`.
   - Return 200.
   - A worker picks up `webhook_events` and processes the business logic (transition reservation, send email, etc.) — itself idempotent.

3. **Idempotent business logic**:
   - "Send confirmation email" checks `confirmacao_enviada_at IS NULL` and uses `UPDATE ... WHERE confirmacao_enviada_at IS NULL` returning affected rows. If 0 rows, already sent.
   - "Credit commission" uses the payment ID as the source of the credit and a UNIQUE constraint on `(payment_id, credit_type)`.

4. **Signature verification mandatory**: every webhook endpoint validates the HMAC. CI test asserts that a request without a valid signature returns 401. Document the secret in `.env.example` as required, never optional. [VERIFY-PHASE: confirm exact signature scheme per chosen gateway when Phase 2 starts]

5. **PIX clock skew**: store the gateway's expiry timestamp, NOT your own computed one. Show the gateway's clock to the user. When the user clicks "I paid", call the gateway's status endpoint as source of truth.

6. **Refund modeled explicitly**: a "release reservation" action does NOT touch the money. A "refund payment" action calls the gateway refund API and stores `estorno_id`. Reservations only release after the refund webhook confirms the money returned. The data model has `reservas.status` AND `pagamentos.status` as independent state machines linked by `reserva_id`.

7. **Chargeback / contestation flow**: a separate state `pagamento.status = 'contestado'` triggered by the gateway's chargeback webhook. Does NOT auto-release the reservation — operations team decides.

**Warning signs:**
- Webhook handler does business logic inline (sends email, generates PDF) before returning
- `pagamentos` table has no UNIQUE constraint on `(gateway, gateway_payment_id)`
- Webhook test in suite doesn't include "same event delivered twice"
- Signature verification is "optional" or guarded by an env flag (someone WILL turn it off)
- Refund logic doesn't exist or is "we'll do it manually in the gateway dashboard"

**Phase to address:**
**Phase 2 (Fornecedor checkout — PIX/Cartão integration)** — webhook idempotency, signature verification, and the SAGA between reservation and payment are non-negotiable for Phase 2 shipping. Plan a dedicated "payments hardening" spike inside Phase 2.

---

### Pitfall 5: LGPD Non-Compliance → ANPD Fine (up to R$50M per infraction)

**What goes wrong:**
The platform handles vendor CPF/CNPJ, attendee email/phone/CPF, payment data, and behavioral analytics. LGPD requires:
- Lawful basis recorded per data category
- Consent captured granularly (analytics ≠ marketing ≠ transactional)
- Right to access, rectify, delete (direito ao esquecimento)
- Data breach notification within reasonable time
- DPO (encarregado) appointed
- Records of processing activities (ROPA)
- Cross-border transfer safeguards (Stripe, SendGrid, Z.AI are US-based)

Common failures:
- Single "I agree to terms" checkbox covers consent for everything → not granular → invalid consent.
- Cookie banner blocks analytics but not transactional cookies — confused with consent for data processing.
- "Delete my account" UI exists but only soft-deletes; backups retain data forever.
- Audit logs say "retain 5 years for fiscal compliance" but the same row has personal data the user asked to delete → conflict.
- Vendor data exported to Z.AI for AI features without DPA / cross-border safeguard.

**Why it happens:**
- LGPD is treated as "check the cookie banner box and move on".
- Developers don't model consent as data — it's hardcoded as a boolean.
- Backup/retention policy is never written down.
- AI integration was added without a privacy review.

**How to avoid:**

1. **Consent as first-class data**: table `consents` with `(user_id, category, granted_at, revoked_at, version, source)`. Categories: `transacional`, `analitico`, `marketing`, `terceiros`. Every consent capture writes a row. Every UI that depends on consent reads from this table.

2. **Lawful basis registry**: a static document (committed in `.planning/lgpd/lawful-basis.md`) listing every data category and its LGPD Article 7 / Article 11 basis. Reviewed quarterly.

3. **Direito ao esquecimento implemented as a workflow**, not a button:
   - User requests deletion → ticket created → identity confirmed → soft delete (30 days) → hard delete from all tables + backups exclusion → audit log entry "deletion_completed" with no PII, just timestamps and the ticket ID.
   - Backups: rotating policy (30 days max for live backups; older snapshots are encrypted offline and deletion-on-request requires restore-mask-rebackup).

4. **PII inventory**: every PostgreSQL column containing PII is tagged in a comment:
   ```sql
   COMMENT ON COLUMN fornecedores.cpf IS 'pii:cpf;basis:art7-V-execucao-contrato;retention:5y-pos-encerramento';
   ```
   A script extracts these comments into the ROPA document.

5. **Cookie consent ≠ data processing consent**. Two separate banners / screens. Cookie banner only blocks non-essential cookies. Data processing consent is captured during signup with a granular UI per category. ANPD guidance is explicit on this distinction.

6. **Cross-border transfers**: if Stripe / SendGrid / Z.AI are used, the LGPD requires a transfer mechanism (standard contractual clauses or adequacy decision). Document in `.planning/lgpd/transfers.md`. Prefer Brazilian providers where viable (Mercado Pago, Pagar.me, Asaas for payments; Brevo/Mailgun BR or local SMTP for email; consider Brazilian LLMs for AI features in Phase 3+).

7. **Audit log retention**: tag audit rows with `pii_level` (`none`, `pseudonymized`, `full_pii`). Rows with `full_pii` follow the user's retention policy; rows with `none` (e.g., "user X did action Y at time Z" without identifiable detail) can be kept for fiscal compliance.

8. **Data subject request endpoint**: `GET /api/lgpd/me/data` (export user's full data as JSON) and `POST /api/lgpd/me/delete` (initiate deletion workflow). Authentication required. Time-to-respond SLA: 15 days per LGPD.

**Warning signs:**
- Signup form has one "I agree" checkbox covering everything
- Delete account is a UI button that just sets `deleted_at`
- Backups have no retention policy in writing
- No DPA (data processing agreement) on file for SaaS vendors used
- The phrase "we'll handle it manually if anyone asks" appears in any discussion

**Phase to address:**
**Phase 1 (foundation — consent infrastructure, lawful basis registry, PII tagging)**. **Phase 4 / Ongoing (full direito ao esquecimento workflow, DPA inventory, ROPA generation)**. The infrastructure ships in Phase 1 because retrofitting consent into a working database is brutal.

---

### Pitfall 6: Pilot-Event Operational Collapse (900k attendees, solo dev, single point of failure)

**What goes wrong:**
Festa de Trindade day arrives. At 6 AM the ticket sales page is featured on Instagram. Traffic spikes 50x baseline. The database connection pool exhausts at 25 connections (FB_APU04 default). New requests queue, then 503. The cache stampedes when the homepage TTL expires — 100 requests hit Postgres for the same query. Then the Wi-Fi at the venue dies and the check-in app, which assumed online connectivity, refuses to scan QR codes. Lines form at the entrance. The solo dev has no incident playbook, has not slept in 30 hours, and is debugging in production.

**Why it happens:**
- "It worked in dev" with one tenant and ten users.
- No load test was run because there was no time.
- No incident playbook because solo dev = no on-call rotation.
- Check-in app was designed online-first because that's the happy path.
- Connection pool tuned for steady state, not spikes.

**How to avoid:**

1. **Load test EVERY phase before it goes to the pilot**:
   - Phase 1: 100 concurrent organizer admin sessions
   - Phase 2: 1000 concurrent vendor checkouts
   - Phase 4: 10000 concurrent ticket buyers; 50000 concurrent check-in scans
   - Use `k6` or `locust`. Run from a separate machine. Test the actual production database, not local.

2. **Connection pool sized for spikes, NOT steady state**:
   - Postgres `max_connections`: 200 (managed Postgres tier should support this)
   - App pool: `MaxOpenConns=50` baseline; configure via env var (FB_APU04's mistake was hardcoding 25 — CONCERNS.md scaling section).
   - Use **PgBouncer in transaction-pooling mode** in front of Postgres. App talks to PgBouncer; PgBouncer multiplexes to Postgres. This is the #1 fix for spike scenarios.

3. **Read replica for hot read paths**:
   - Event landing page, available lots, ticket counts → read replica
   - Reservation / payment writes → primary
   - Route via app-level toggle, not magic ORM (be explicit).

4. **Cache stampede prevention**:
   - Use `single-flight` / "request coalescing" for hot keys (one request fetches from DB, others wait for that result).
   - Stale-while-revalidate (SWR): serve stale data and refresh in background.
   - Pre-warm critical caches before known traffic spikes (timed announcement, social media post).

5. **Offline-first check-in**:
   - Check-in app downloads the full ticket list for the event before the venue (LocalStorage / IndexedDB).
   - Scan validates against local list, marks as `used` locally with timestamp.
   - Sync to server when connectivity returns; conflict resolution: first-scan-wins by timestamp; duplicates flagged for review.
   - Test the app with airplane mode ON before pilot day.

6. **Rate limit at the edge**:
   - Cloudflare / nginx / API gateway rate limits per IP for public endpoints.
   - Per-user rate limits inside the app.
   - Per-tenant quotas to prevent one tenant from DoS'ing the platform.

7. **Incident playbook for solo dev** (`.planning/runbooks/event-day.md`):
   - Pre-event checklist: backup taken, connection pool sized, alerts configured, escalation contact (the user — Claudio's mobile).
   - Top 10 failure modes with copy-paste recovery commands.
   - Read-only mode toggle: env var that disables writes, returns "system in maintenance" for write endpoints. This is the nuclear option to keep read paths alive while debugging.
   - Status page (separate domain, static, doesn't depend on the app) for vendor/attendee communication.

8. **Two-person rule for event day**: solo dev cannot also be the live support contact. Pre-arrange a non-technical operator (Organizadora's staff) to handle vendor calls so the dev can focus on the system.

9. **Boring tech for the critical path**: no exotic dependencies for ticketing/check-in. Postgres + a single Go binary + nginx. The fewer moving parts, the fewer failure modes.

10. **Health/readiness probes that are honest**:
   FB_APU04 mistake (CONCERNS.md): "If `DATABASE_URL` is wrong, the API process keeps retrying every 5s forever, returning HTTP 503 to all clients. Nothing in the logs distinguishes 'DB not ready yet' from 'credentials are wrong, will never work'." For FB_EVENTOS: cap retries at 60s, fail-fast on bad config so the orchestrator marks the deploy failed.

**Warning signs:**
- No load test has been run on Phase 4 features
- Connection pool size is hardcoded (or default 25)
- Check-in app requires connectivity to scan
- "What do we do if Postgres goes down?" has no answer
- The day-of contact for vendor support is the same person as the dev

**Phase to address:**
**Phase 4 (public marketplace + ticketing — the spike scenario)** — load testing + offline-first + read replica + incident playbook are part of Phase 4 ship criteria. **Ongoing** — connection pool sizing and PgBouncer ship in Phase 1 infrastructure.

---

## Moderate Pitfalls

### Pitfall 7: Floor-Plan Data Model Locked to 2D (no migration path to 3D)

**What goes wrong:**
v1 ships with a `lotes` table that stores `(x, y, width, height)` as the lot geometry. When v2 wants 3D (CAD/BIM import), the schema can't represent walls, ceilings, multiple floors, or 3D coordinates. Migration requires rewriting every query, every UI component, and re-mapping every existing event's plan.

**How to avoid:**
- Store geometry as **`jsonb` or PostGIS `geometry`** from day one. `jsonb` with a discriminator field: `{"version": 1, "type": "rect2d", "x": ..., "y": ..., "w": ..., "h": ...}`. Adding `{"version": 2, "type": "polygon3d", "vertices": [...]}` later is additive, not breaking.
- Separate `lotes` (logical lot, ID, name, status, tenant_id) from `lote_geometrias` (rendering data, versioned). The status/booking logic is geometry-agnostic.
- Add `z`/`floor` columns now (default 0) — even if 2D, the column exists so v2 doesn't ALTER TABLE on production.
- PostGIS adds complexity but is the right answer if 3D is a real roadmap item. [VERIFY-PHASE: confirm PostGIS extension is available on the chosen Postgres tier]

**Phase to address:** Phase 1 (data model decisions are irreversible once production data lands).

---

### Pitfall 8: Sympla / Eventbrite Integration Without Reconciliation Strategy

**What goes wrong:**
Phase 4 adds "publish ticket batches to Sympla and Eventbrite". The same ticket batch (200 tickets) is now sellable on three platforms simultaneously. Race conditions: ticket sold on Sympla, webhook arrives 30 seconds later, in that window FB_EVENTOS sells the same ticket. Result: oversold event, refunds, vendor reputation damage.

Variants:
- Sympla API rate limits hit during a flash sale → sync delayed → oversold.
- Sympla webhook signature not verified → spoofed webhooks trigger fake sales.
- Sympla v1 deprecated, v2 has different schema → integration breaks one weekend without notice.
- "Sync conflicts" silently resolved by "last write wins" → wrong winner.

**How to avoid:**
- **Authoritative system = FB_EVENTOS.** External platforms get a sub-allocation. Sympla gets 100 tickets pre-allocated; once those are sold, Sympla returns "sold out" while FB_EVENTOS may still have inventory. Reconciliation is one-way (external → us, never us → external mid-sale).
- **Webhook signature verification mandatory** — same rule as PIX gateway.
- **Idempotent sale records** keyed on `(external_platform, external_order_id)` with UNIQUE constraint.
- **Reconciliation report run daily** — compare what FB_EVENTOS thinks sold vs. what Sympla reports. Flag deltas for ops review.
- **API version pinning** — explicitly request `?api_version=2` (or header), and have a CI test that asserts the integration still works against the pinned version. [VERIFY-PHASE: confirm current Sympla/Eventbrite API version when Phase 4 starts]
- **Circuit breaker** — if Sympla API is down, do NOT block FB_EVENTOS native sales. Queue the publish, retry, alert ops.

**Phase to address:** Phase 4 (ticketing + external publish).

---

### Pitfall 9: Subscription + Commission Billing Confusion

**What goes wrong:**
Organizadora pays R$500/month subscription. ALSO pays 5% commission on every space sold, 3% on tickets, 2% on labor. When does each apply? What if the subscription is paid but commissions are unpaid? Does failed subscription = suspend account, or just block new events? Plan changes mid-month: prorate, or full charge next cycle? Different gateways (PIX for one-off, recurring billing for subscription) → reconciliation nightmare.

**How to avoid:**
- **Two billing engines, not one**: `subscriptions` (recurring, idempotent monthly cycle) and `transactional_fees` (per-event commissions, computed at payment-confirmed time).
- **Explicit billing model document** in `.planning/billing/model.md` answering: dunning policy, suspension threshold, proration policy, refund policy, gateway routing per type.
- **State machines**: `subscription.status ∈ {trial, active, past_due, cancelled, suspended}`; `tenant.status ∈ {active, restricted, suspended}` (tenant status drives feature access, NOT subscription status directly — gives flexibility for "let them in to download data even if suspended for billing").
- **Dunning**: failed subscription payment → email + retry in 3/7/14 days. After day 21, suspend new event creation but allow existing events to run (don't break the pilot client).
- **Single gateway for both flows ideally**: Pagar.me, Stripe, Asaas can do both subscription + one-off PIX. Use one vendor to avoid reconciliation across two ledgers. [VERIFY-PHASE: confirm subscription support on chosen gateway].

**Phase to address:** Phase 3 (commission billing) introduces this. Subscription billing likely a Phase 4 or post-pilot concern. Get the data model right in Phase 1 (don't bake "single plan" assumptions into tenant table).

---

### Pitfall 10: Solo-Dev Over-Engineering (microservices, k8s, premature optimization)

**What goes wrong:**
Solo dev with 3 months reads about "12-factor", microservices, Kubernetes, event sourcing, CQRS, hexagonal architecture. Starts implementing all of it. Ships nothing in time for Festa de Trindade. Or ships an over-architected v1 that takes a week to add a column to a form.

FB_APU04 lesson (inverse): FB_APU04 shipped pragmatic Go monolith + React SPA + Postgres + Docker. That stack is the reason it works at all despite its other problems.

**How to avoid:**
- **Monolith first.** Single Go binary (or Node/Elixir — to decide in STACK research). One Postgres. One Redis maybe. One container per process type (API, worker, cron). Done.
- **No Kubernetes for v1.** Coolify (FB_APU04 pattern) or Render/Fly.io. Single-node is fine for the pilot.
- **No microservices.** Modular monolith with clear package boundaries (e.g., `events/`, `vendors/`, `payments/` in separate Go packages) — split later only if a real scaling reason emerges.
- **Defer caching.** Hit Postgres directly until profiling shows a real hot path. FB_APU04 provisioned Redis and never wired it — that's the right order (provision capability, defer use).
- **Defer queue infrastructure.** If River/Graphile-Worker fits, that's already enough. Don't add Kafka/NATS for "future flexibility".
- **YAGNI white-label.** White-label features for tenants you don't have yet are speculative. Build for the pilot. Add white-label when tenant #2 demands it.
- **Tests not skipped.** "I'll add tests later" is the lie that sank FB_APU04 (zero Python tests, almost no Go tests). FB_EVENTOS: every PR ships with tests OR is explicitly marked `EXPERIMENT` and reverted within a week. Minimum test gate: tenant isolation tests for every new handler, even if "skip rest for now".

**Warning signs:**
- A "platform" or "infrastructure" task is on the roadmap with no business value attached
- More than 3 services in the docker-compose
- Configuration file >100 lines for v1
- Phase 1 ETA slipping with "but I need to set up X first"

**Phase to address:** Ongoing discipline. Phase 0 (project setup) should explicitly resist temptations.

---

### Pitfall 11: Bus Factor 1 — Knowledge Only in the Dev's Head

**What goes wrong:**
Solo dev gets sick / takes a week off / loses interest. The system runs. Nobody else can change a single line. Documentation is "I'll write it later". When (not if) the dev needs help, the user (Claudio) cannot bring in even an AI assistant effectively because nothing is documented.

**How to avoid:**
- **GSD-style decision logs** as already implemented in PROJECT.md → continue.
- **README in every package** with one paragraph: "what this does, where it fits, gotchas".
- **`.planning/runbooks/`** directory: how-to for backups, restore, deploy, rollback, common incidents.
- **AI-readable docs**: `.planning/` is structured so Claude Code can pick up context. Keep this discipline.
- **One-shot setup script**: `make dev` (or `./scripts/setup.sh`) gets a new dev (or new Codespace) running in one command. FB_APU04 has 6 env templates with conflicting values — anti-pattern.
- **Commit messages explain WHY, not what.** Future-you will thank present-you.

**Phase to address:** Phase 0 / Ongoing.

---

### Pitfall 12: SEO / Mobile Performance on the Public Marketplace

**What goes wrong:**
Phase 4 ships a public marketplace as a SPA. Google can't index it well. Brazilian mobile users (60%+ of traffic, often on 3G in event venues) wait 8 seconds for the bundle. Event organizer's marketing money is wasted because their event page ranks #50 in Google for the event name.

**How to avoid:**
- **SSR or SSG for public pages**: Next.js / Remix / SvelteKit / Astro. The marketplace, event landing pages, vendor profiles must be server-rendered for SEO. The vendor/admin app can stay SPA.
- **Structured data (JSON-LD)** for `Event`, `Offer`, `Place` schemas → Google rich results.
- **Sitemap.xml + robots.txt** generated dynamically per tenant subdomain (or path) and updated when events publish.
- **Performance budgets**: LCP <2.5s on mobile 3G; CLS <0.1; INP <200ms. CI runs Lighthouse on PRs.
- **Image optimization**: lazy load, WebP/AVIF, responsive `srcset`.
- **Defer 3rd-party scripts** (analytics, chat widgets) below the fold.

**Phase to address:** Phase 4 (marketplace launch).

---

### Pitfall 13: Watchtower Auto-Pull `:latest` (one bad release reaches everyone in 5 minutes)

FB_APU04 lesson: `installer/aws-bridge/docker-compose.yml:18-28` runs Watchtower polling `:latest` every 5 minutes with no canary. CONCERNS.md: "A bad bridge release reaches every tenant simultaneously."

**How to avoid:**
- Pin to semantic version tags (`:1.4.2`) not `:latest`.
- Canary tenant gets new versions first; promote after 24h soak.
- Health checks gate the rollout — Coolify rollback on probe failure.
- Manual deploy gates for production; automated for staging only.

**Phase to address:** Phase 1 deployment infrastructure.

---

### Pitfall 14: Destructive Admin Endpoints Without Guardrails

FB_APU04 lesson: `/api/admin/reset-db` truncates everything with no confirmation token, no backup, no DB allow-list. Caused the 2026-05-07 incident — 4 months of production data destroyed.

**How to avoid (for FB_EVENTOS):**
- No destructive endpoint exists in the public API at all in Phase 1. "Delete event" soft-deletes; hard delete is an offline ops task.
- If a destructive endpoint becomes necessary later:
  - Two-step token (`prepare` → `confirm` with TTL).
  - Mandatory `pg_dump` before destructive op (block if backup fails).
  - DB name allow-list check at startup (`ALLOWED_DESTRUCTIVE_DBS`).
  - Audit log row in `destructive_actions` table.
  - Soft delete + scheduled hard delete pattern (gives time to undo).

**Phase to address:** Phase 1 (set the policy now: no destructive endpoints).

---

## Minor Pitfalls

### Pitfall 15: Migration Runner Destructive Self-Heal

FB_APU04 lesson: migration runner DROPs `schema_migrations` if column types mismatch. **For FB_EVENTOS**: never DROP in self-heal logic — ALTER or fail loudly.

### Pitfall 16: Hardcoded Fallback DB Strings in Tools

FB_APU04 lesson: tools default to `postgres://postgres:postgres@localhost:5432/<wrong_db>`. **For FB_EVENTOS**: tools panic if `DATABASE_URL` unset. No silent fallback.

### Pitfall 17: Multiple Conflicting `.env.*` Templates

FB_APU04 lesson: 6 env files with overlapping/conflicting defaults caused the 2026-05-07 misconfig. **For FB_EVENTOS**: exactly two committed templates: `.env.example` and `.env.production.example`. CI lint checks they share the same variable names.

### Pitfall 18: CSRF Protection Missing on Destructive Endpoints

FB_APU04 lesson: bearer-JWT-only auth, no `SameSite=Strict`, CSP allows `unsafe-inline`. **For FB_EVENTOS**: `SameSite=Strict` cookies, strict CSP, double-submit token for destructive ops.

### Pitfall 19: Unstructured Logging, No Request ID

FB_APU04 lesson: `log.Printf` to stdout, no correlation IDs. **For FB_EVENTOS**: structured JSON logs (`slog` in Go / `pino` in Node), `request_id` middleware that propagates to all downstream calls (DB queries, gateway calls, worker jobs).

### Pitfall 20: No Error Tracking (Sentry-style)

FB_APU04 lesson: no Sentry/Rollbar. Errors discovered by user complaints. **For FB_EVENTOS**: Sentry (or GlitchTip self-hosted) from Phase 1.

### Pitfall 21: Watchman/Watch-Style Infinite Retry Loops Hiding Config Errors

See FB_APU04 `backend/main.go:62-109` — infinite DB retry on bad config. **For FB_EVENTOS**: bounded retries with fail-fast.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode tenant_id in queries instead of RLS | Fewer Postgres concepts to learn | Every new handler must remember to scope; one miss = data leak | **Never** — RLS from day one |
| Skip webhook signature verification "for testing" | Faster local dev | Forgot to re-enable in prod; spoofed webhooks possible | **Never** in committed code — use a feature flag default-off and CI test that asserts it's on in prod env |
| Soft delete only, no hard delete | Faster to ship; reversible | LGPD direito ao esquecimento can't be honored | **Phase 1-3** OK; Phase 4 must implement hard-delete workflow before pilot |
| Single env var for "is admin" | Quick to gate features | Hard to add finer roles later | **Never** — use `roles` table from day one |
| Hardcoded gateway IDs in code | Fast PIX integration | Test mode vs prod swap risk; multi-tenant gateway accounts impossible | **Never** — gateway config per-tenant in DB |
| One-tenant integration tests | Faster test suite | Cross-tenant leak bugs ship | **Never** — two tenants in fixtures from PR #1 |
| `:latest` Docker tag deploy | One-line CI | Bad release ships everywhere in minutes | **Staging only** — production uses semver tags |
| `postgres` superuser as app DB user | Easier setup | If app compromised, full DDL on data | **Local dev only** — prod uses limited role |
| In-process job queue (Go channel) | No new infra | Lost jobs on restart; not horizontally scalable | **Phase 0 prototype only** — Phase 1 uses Postgres-backed queue |
| Skip tests "for now" | Faster ship | Tests never come; refactor terrifying | **Never** for handlers touching money, auth, tenancy, RLS |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| PIX gateway (Mercado Pago / Pagar.me / Asaas) | Treating webhook as exactly-once | Idempotency key on UNIQUE constraint; webhook handler returns 200 fast, enqueues work |
| PIX gateway | Skipping HMAC signature check | Verify on every webhook; CI test asserts 401 on missing/bad signature |
| Credit card gateway | Storing card data on our side (PCI scope) | Tokenize on the gateway; we store only the token. Never log full PAN/CVV. |
| Credit card antifraude | Showing "Generic Error" on rejection | Map gateway reason codes to user-friendly messages; some reasons require contacting issuer |
| Sympla / Eventbrite | Two-way sync of inventory | One-way pre-allocation; FB_EVENTOS is source of truth |
| Sympla / Eventbrite | No API version pin | Pin version explicitly; CI test against pinned version |
| Z.AI / OpenAI / Anthropic | PII sent to LLM without DPA | Cross-border DPA in place; strip/pseudonymize PII before send |
| Z.AI / OpenAI / Anthropic | Synchronous LLM calls in HTTP handlers | Enqueue; respond async; show progress to user |
| SMTP (Hostinger / Brevo / SendGrid) | "Send email" fire-and-forget in handler | Enqueue email; retry on failure; track delivery status |
| SMTP | Hardcoded From/Reply-To | Per-tenant From (with SPF/DKIM verified) for white-label |
| Cloud storage (S3 / Cloudflare R2 / MinIO) | Public bucket for uploads | Pre-signed URLs; bucket private by default |
| Cloud storage | Path-traversal in filename | `filepath.Clean`, verify result is inside upload root; UUID-named keys |
| ERP (NFe Phase 2+) | Plain credentials in YAML | Encrypted at rest (AES-GCM); fetched from API at runtime; rotated quarterly |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 queries on event listing | Listing 100 events fires 100+ queries | Eager load with JOIN or batch loader pattern | ~50 concurrent admin sessions |
| Missing index on `tenant_id` | Queries slow as tenant count grows | `CREATE INDEX ON foo(tenant_id)` on every tenant-scoped table | ~10 tenants × 100k rows |
| Cache stampede on event page | 100 reqs hit DB when TTL expires | Single-flight / request coalescing; SWR | First viral event |
| Materialized views refreshed inline in HTTP handler | Long response times during refresh; reader locks | Refresh in worker; CONCURRENTLY; advisory locks (FB_APU04 mistake — CONCERNS.md performance section) | Any production scale |
| Connection pool too small | 503s under spike load | Size pool for spike; PgBouncer transaction pooling | Any flash sale moment |
| Full-table scan on `events` for search | Search slow as event count grows | `pg_trgm` index for fuzzy text; `tsvector` for full-text | ~10k events |
| JSON fields without GIN index | `WHERE jsonb_field @> ...` table-scans | `CREATE INDEX ... USING GIN (jsonb_col)` | ~100k rows in the table |
| Unbounded result sets (no LIMIT) | Memory blowup; OOM kills | Always paginate; cursor-based for large sets | Variable; one bad event |
| Whole-result fetch on import (FB_APU04 SAP query mistake) | OOM during large historical imports | Stream cursor in chunks; update watermark per chunk | Variable |
| Pagination with `OFFSET` on large tables | Slows linearly with offset depth | Keyset pagination (`WHERE id > $last_id`) | ~50k offset |
| Sending PDF inline in HTTP response | Slow response; server holds memory | Generate in worker; store in S3; return URL | Any production scale |
| Synchronous email send in checkout | Checkout slow when SMTP is slow | Enqueue email; respond immediately | SMTP outage |
| 3D CAD import without size limit (v2 risk) | OOM on large IFC files | Max file size; offload parsing to worker with memory limit | First customer trying real BIM |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Tenant ID in URL/header without verification against JWT | Trivial cross-tenant access | Resolve tenant from JWT signed claim; ignore header/URL hints |
| RLS not `FORCE`-enabled | Table owner bypasses RLS | `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every tenant table |
| Workers run as `postgres` superuser (FB_APU04 mistake) | Worker compromise = full DDL | Dedicated `fb_eventos_app` role with limited grants |
| JWT secret in committed `.env` (FB_APU04 risk) | Secret leak → full impersonation | Secrets only in Coolify/Vault; CI gitleaks scan |
| Plaintext gateway credentials in DB | Breach = all gateway keys exposed | AES-256-GCM at rest with dedicated `ENCRYPTION_KEY` (not JWT_SECRET fallback) |
| CSP `'unsafe-inline'` (FB_APU04 mistake) | XSS bypasses CSP | Nonce-based CSP; no inline scripts |
| Cookies without `SameSite=Strict` | CSRF on destructive ops | `SameSite=Strict` for admin sessions; double-submit token for destructive endpoints |
| File upload with no MIME / size validation | RCE via uploaded PHP; storage DoS | Whitelist MIME types; cap size; store outside web root; UUID filenames |
| Path traversal in delete-by-filename (FB_APU04 fragile area) | Arbitrary file delete | `filepath.Clean`; verify inside upload root |
| Public S3 bucket | Vendor docs / floor plans leak | Pre-signed URLs; bucket private by default |
| Webhook URLs as authentication (no signature) | Spoofed webhooks → fake payments confirmed | HMAC signature mandatory on every webhook |
| LGPD PII in unstructured logs | Breach = PII in log aggregator | PII tagging on log fields; redaction middleware |
| Raw JWT claim casts (FB_APU04 dependency risk) | Panic crashes handler | `s, ok := claims["role"].(string); if !ok { ... }` everywhere |
| Auth middleware "admin overrides all" implicit (FB_APU04) | Hard to audit access control | Explicit role list per route; no implicit overrides |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Floor plan only renders on desktop | 60%+ BR traffic is mobile; vendors can't browse on phones | Mobile-first responsive canvas; pinch-zoom, tap-to-select |
| Pagamento PIX without showing QR + copia-e-cola | Vendor can't pay on the same device they're viewing | Show QR for desktop, "copy code" button on mobile, both for safety |
| Reservation expiry timer not visible | Vendor doesn't know they have 15 min left | Live countdown in UI; warning at 2 min remaining |
| Generic "payment failed" message | Vendor doesn't know if to retry, change card, or call bank | Map gateway reasons; "saldo insuficiente" / "antifraude" / "tente novamente" |
| Check-in app shows "scanning..." with no feedback | Operator unsure if it worked; double-scans | Big green check / red X with sound; haptic feedback |
| Long forms for vendor onboarding | Vendor abandons before paying | Multi-step wizard; save progress; allow finishing later |
| No visibility into commission breakdown | Vendor sees "R$1050" without knowing platform took R$50 | Itemized receipt: lot price + service fee + total |
| Cookie banner blocks the whole page | Bounce rate spike | Banner is non-blocking; "essential cookies" allowed by default per LGPD |
| Error messages in English | Brazilian users confused | All user-facing copy in pt-BR; technical errors translated |
| No "test PIX" flow for organizadora | Organizer can't validate setup before pilot | Sandbox mode per tenant; clearly labeled "ambiente de teste" |

---

## "Looks Done But Isn't" Checklist

- [ ] **Multi-tenant isolation:** RLS enabled? Verified via integration test with two tenants?
- [ ] **Multi-tenant isolation:** RLS `FORCE`d? Verified by table owner query returning 0 rows when tenant context not set?
- [ ] **Background workers:** Set `app.current_tenant_id` from job row before executing? Tested?
- [ ] **Webhook handlers:** HMAC signature verification on? CI test asserts unsigned requests rejected?
- [ ] **Webhook handlers:** Idempotent on duplicate delivery? Test sends same payload twice and verifies one effect?
- [ ] **Reservation flow:** `SELECT ... FOR UPDATE` in the transaction? Load test with 10 concurrent reservations of same lot?
- [ ] **Reservation flow:** Server-side TTL cleanup job exists? Tested by setting `expires_at` in the past?
- [ ] **Payment flow:** Refund modeled (not just "cancel")? Refund webhook handled?
- [ ] **LGPD consent:** Granular per category (analitico ≠ marketing ≠ transacional)? Captured as data rows?
- [ ] **LGPD direito ao esquecimento:** Workflow implemented end-to-end? Audit log entry created with no PII?
- [ ] **Migration:** New tenant tables have `tenant_id NOT NULL REFERENCES tenants(id)`?
- [ ] **Migration:** New tenant tables have `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy?
- [ ] **Migration:** New tenant tables indexed on `tenant_id`?
- [ ] **Health check:** Distinguishes "DB not ready" from "DB misconfigured"? Bounded retries?
- [ ] **Deploys:** Semver tag, not `:latest`? Manual gate for production?
- [ ] **Secrets:** Not in committed `.env`? Gitleaks in CI?
- [ ] **CI grep gate:** No `sqlite` / `tracker.*\.db` / `state\.json` references in production code?
- [ ] **Logging:** Structured (JSON)? Request ID propagated?
- [ ] **Backups:** Automated? Tested restore in last quarter?
- [ ] **Floor plan data model:** `jsonb` or PostGIS geometry, not fixed columns? Versioned discriminator?
- [ ] **Checkout UI:** Reservation countdown visible? PIX QR + copia-e-cola both shown?
- [ ] **Public marketplace:** SSR/SSG? Sitemap.xml generated? Lighthouse score gate in CI?
- [ ] **Check-in app:** Offline mode tested with airplane mode? Conflict resolution defined?
- [ ] **Event-day:** Load test run at expected peak? Incident playbook written?

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Embedded-DB shipped to prod | HIGH | Migrate state to Postgres (data export → schema → import → cutover); kill the file dependency in code; backfill via reconciliation; remove `.db` files from disk and CI gate to prevent regression |
| Tenant data leak (cross-tenant query) | VERY HIGH | Disable affected endpoint immediately; query affected rows to identify scope; LGPD breach notification clock starts; notify affected tenants; postmortem; add RLS test that would have caught it |
| PIX double-charge | MEDIUM | Detect via reconciliation report; issue refund via gateway API; credit tenant ledger; postmortem; add idempotency test |
| Floor-plan double-reservation | LOW-MEDIUM | Identify earliest reservation by timestamp; honor that one; refund the other; communicate to losing vendor; add `FOR UPDATE` test |
| LGPD deletion request unhandled | HIGH (regulatory) | Treat as P0; manual process to complete deletion; document in compliance log; implement workflow before next request |
| Event-day connection pool exhaustion | HIGH (during event) | Toggle read-only mode; restart with larger pool; add PgBouncer if not present; status page update; postmortem after event |
| Event-day check-in offline | HIGH (during event) | Paper check-in fallback (printed list of expected attendees); reconcile later; postmortem mandates offline mode for next event |
| Bad release pushed via `:latest` to all tenants | MEDIUM-HIGH | Pin to previous version; rollback; staged rollout policy implemented; canary tenant designated |
| Destructive admin endpoint triggered by mistake | VERY HIGH | Restore from latest `pg_dump`; lose data since backup; implement confirmation token + pre-backup gate (FB_APU04 lesson) |
| Webhook signature spoof exploited | HIGH | Rotate gateway secret; audit affected records; refund where needed; implement and TEST signature verification |
| Cache stampede during launch | LOW-MEDIUM | Restart with single-flight enabled; pre-warm cache for known events; monitor cache hit rates |
| Sympla/Eventbrite sync conflict (oversold) | MEDIUM | Identify which tickets are duplicates; refund duplicates with apology + compensation; switch to one-way pre-allocation model |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| **#1 Embedded-DB trap** | **Phase 0/1** (CI gate, architecture constraint) + Ongoing | CI grep gate passes; no `*.db` in deploys; code review checks |
| **#2 Multi-tenant data leak** | **Phase 1** (RLS + FORCE + dedicated role + middleware) | Two-tenant integration test passes for every handler |
| **#3 Floor-plan race conditions** | **Phase 1** (locking pattern) + **Phase 2** (full SAGA) | Concurrent reservation load test passes |
| **#4 PIX webhook double-charge** | **Phase 2** (idempotency + signature + SAGA) | Webhook replay test asserts one effect; signature test asserts 401 |
| **#5 LGPD non-compliance** | **Phase 1** (consent infra, PII tags) + **Phase 4** (full workflow) | LGPD audit checklist quarterly |
| **#6 Event-day operational collapse** | **Phase 4** (load test, offline, playbook) + **Ongoing** (PgBouncer in Phase 1) | k6 load test at 50k concurrent passes; airplane-mode check-in test passes |
| **#7 2D-only floor-plan model** | **Phase 1** (data model) | `jsonb` geometry + version discriminator in schema; v2 migration design documented |
| **#8 Sympla/Eventbrite sync chaos** | **Phase 4** | Reconciliation report runs daily; one-way pre-allocation enforced |
| **#9 Subscription/commission billing confusion** | **Phase 3** + billing model doc | Two-engine implementation; gateway reconciliation passes |
| **#10 Solo-dev over-engineering** | **Ongoing** | Phase 1 ships on time to Festa de Trindade; complexity audit at each transition |
| **#11 Bus factor 1** | **Phase 0** + **Ongoing** | Runbooks exist; one-shot setup works; commit messages explain why |
| **#12 SEO / mobile performance** | **Phase 4** | Lighthouse mobile >85; LCP <2.5s; sitemap generated |
| **#13 Watchtower `:latest` rollout** | **Phase 1** deployment | Semver tags; canary tenant; rollback drill |
| **#14 Destructive admin endpoints** | **Phase 1** (policy: don't ship them) | No destructive endpoints in production; ops tasks via runbook |
| **#15-21 FB_APU04 inherited hygiene** | **Phase 0/1** | Code review checklist enforces |

---

## FB_APU04 Specific Lessons (Direct Evidence)

Each row maps an observed FB_APU04 failure to the FB_EVENTOS prevention pattern. Sources: `/tmp/FB_APU04/.planning/codebase/CONCERNS.md` and `INTEGRATIONS.md`.

| FB_APU04 issue | What broke | FB_EVENTOS prevention |
|----------------|------------|----------------------|
| `tracker-<config-stem>.db` SQLite watermark, unbounded growth, filename-based isolation, zero tests (CONCERNS.md fragile areas) | Production tenant isolation depends on filename equality; corrupt/lost watermark on container migration; SQLite scaling cliff at 1M rows | **Phase 1**: Postgres `sync_state` table with FK to `tenants`; CI grep gate blocks `sqlite`; integration test for tenant isolation |
| ERP Bridge Oracle drops with `DPY-4011` and aborts whole run (CONCERNS.md known bugs) | Production runs fail mid-import; manual restart; no per-record watermark | **Phase 2+**: when adding any external integration, wrap in retry decorator with exponential backoff; per-record watermark persisted to Postgres |
| `ResetDatabaseHandler` truncates everything without confirmation or backup (CONCERNS.md known bugs) | 2026-05-07 production data loss (4 months) | **Phase 1**: no destructive endpoint exists in v1; if ever added, requires two-step token + pre-`pg_dump` + DB allow-list check |
| Migration runner `DROP TABLE schema_migrations` self-heal (CONCERNS.md known bugs) | Migration history destroyed on column type mismatch | **Phase 1**: `ALTER TABLE` self-heal only; fail loudly on unexpected schema; never DROP system tables in self-heal |
| Hardcoded fallback `postgres://postgres:postgres@localhost:5432/<wrong_db>` in tools (CONCERNS.md tech debt) | Tools silently connect to wrong DB | **Phase 1**: tools panic if `DATABASE_URL` unset; centralized DB helper |
| 6 conflicting `.env.*` templates (CONCERNS.md tech debt) | Contributed to 2026-05-07 misconfig | **Phase 0**: exactly 2 templates (`.env.example`, `.env.production.example`); CI lint enforces same variable set |
| App connects as `postgres` superuser (CONCERNS.md security) | App compromise = full DDL | **Phase 1**: `fb_eventos_migrator` (DDL), `fb_eventos_app` (DML), separated |
| Reset endpoints lack CSRF + `SameSite` not declared (CONCERNS.md security) | Authenticated user visits malicious page → destructive op | **Phase 1**: `SameSite=Strict` cookies; CSP nonce-based, no `unsafe-inline` |
| MV refreshed inline in admin handler, no advisory lock (CONCERNS.md performance) | `ACCESS EXCLUSIVE` lock blocks all readers; competing refreshes | **Phase 1+**: MV refreshes via job queue (River/Graphile); `pg_try_advisory_lock`; always `CONCURRENTLY` |
| Connection pool hardcoded at 25 (CONCERNS.md scaling) | API queues then 503s under spike | **Phase 1**: env-driven pool size; PgBouncer; load test before Festa de Trindade |
| Async DB init with infinite retry hides config errors (CONCERNS.md fragile areas) | 5s loop forever on bad DSN; orchestrator never marks failed | **Phase 1**: bounded retries (max 60s); fail-fast on bad config |
| Watchtower auto-pull `:latest` (CONCERNS.md dependencies at risk) | Bad release reaches every tenant in 5 min | **Phase 1**: semver tags; canary tenant; manual prod gate |
| Raw JWT claim type assertion `claims["role"].(string)` (CONCERNS.md dependencies at risk) | Malformed token can panic handler | **Phase 1**: safe assertion pattern enforced via lint |
| No automated tests beyond one integration test (CONCERNS.md test coverage) | Auth/destructive/migration regressions ship | **Phase 1**: tenant isolation tests + reset flow tests + migration tests are non-skippable |
| No request ID / structured logs (CONCERNS.md missing features) | Cross-service tracing impossible | **Phase 1**: `slog` JSON logs + request ID middleware |
| No error tracking (CONCERNS.md missing features) | Errors discovered by user complaints | **Phase 1**: Sentry / GlitchTip |
| No rate limiting beyond auth (CONCERNS.md missing features) | Logged-in user can hammer AI/expensive endpoints | **Phase 1**: per-route rate limits; per-tenant quotas |
| `auth.go.bak` committed (CONCERNS.md tech debt) | Confusion; potential old-auth disclosure | **Phase 0**: `*.bak`, `*.swp`, `*.orig` in `.gitignore`; pre-commit hook |
| `backend/backend.log` committed (CONCERNS.md tech debt) | Stale provenance; logs in VCS | **Phase 0**: `*.log` in `.gitignore`; enforced |
| `.env` may have been committed historically; live secrets locally (CONCERNS.md security) | Secret leak risk | **Phase 0**: gitleaks in CI; `.env` audit on first commit |

---

## Sources

- **Direct evidence (HIGH confidence):**
  - `/tmp/FB_APU04/.planning/codebase/CONCERNS.md` (audit dated 2026-05-08) — every "FB_APU04 lesson" referenced here is grounded in this document with line numbers
  - `/tmp/FB_APU04/.planning/codebase/INTEGRATIONS.md` (audit dated 2026-05-08) — integration patterns, gateway/auth, observability gaps
  - `/home/claudio/projetos/FB_EVENTOS/.planning/PROJECT.md` — explicit Out-of-Scope and Constraints sections lock the embedded-DB prohibition and PostgreSQL-only rule
- **Training-data knowledge (HIGH confidence on patterns, MEDIUM on specific API behaviors):**
  - PostgreSQL Row-Level Security documentation, `FORCE ROW LEVEL SECURITY` semantics
  - `SELECT ... FOR UPDATE` row-locking and SKIP LOCKED job queue patterns (well-established in Postgres community)
  - Webhook idempotency patterns (Stripe / Mercado Pago / Pagar.me documented these for years)
  - LGPD Articles 7, 11, 18, 41 (data subject rights, lawful bases, encarregado / DPO requirements)
  - SAGA pattern for distributed transactions and compensation
- **Items flagged `[VERIFY-PHASE]`:** PIX gateway exact signature schemes, Sympla/Eventbrite current API versions, PostGIS availability on chosen Postgres tier, gateway subscription support — these depend on current vendor docs and should be re-verified when the owning phase begins. WebSearch was unavailable during this research; the owning phase must consult the chosen vendor's current documentation before implementation.
- **Not consulted (would have been useful):** Live web sources for current PIX SDK behavior, Sympla v2 schema, ANPD recent enforcement actions. Phase owners should validate before implementing.

---
*Pitfalls research for: Brazilian multi-tenant SaaS event management platform (FB_EVENTOS)*
*Researched: 2026-06-11*
