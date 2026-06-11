# Phase 0: Foundation, Stack Lock & Anti-Pitfall Hardening — Research

**Researched:** 2026-06-11
**Domain:** Next.js 15 greenfield bootstrap / Drizzle RLS multi-tenancy / Better Auth / Postgres 16 / Graphile-Worker / CI anti-pitfall gates / Coolify + Traefik deploy / LGPD baseline
**Confidence:** HIGH (stack patterns verified via official docs + npm registry); MEDIUM (Graphile-Worker SQL API details — homepage confirmed features, exact add_job signature is [ASSUMED]); LOW (Coolify-specific Traefik label config — not confirmed from live docs)

---

<user_constraints>
## User Constraints (from CLAUDE.md + STATE.md — project-level stack contract)

### Locked Decisions
- **Stack:** Next.js 15.x (NOT 16), TypeScript 5.6, PostgreSQL 16, Drizzle ORM 0.45.2 + drizzle-kit 0.31.x, postgres.js 3.4.x, Better Auth 1.6.x + organization plugin, Zod 4.4.x, shadcn/ui + Tailwind 4.3, MinIO 8, Resend 6, Pino 10.3, Sentry @sentry/nextjs 10.x, pnpm, Biome, Vitest, Playwright, Coolify + Traefik on Node 22 LTS.
- **Queue (STATE.md reconciliation):** Graphile-Worker (Postgres-backed) instead of BullMQ + Redis. FOUND-14 requires an ADR. BullMQ/Redis is DEFERRED (OUT OF SCOPE for Phase 0).
- **Multi-tenancy:** Row-Level Security (RLS) + `current_setting('app.current_tenant_id')`. FORCED on all tenant-owned tables. Runtime role `fb_eventos_app` has NO `BYPASSRLS`. Migration role `fb_eventos_migrator` is separate.
- **Embedded-DB BAN:** Contractual. `sqlite3`/`@libsql`/`better-sqlite3` banned in package.json, `*.db`/`*.sqlite` files banned in any artifact. CI grep gate required from commit #1.
- **Self-healing migrations forbidden:** `DROP TABLE schema_migrations` or any auto-migrate on boot is banned. Only `drizzle-kit migrate` one-shot per deploy.
- **No secrets in committed files:** `.env.local` gitignored; production secrets in Coolify UI; `gitleaks` pre-commit mandatory.
- **LGPD baseline from Phase 0:** consent_records table, audit_log append-only, soft-delete (`deleted_at`), PII column SQL comments.
- **Tenant routing:** Path-based per TENA-06 (`app.fbeventos.com/{tenant-slug}`) for v1. Subdomain wildcard routing is Phase 4.
- **Docker image tagging:** Semver tags only in production, never `:latest`.

### Claude's Discretion
- Specific Biome config rules and severity levels
- Vitest test file organization conventions
- Dockerfile layer ordering optimizations
- Exact Sentry sampling rates
- GitHub Actions job parallelism structure
- ADR format for FOUND-14

### Deferred Ideas (OUT OF SCOPE for Phase 0)
- 2D floor plan editor (Phase 1)
- Pagar.me payment integration (Phase 1+)
- Konva.js (Phase 1)
- SSE + LISTEN/NOTIFY real-time (Phase 2)
- BullMQ + Redis (superseded by Graphile-Worker decision)
- Subdomain wildcard routing (Phase 4)
- Read replica (Phase 4)
- LGPD direito ao esquecimento workflow (Phase 4)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Repo bootstrapped: Next.js 15 + TypeScript 5.6 + Drizzle ORM + PostgreSQL 16 | Track 1: scaffold command, tsconfig strict, pnpm engines lock |
| FOUND-02 | CI gate blocks `sqlite3`/`@libsql`/`better-sqlite3` in `package.json` | Track 5: grep pattern in GitHub Actions YAML |
| FOUND-03 | CI gate blocks `*.db`, `*.sqlite`, `tracker-*.db` files | Track 5: find/grep pattern in GitHub Actions YAML |
| FOUND-04 | Pre-commit hook with `gitleaks` | Track 5: gitleaks installed via binary (NOT npm) |
| FOUND-05 | Pre-commit hook with Biome (lint) and `tsc --noEmit` | Tracks 1+5: Biome config, tsconfig strict |
| FOUND-06 | Two `.env.example` files (dev + prod) with same keys and explicit placeholders | Track 1: full env var manifest documented |
| FOUND-07 | GitHub Actions pipeline: lint + typecheck + test + build on PR | Track 5: complete CI YAML provided |
| FOUND-08 | Automated deploy via Coolify + Traefik (TLS + host routing) | Track 6: Coolify deploy pattern |
| FOUND-09 | Multi-stage Docker image with semver tag (not `:latest` in prod) | Track 6: Dockerfile multi-stage with standalone output |
| FOUND-10 | Structured JSON logging (Pino) from first request | Track 8: Pino + Next.js instrumentation.ts |
| FOUND-11 | Sentry configured (frontend + backend) | Track 8: @sentry/nextjs wizard setup |
| FOUND-12 | PostgreSQL PITR backup configured (>=7 days retention) | Track 6: Coolify backup / pg_dump pattern [ASSUMED] |
| FOUND-13 | Minimal runbook written (`docs/RUNBOOK.md`) | Track 10: walking skeleton |
| FOUND-14 | ADR registered: Graphile-Worker vs pg-boss | Track 9: queue comparison + recommendation |
| FOUND-15 | Target versions verified live on npm and locked in `package.json` | Researched: all versions verified in this document |
| FOUND-16 | Required Postgres extensions confirmed available (`pgcrypto`, `pg_trgm`) | Track 2: extension creation via migration [ASSUMED availability] |
| AUTH-01 | Organizadora creates account with email + password (Better Auth) | Track 3: Better Auth email+password config |
| AUTH-02 | Email verification link after signup | Track 3: Better Auth emailVerification config |
| AUTH-03 | Password reset by email | Track 3: Better Auth emailAndPassword reset |
| AUTH-04 | Session persists between browser refreshes (Better Auth session in Postgres) | Track 3: drizzleAdapter session storage |
| AUTH-05 | Optional 2FA (TOTP) for organizadora account | Track 3: Better Auth twoFactor plugin |
| TENA-01 | Every domain table has `tenant_id` FK → `tenants` | Track 2: schema skeleton with tenants table |
| TENA-02 | PostgreSQL RLS enabled and FORCED on all tenant-owned tables | Track 2: pgPolicy + FORCE via migration SQL |
| TENA-03 | App DB user connects WITHOUT `BYPASSRLS` (role `fb_eventos_app`) | Track 2: two-role Postgres setup |
| TENA-04 | Migration user connects with separate role `fb_eventos_migrator` with DDL perms | Track 2: two-role Postgres setup |
| TENA-05 | Request middleware does `SET LOCAL app.current_tenant_id = ?` from Better Auth session | Track 4: withTenant() wrapper |
| TENA-06 | Tenant resolution by path (`app.fbeventos.com/{tenant-slug}`) via `middleware.ts` | Track 4: Next.js middleware.ts pattern |
| TENA-07 | Integration test with 2 tenants proves isolation (A cannot see B's data) | Validation Architecture section |
| TENA-08 | Minimum RBAC: roles `owner`/`admin`/`viewer` per organization (Better Auth org plugin) | Track 3: org plugin default roles |
| LGPD-01 | `consent_records` table with versioning | Track 7: consent_records schema |
| LGPD-02 | Cookie consent banner (essential always; analytics/marketing opt-in) | Track 7: client component placeholder |
| LGPD-03 | PII column tags (`COMMENT ON COLUMN`) for inventory | Track 7: SQL comment pattern |
| LGPD-04 | Audit log Postgres table for sensitive ops | Track 7: audit_log schema |
| LGPD-05 | Soft-delete on PII entities (`deleted_at`); hard-delete via async job | Track 7: soft-delete pattern |
| LGPD-06 | Retention policy documented in `docs/LGPD.md` (placeholder until legal review) | Track 7: doc placeholder |
</phase_requirements>

---

## Summary

Phase 0 is a greenfield bootstrap that establishes the contractually safe foundation before any domain feature code is written. The stack is fully locked in CLAUDE.md; Phase 0 research answers the HOW — concrete command sequences, version-specific gotchas, and implementation patterns for each track.

**Critical findings this research surfaced:**

1. **Next.js version pin correction:** Next.js 15 latest is `15.5.19` (not `15.4.x` as CLAUDE.md assumed). The `15.4.x` pin is safe but outdated; `~15.5.19` includes bug fixes and is recommended. CLAUDE.md should be updated to `15.5.x` during Phase 0.

2. **`middleware.ts` → `proxy.ts` rename is Next.js 16 only.** Next.js docs served are for v16.2.9 (latest), which renamed `middleware.ts` to `proxy.ts`. This does NOT apply to Phase 0 — we pin Next.js 15 where `middleware.ts` is still correct. Do NOT rename.

3. **`next-safe-action` latest is `8.5.4` (not `7.x`).** v8 adopts Standard Schema, renames `.schema()` to `.inputSchema()`, and removes the custom `validationAdapter`. Zod 4 is Standard Schema compatible. Recommend pinning `8.5.4`.

4. **`@hookform/resolvers` must be `^5.x` for Zod 4.** The v4.x resolvers only support Zod 3. v5 was released for Zod 4 / Standard Schema.

5. **Graphile-Worker `0.16.6` is the recommended queue (FOUND-14 ADR).** Postgres-backed, MIT license, maintained by Benjie Gillam, supports cron, retry/backoff, transactional enqueueing via SQL function — enables the outbox pattern with zero additional infra. pg-boss `12.18.3` is the alternative (more features, better for multi-master).

6. **`gitleaks` npm package is NOT the security scanner.** Install via GitHub binary releases or `gitleaks/gitleaks-action@v2` GitHub Action.

**Primary recommendation:** Bootstrap with `pnpm create next-app@15`, pin all packages from the verified stack table, create CI anti-pitfall gates before any domain migration, use Graphile-Worker for the job harness, and follow the `middleware.ts`-based path-tenant-resolution pattern.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auth signup/login/session/2FA | API/Backend (Better Auth server) | Next.js App Router (server components read session) | Auth state lives server-side; client only reads session cookies |
| Multi-tenant context (`SET LOCAL`) | API/Backend (postgres.js `withTenant()`) | Next.js middleware (injects `x-tenant-slug` header) | DB-level isolation enforced server-side; middleware only resolves slug |
| Path-based tenant routing | Frontend Server (Next.js `middleware.ts`) | — | URL matching + header injection before page render |
| LGPD consent capture | API/Backend (Server Action + DB write) | Browser/Client (consent banner UI component) | Consent record must be server-persisted; banner is client interaction |
| Audit log writes | API/Backend (Drizzle within Server Action TX) | — | Audit rows are DB writes; never from client |
| Structured logging (Pino) | API/Backend (Node.js server process) | — | Pino is Node.js only; client uses Sentry |
| Error tracking (Sentry) | Browser/Client + API/Backend | — | Both sides instrument independently |
| Background jobs (Graphile-Worker) | API/Backend (separate Node.js process) | — | Worker polls Postgres via LISTEN/NOTIFY; runs outside Next.js request cycle |
| Schema migrations | Build/Deploy (drizzle-kit migrate — CI step) | — | One-shot at deploy; never on app boot |
| CI anti-pitfall gates | CI/CD (GitHub Actions) + pre-commit hooks | — | Grep gates enforce contractual bans |
| Docker build + semver tag | CI/CD (GitHub Actions → GHCR) | — | Build artifacts produced in CI, deployed by Coolify |

---

## Standard Stack

### Core (Phase 0 installs all of these)

| Library | Verified Version | Purpose | Notes |
|---------|-----------------|---------|-------|
| `next` | `15.5.19` | Full-stack framework | Pin `~15.5.19` — NOT `@latest` (resolves to 16). NOT `^15` without upper bound. |
| `react` + `react-dom` | `19.2.7` | UI runtime | Next.js 15.5 peer; Server Components + `useFormStatus`. |
| `typescript` | `5.6.x` | Language | `strict: true`; Drizzle type inference end-to-end. |
| `drizzle-orm` | `0.45.2` | ORM | `pgTable.withRLS()` + `pgPolicy()` for RLS. SQL-first, no decorators. |
| `drizzle-kit` | `0.31.10` | Migrations CLI | `generate` + `migrate` only. Never `push` in production. |
| `postgres` | `3.4.9` | PG driver | Supports `SET LOCAL` and `LISTEN/NOTIFY` natively. Under Drizzle. |
| `better-auth` | `1.6.16` | Auth | Organization plugin = multi-tenant org as tenant. Sessions in Postgres. |
| `zod` | `4.4.3` | Validation | Server Action input + webhook parsing. v4 ~10x faster parse vs v3. |
| `next-safe-action` | `8.5.4` | Type-safe Server Actions | v8 uses Standard Schema (Zod 4 compatible). Breaking vs v7: `.schema()` → `.inputSchema()`. |
| `tailwindcss` | `4.3.0` | Styling | Required by shadcn/ui. Oxide engine = 5-10x faster builds. |
| `shadcn` CLI | `4.11.0` | Component scaffolding | `pnpm dlx shadcn@latest init` initializes Tailwind 4. |
| `@tanstack/react-query` | `5.101.0` | Server-state cache | Install now; needed in Phase 1+ for dashboards and real-time views. |
| `react-hook-form` | `7.78.0` | Forms | Complex forms (floor plan lots Phase 1+). |
| `@hookform/resolvers` | `5.4.0` | RHF + Zod 4 bridge | **Must be `^5.x`** — v4.x only supports Zod 3. |
| `pino` + `pino-pretty` | `10.3.1` | Structured JSON logs | `instrumentation.ts` registers logger; all server code uses it. |
| `@sentry/nextjs` | `10.57.0` | Error tracking | Wizard: `npx @sentry/wizard@latest -i nextjs`. Supports Next.js 13-15. |
| `resend` | `6.12.4` | Transactional email | Better Auth email verification + password reset. |
| `minio` | `8.0.7` | Object storage client | Plantas/contracts (Phase 1). Install now for env manifest completeness. |
| `graphile-worker` | `0.16.6` | Background jobs (Postgres-backed) | Cron, retry/backoff, transactional enqueueing. No Redis needed. |
| `lucide-react` | `1.17.0` | Icons | shadcn/ui default. |
| `date-fns` | `4.4.0` | Date utils | Brazil `America/Sao_Paulo` timezone. |

### Dev Tools

| Tool | Verified Version | Purpose |
|------|-----------------|---------|
| `@biomejs/biome` | `2.4.16` | Lint + format (replaces ESLint + Prettier) |
| `vitest` | `4.1.8` | Unit + integration tests |
| `@vitest/ui` | `4.1.8` | Vitest browser UI |
| `@playwright/test` | `1.60.0` | E2E tests |
| `@vitejs/plugin-react` | `6.0.2` | Vitest React component support |
| `tsx` | latest | TypeScript execution for scripts |
| `gitleaks` | binary only | Secret scanning — install via GitHub binary, NOT npm |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `graphile-worker@0.16.6` | `pg-boss@12.18.3` | pg-boss has pub/sub, multi-master, web dashboard, Drizzle adapter — more features but more complex. graphile-worker wins for Phase 0 simplicity and outbox-first transactional enqueueing. Switch to pg-boss at Phase 4 if multi-instance Coolify is needed. |
| `graphile-worker` | `BullMQ + Redis 7` | BullMQ is faster and battle-tested but adds Redis as infra dependency, violating Postgres-as-single-source-of-truth. CLAUDE.md includes BullMQ + Redis but STATE.md reconciles to Graphile-Worker. ADR (FOUND-14) makes this official. |
| `next-safe-action@8.5.4` | `next-safe-action@7.10.8` | v7 uses custom validation adapters; v8 uses Standard Schema natively. v8 recommended for new projects with Zod 4. |
| `@biomejs/biome@2.x` | ESLint 9 + Prettier | Biome is a single Rust binary, 10-20x faster. CLAUDE.md mandates Biome. |

**Bootstrap installation sequence:**

```bash
# 1. Scaffold — use @15 to avoid Next.js 16
pnpm create next-app@15 fb_eventos \
  --typescript --tailwind --app --src-dir \
  --import-alias "@/*" --use-pnpm --no-eslint

cd fb_eventos

# 2. Core DB stack
pnpm add drizzle-orm@0.45.2 postgres@3.4.9
pnpm add -D drizzle-kit@0.31.10

# 3. Auth + validation + safe actions
pnpm add better-auth@1.6.16 zod@4.4.3 next-safe-action@8.5.4

# 4. UI components
pnpm dlx shadcn@latest init   # interactive: style=default, color=slate, Tailwind CSS vars=yes
pnpm dlx shadcn@latest add button input form dialog dropdown-menu table sonner badge

# 5. Server-state + forms (v5 resolvers required for Zod 4)
pnpm add @tanstack/react-query@5.101.0 react-hook-form@7.78.0 @hookform/resolvers@5.4.0

# 6. Observability
pnpm add pino@10.3.1 pino-pretty resend@6.12.4
pnpm add @sentry/nextjs@10.57.0
npx @sentry/wizard@latest -i nextjs  # run interactively

# 7. Background jobs (Postgres-backed)
pnpm add graphile-worker@0.16.6

# 8. Storage + dates + icons
pnpm add minio@8.0.7 date-fns@4.4.0 date-fns-tz lucide-react@1.17.0

# 9. Dev tooling
pnpm add -D @biomejs/biome@2.4.16
pnpm add -D vitest@4.1.8 @vitest/ui @playwright/test@1.60.0 @vitejs/plugin-react@6.0.2
pnpm add -D tsx @types/node

# 10. Node version lock
echo "22" > .nvmrc
# Also add to package.json: "engines": { "node": ">=22.0.0", "pnpm": ">=9" }
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages verified against npm registry directly (`npm view`) and cross-referenced with official documentation or known GitHub repositories.

| Package | Registry | Age (approx) | Source Repo | slopcheck | Disposition |
|---------|----------|--------------|-------------|-----------|-------------|
| `next` | npm | 12+ yrs | github.com/vercel/next.js | [ASSUMED-OK] | Approved |
| `drizzle-orm` | npm | 3+ yrs | github.com/drizzle-team/drizzle-orm | [ASSUMED-OK] | Approved |
| `drizzle-kit` | npm | 3+ yrs | github.com/drizzle-team/drizzle-orm | [ASSUMED-OK] | Approved |
| `postgres` | npm | 5+ yrs | github.com/porsager/postgres | [ASSUMED-OK] | Approved |
| `better-auth` | npm | 2+ yrs | github.com/better-auth/better-auth | [ASSUMED-OK] | Approved |
| `zod` | npm | 5+ yrs | github.com/colinhacks/zod | [ASSUMED-OK] | Approved |
| `next-safe-action` | npm | 2+ yrs | github.com/TheEdoRan/next-safe-action | [ASSUMED-OK] | Approved |
| `graphile-worker` | npm | 6+ yrs (last pub: 2025-07-29) | github.com/graphile/worker — MIT, Benjie Gillam maintainer | [ASSUMED-OK] | Approved |
| `pg-boss` | npm | 8+ yrs (last pub: 2026-06-10) | github.com/timgit/pg-boss | [ASSUMED-OK] | Approved (ADR alternate) |
| `@sentry/nextjs` | npm | 5+ yrs | github.com/getsentry/sentry-javascript | [ASSUMED-OK] | Approved |
| `@biomejs/biome` | npm | 3+ yrs | github.com/biomejs/biome | [ASSUMED-OK] | Approved |
| `vitest` | npm | 3+ yrs | github.com/vitest-dev/vitest | [ASSUMED-OK] | Approved |
| `gitleaks` (npm) | npm | unknown | github.com/ycjcl868/gitleaks — "custom rules" wrapper | [WARNING: not the real scanner] | **REMOVED** — do NOT install |

**Packages removed:** `gitleaks` npm package is NOT the Zricethezav/gitleaks security scanner. Install the real scanner via:
```bash
# Option A: Install script (Linux/macOS)
curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/main/scripts/install.sh \
  | sh -s -- -b /usr/local/bin

# Option B: GitHub Action in CI (recommended)
# uses: gitleaks/gitleaks-action@v2
```

**Packages flagged as suspicious:** none
*All packages above are tagged `[ASSUMED]` for legitimacy since slopcheck was unavailable. The planner should treat each as requiring a quick manual check (npm page visit + GitHub repo confirms it is the expected package).*

---

## Architecture Patterns

### System Architecture Diagram

```
 Browser / Mobile App
         |
         | HTTPS (TLS via Let's Encrypt / Traefik ACME)
         v
  ┌──────────────────────────────────┐
  │  Traefik v3 (edge router)        │
  │  - PathPrefix /api → Next.js     │
  │  - Host app.fbeventos.com.br →   │
  │    Next.js (tenant from path)    │
  │  - Rate limit headers            │
  └──────────────┬───────────────────┘
                 │ HTTP/JSON (port 3000)
                 v
  ┌──────────────────────────────────────────────────────┐
  │  Next.js 15.5.x (App Router — standalone output)     │
  │                                                      │
  │  middleware.ts                                       │
  │    → extract slug from /{slug}/*                    │
  │    → inject x-tenant-slug header                    │
  │    → inject x-request-id header                     │
  │                                                      │
  │  Server Components    Server Actions (next-safe-action)  │
  │    read session       validate input (Zod 4)        │
  │    call withTenant()  call withTenant()             │
  │                                                      │
  │  Route Handlers                                      │
  │    /api/auth/[...all] → Better Auth                 │
  │    /api/health        → Postgres ping               │
  └────────────────────┬─────────────────────────────────┘
                       │ postgres.js connection pool
                       │  └─ withTenant():
                       │     BEGIN;
                       │     SET LOCAL app.current_tenant_id = ?;
                       │     ... queries ...
                       │     COMMIT;
                       v
  ┌──────────────────────────────────────────────────────┐
  │  PostgreSQL 16 (Coolify managed)                     │
  │                                                      │
  │  Roles:                                              │
  │    fb_eventos_app    — DML only, NO BYPASSRLS       │
  │    fb_eventos_migrator — DDL (deploy step only)     │
  │                                                      │
  │  Tables (RLS FORCED on all tenant-owned):           │
  │    tenants           — no RLS (global lookup)       │
  │    user/session      — Better Auth managed          │
  │    organization/member — Better Auth org plugin     │
  │    audit_log         — append-only, no UPDATE/DEL  │
  │    consent_records   — LGPD-01                      │
  │    _graphile_worker  — job queue (schema)           │
  │                                                      │
  │  Extensions: pgcrypto, pg_trgm                      │
  └────────────────────┬─────────────────────────────────┘
                       │
           ┌───────────┴──────────────┐
           v                          v
  ┌─────────────────┐      ┌──────────────────────┐
  │ Graphile-Worker │      │  External Services    │
  │ (Node process)  │      │  - Resend (email)     │
  │ - polls PG jobs │      │  - Sentry (errors)    │
  │ - cron tasks    │      │  - MinIO (storage)    │
  │ - retry/backoff │      └──────────────────────┘
  └─────────────────┘
```

### Recommended Project Structure

```
fb_eventos/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/                   # Auth pages: /login, /signup, /verify-email
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── verify-email/page.tsx
│   │   ├── [slug]/                   # Tenant-scoped pages (path-based routing)
│   │   │   └── dashboard/page.tsx
│   │   ├── api/
│   │   │   ├── auth/[...all]/route.ts  # Better Auth handler
│   │   │   └── health/route.ts         # /api/health endpoint (FOUND-08)
│   │   ├── globals.css
│   │   └── layout.tsx
│   ├── auth/
│   │   ├── server.ts               # betterAuth() instance
│   │   └── client.ts               # createAuthClient() for browser
│   ├── db/
│   │   ├── index.ts                # postgres() client — fb_eventos_app role
│   │   ├── migrate.ts              # fb_eventos_migrator client (CI/deploy only)
│   │   ├── schema/
│   │   │   ├── tenants.ts          # tenants table (no RLS — global lookup)
│   │   │   ├── auth.ts             # Better Auth tables (user, session, org, member)
│   │   │   ├── audit.ts            # audit_log append-only (LGPD-04)
│   │   │   ├── consent.ts          # consent_records (LGPD-01)
│   │   │   └── index.ts            # re-exports all schemas
│   │   ├── migrations/             # SQL migration files (generated by drizzle-kit)
│   │   └── with-tenant.ts          # withTenant() wrapper
│   ├── lib/
│   │   ├── actions/
│   │   │   └── safe-action.ts      # createSafeActionClient() with auth middleware
│   │   ├── logger.ts               # Pino instance
│   │   └── env.ts                  # Zod-validated env schema
│   ├── jobs/
│   │   ├── runner.ts               # Graphile-Worker runner
│   │   └── tasks/                  # Task handler functions (empty Phase 0)
│   ├── components/
│   │   ├── ui/                     # shadcn/ui generated components
│   │   └── consent-banner.tsx      # LGPD-02 cookie consent (client component)
│   ├── instrumentation.ts          # Sentry + Pino initialization (Next.js stable API)
│   └── middleware.ts               # Tenant slug + request-id (NOT proxy.ts — we're on Next.js 15)
├── docs/
│   ├── RUNBOOK.md                  # FOUND-13
│   ├── LGPD.md                     # LGPD-06 placeholder
│   └── adr/
│       └── 001-queue-backend.md    # FOUND-14 ADR
├── .github/
│   └── workflows/
│       └── ci.yml                  # FOUND-07
├── docker/
│   ├── Dockerfile                  # FOUND-09 multi-stage standalone
│   └── compose.yml                 # Local dev: postgres, minio, mailpit
├── drizzle.config.ts
├── vitest.config.ts
├── biome.json
├── next.config.ts                  # output: 'standalone'
├── .env.example                    # FOUND-06 (committed)
├── .env.local                      # gitignored
└── .nvmrc                          # "22"
```

### Pattern 1: Drizzle RLS Schema with pgPolicy (TENA-01, TENA-02)

```typescript
// src/db/schema/events.ts
// Source: https://orm.drizzle.team/docs/rls (verified 2026-06-11)
import { pgTable, uuid, text, timestamptz, pgPolicy, pgRole } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';

// Declare the app role (must already exist in DB — created by migration 000_roles.sql)
export const fbEventosApp = pgRole('fb_eventos_app', {
  createDb: false, createRole: false, inherit: true,
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  createdAt: timestamptz('created_at').defaultNow().notNull(),
  deletedAt: timestamptz('deleted_at'),    // LGPD-05 soft-delete field
}, (table) => [
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    to: fbEventosApp,
    for: 'all',
    // true = transaction-local (SET LOCAL semantics)
    using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
  }),
]).withRLS();   // enables RLS on table
```

`pgTable.withRLS()` enables RLS. FORCE RLS (prevents table owner bypass) must be added via raw migration SQL:

```sql
-- src/db/migrations/0002_force_rls.sql
ALTER TABLE events FORCE ROW LEVEL SECURITY;
-- Repeat for each tenant-owned table
```

### Pattern 2: Two-Role Postgres Setup (TENA-03, TENA-04)

```sql
-- src/db/migrations/0000_roles.sql
-- Run by fb_eventos_migrator (which has CREATEROLE privilege)

-- Runtime role: DML only, NO BYPASSRLS
CREATE ROLE fb_eventos_app NOLOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO fb_eventos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fb_eventos_app;
-- Future tables automatically granted
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fb_eventos_app;

-- App login user (password set via Coolify env, not committed)
-- In production: CREATE USER fb_app_user WITH PASSWORD '...' IN ROLE fb_eventos_app;
```

`DATABASE_URL` points to `fb_app_user` (fb_eventos_app role).
`DATABASE_MIGRATOR_URL` (CI/deploy step only) points to `fb_migrator` user.

### Pattern 3: withTenant() — RLS Context per Request (TENA-05)

```typescript
// src/db/with-tenant.ts
// Source: STACK.md + postgres.js docs (verified 2026-06-11)
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const pool = postgres(process.env.DATABASE_URL!, { max: 20 });
export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

export async function withTenant<T>(
  tenantId: string,
  fn: (db: DrizzleDB) => Promise<T>
): Promise<T> {
  return pool.begin(async (tx) => {
    // set_config with `true` = transaction-local (resets on COMMIT)
    // NEVER use SET (without LOCAL) — leaks between pooled connections
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    const db = drizzle(tx, { schema });
    return fn(db);
  });
}
```

Every Server Action, Route Handler, and background job **must** call `withTenant()` before any DB query. No direct `db.select().from(...)` outside this wrapper.

### Pattern 4: middleware.ts for Path-Based Tenant Resolution (TENA-06)

```typescript
// src/middleware.ts
// IMPORTANT: In Next.js 15 this file is `middleware.ts` — do NOT rename to `proxy.ts`.
// The proxy.ts convention was introduced in Next.js 16 (not our version).
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/middleware (verified)
import { NextResponse, type NextRequest } from 'next/server';

// Paths that are NOT tenant slugs
const SYSTEM_PREFIXES = new Set([
  'api', '_next', 'login', 'signup', 'verify-email',
  'reset-password', 'dashboard', 'health', 'favicon.ico',
  'robots.txt', 'sitemap.xml',
]);

export function middleware(req: NextRequest) {
  const requestId = req.headers.get('x-request-id')
    ?? crypto.randomUUID();

  const pathParts = req.nextUrl.pathname.split('/').filter(Boolean);
  const firstSegment = pathParts[0] ?? '';
  const isTenantPath = firstSegment && !SYSTEM_PREFIXES.has(firstSegment);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', requestId);
  if (isTenantPath) {
    requestHeaders.set('x-tenant-slug', firstSegment);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
```

In Server Components/Actions: read `x-tenant-slug` via `headers()` from `next/headers`, look up `tenants` table WHERE `slug = ?`, get `tenant_id`, pass to `withTenant()`.

**Reserved slug validation (TENA-06):** At organization creation time, validate the desired slug is not in SYSTEM_PREFIXES. Add custom check in the Better Auth `beforeOrganizationCreate` hook or the organization Server Action.

### Pattern 5: Better Auth Setup (AUTH-01 through AUTH-05, TENA-08)

```typescript
// src/auth/server.ts
// Source: https://www.better-auth.com/docs/installation (verified 2026-06-11)
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, twoFactor } from 'better-auth/plugins';
import { db } from '@/db';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      // resend.emails.send({ from: '...', to: user.email, html: `<a href="${url}">Verify</a>` })
    },
    sendOnSignUp: true,
  },

  plugins: [
    organization({
      // org = tenant
      // Default roles: 'owner', 'admin', 'member'
      // Map to TENA-08: owner → owner, admin → admin, member → viewer
      allowUserToCreateOrganization: true,
    }),
    twoFactor({
      issuer: 'FB Eventos',   // AUTH-05
    }),
  ],

  user: {
    additionalFields: {
      // LGPD consent capture (LGPD-01 adjacent)
      // NOTE: These fields must also be added manually to the Drizzle user schema
      // Better Auth does NOT auto-migrate additionalFields
      consentVersion: { type: 'string', required: false },
      consentAt:      { type: 'string', required: false },  // ISO 8601
      consentIp:      { type: 'string', required: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,    // 7 days — AUTH-04
    updateAge:  60 * 60 * 24,        // refresh token if older than 1 day
  },

  trustedOrigins: [process.env.BETTER_AUTH_URL!],
});
```

```typescript
// src/app/api/auth/[...all]/route.ts
import { auth } from '@/auth/server';
import { toNextJsHandler } from 'better-auth/next-js';
export const { POST, GET } = toNextJsHandler(auth);
```

**Better Auth org plugin schema:** Adds 6 tables: `organization`, `member`, `invitation`, `session` (extended with `activeOrganizationId`), `organizationRole` (optional), `team/teamMember` (optional). The `session.activeOrganizationId` is the tenant context source — middleware reads session → extracts `activeOrganizationId` → looks up tenant_id.

**additionalFields warning:** `consentVersion`, `consentAt`, `consentIp` in `additionalFields` are defined in auth config but must be manually added to the Drizzle user table schema. Run `drizzle-kit generate` after adding them.

### Pattern 6: Graphile-Worker Setup (FOUND-14 ADR)

```typescript
// src/jobs/runner.ts
import { run } from 'graphile-worker';

export async function startWorker() {
  const runner = await run({
    connectionString: process.env.DATABASE_URL!,
    concurrency: 5,
    taskDirectory: new URL('tasks', import.meta.url).pathname,
    // Graphile-Worker creates graphile_worker schema + tables automatically
    crontab: `
      # Phase 2+: expire lot reservations every minute
      # * * * * * expire-lot-reservations
    `,
  });
  return runner;
}

// src/jobs/tasks/send-email.ts — example task (Phase 0: empty harness)
import type { Task } from 'graphile-worker';
export const sendEmail: Task = async (payload, helpers) => {
  // helpers.logger.info('Sending email', payload);
};
```

**Transactional enqueueing (outbox pattern):**
```typescript
// Enqueue job within the same Postgres transaction as business event
// This is the outbox pattern — job only runs if TX commits
await pool.begin(async (tx) => {
  await tx`INSERT INTO audit_log (...) VALUES (...)`;
  // Graphile-Worker SQL function — atomically queued with the INSERT above
  await tx`SELECT graphile_worker.add_job(
    'send-email',
    ${{ to: 'user@example.com', subject: 'Welcome' }}::jsonb
  )`;
});
```

**ADR-001 Recommendation (FOUND-14):**

| Criterion | Graphile-Worker 0.16.6 | pg-boss 12.18.3 |
|-----------|------------------------|-----------------|
| Transactional enqueueing | YES — SQL function `graphile_worker.add_job()` | YES — `db.send()` accepts txn option |
| TypeScript | YES | YES |
| Cron/scheduled | YES — minute granularity | YES — full cron syntax |
| Unique/deduplication | YES — `job_key` param | YES — queue storage policies |
| Retry + backoff | YES — automatic exponential | YES — configurable backoff |
| Postgres version | 10+ (SKIP LOCKED) | 13+ |
| Infra beyond Postgres | None | None |
| Multi-master / Kubernetes | Not built-in | YES |
| Web dashboard | No | CLI + optional dashboard |
| Drizzle ORM adapter | No (raw SQL) | YES (official) |
| Recommendation | Phase 0-3 (simpler) | Consider at Phase 4 if multi-instance Coolify |

**Verdict:** Start with Graphile-Worker for Phase 0. Evaluate pg-boss at Phase 4 if you need multi-master or job visibility tooling.

### Pattern 7: Drizzle Config

```typescript
// drizzle.config.ts
// Source: https://orm.drizzle.team/docs/drizzle-config-file (verified 2026-06-11)
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Use MIGRATOR URL (DDL role), NOT the app URL
    url: process.env.DATABASE_MIGRATOR_URL!,
  },
  strict: true,    // requires user confirmation before destructive push (we use migrate not push)
  verbose: true,
});
```

Migration discipline:
```bash
# Allowed (CI + deploy step):
pnpm drizzle-kit generate   # generates SQL migration files
pnpm drizzle-kit migrate    # applies pending migrations (one-shot, not on boot)

# FORBIDDEN:
# pnpm drizzle-kit push     # destroys migration history, no paper trail
# Any auto-migrate on app startup
```

### Pattern 8: Pino Logger + Request ID (FOUND-10)

```typescript
// src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
```

```typescript
// src/instrumentation.ts — root of src/ (not inside app/)
// Source: https://nextjs.org/docs/app/guides/instrumentation (verified 2026-06-11)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import side-effects: Sentry server init, logger init
    await import('./instrumentation-node');
  }
}
```

Request-scoped child logger in Server Components/Actions:
```typescript
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';

const reqLogger = logger.child({
  requestId: (await headers()).get('x-request-id') ?? 'unknown',
  tenantId,  // from tenant context
});
reqLogger.info({ action: 'event.created' }, 'Event created');
```

### Pattern 9: LGPD Baseline Schema (LGPD-01, LGPD-03, LGPD-04, LGPD-05)

```typescript
// src/db/schema/audit.ts
import { pgTable, uuid, text, timestamptz, jsonb, index } from 'drizzle-orm/pg-core';

// LGPD-04: Append-only audit log
// GRANT INSERT only to fb_eventos_app — no UPDATE, no DELETE
export const auditLog = pgTable('audit_log', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull(),     // PII — see COMMENT in migration
  tenantId:   uuid('tenant_id').notNull(),
  action:     text('action').notNull(),      // 'event.created', 'lot.reserved', etc.
  entity:     text('entity').notNull(),      // table name
  entityId:   uuid('entity_id'),
  payload:    jsonb('payload'),              // sanitized diff, no passwords
  ipAddress:  text('ip_address'),            // PII
  userAgent:  text('user_agent'),
  createdAt:  timestamptz('created_at').defaultNow().notNull(),
}, (t) => [
  index('audit_log_tenant_idx').on(t.tenantId),
  index('audit_log_user_idx').on(t.userId),
  index('audit_log_created_idx').on(t.createdAt),
]);

// LGPD-01: Consent records with versioning
export const consentRecords = pgTable('consent_records', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull(),        // PII
  consentVersion: text('consent_version').notNull(), // '2026-06-01'
  consentText:    text('consent_text').notNull(),    // full text snapshot
  ipAddress:      text('ip_address').notNull(),      // PII
  userAgent:      text('user_agent'),
  createdAt:      timestamptz('created_at').defaultNow().notNull(),
});
```

```sql
-- src/db/migrations/0003_lgpd_comments.sql  (LGPD-03)
COMMENT ON COLUMN audit_log.user_id IS 'PII: natural person identifier; retention 5 yrs post-event';
COMMENT ON COLUMN audit_log.ip_address IS 'PII: network identifier; retained for fraud/legal';
COMMENT ON COLUMN consent_records.user_id IS 'PII: natural person identifier';
COMMENT ON COLUMN consent_records.ip_address IS 'PII: consent evidence per LGPD Art. 8';

-- Restrict audit_log: app role INSERT only
REVOKE UPDATE, DELETE ON audit_log FROM fb_eventos_app;

-- Postgres extensions (FOUND-16)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

**Soft-delete (LGPD-05):** Every tenant-owned table with PII must have `deleted_at timestamptz` column. Standard query filters: `.where(isNull(table.deletedAt))`. Hard-delete via Graphile-Worker job after retention period (Phase 4 implementation, Phase 0 schema foundation).

### Pattern 10: Sentry Configuration (FOUND-11)

```bash
# Source: https://docs.sentry.io/platforms/javascript/guides/nextjs/ (verified 2026-06-11)
# Run interactively after pnpm install
npx @sentry/wizard@latest -i nextjs
# Creates: sentry.client.config.ts, sentry.server.config.ts, sentry.edge.config.ts
# Wraps next.config.ts with withSentryConfig()
# Adds instrumentation.ts imports
```

Custom tenant tagging in Server Actions:
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.withScope((scope) => {
  scope.setTag('tenant_id', tenantId);
  scope.setUser({ id: userId });
  Sentry.captureException(error);
});
```

### Pattern 11: Multi-Stage Dockerfile (FOUND-09)

```dockerfile
# Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/output (verified 2026-06-11)
# Requires next.config.ts: output: 'standalone'

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# Tagged at build time: docker build -t ghcr.io/org/fb-eventos-web:1.0.0 .
# NEVER tag :latest in production (FOUND-09 + CLAUDE.md)
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
```

### Pattern 12: CI Pipeline YAML (FOUND-02, FOUND-03, FOUND-04, FOUND-07)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  anti-pitfall-gates:
    name: Anti-Pitfall Gates
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # FOUND-02: Block embedded-DB packages
      - name: Block embedded-DB packages
        run: |
          if grep -E '"(sqlite3|better-sqlite3|@libsql|bun:sqlite|@libsql/client)"' package.json; then
            echo "::error::Embedded database package detected in package.json."
            exit 1
          fi

      # FOUND-03: Block *.db / *.sqlite files
      - name: Block *.db/*.sqlite files
        run: |
          if find . \
              -not -path './.git/*' \
              -not -path './node_modules/*' \
              \( -name "*.db" -o -name "*.sqlite" -o -name "tracker-*.db" \) \
            | grep .; then
            echo "::error::Embedded database file detected."
            exit 1
          fi

      # Block legacy FB_APU04 module names
      - name: Block fb_apu0x legacy names
        run: |
          if grep -rn 'fb_apu0[1-9]' src/ --include="*.ts" --include="*.tsx"; then
            echo "::error::Legacy FB_APU04 module name reference found."
            exit 1
          fi

      # Block Next.js 16 upgrade
      - name: Assert Next.js 15.x
        run: |
          VERSION=$(node -e "console.log(require('./package.json').dependencies.next || '')")
          if echo "$VERSION" | grep -qE '^\^?16\.|^>=16|^>16'; then
            echo "::error::Next.js 16 detected in dependencies. Pin to ~15.5.x."
            exit 1
          fi

  # FOUND-04: Secret scanning
  secrets-scan:
    name: Secret Scan (gitleaks)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  lint-typecheck:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    needs: anti-pitfall-gates
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      # FOUND-05: Biome lint
      - run: pnpm biome check --diagnostic-level=error src/
      # FOUND-05: TypeScript type-check
      - run: pnpm tsc --noEmit

  test:
    name: Tests (Vitest)
    runs-on: ubuntu-latest
    needs: anti-pitfall-gates
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: fb_test
          POSTGRES_PASSWORD: fb_test
          POSTGRES_DB: fb_eventos_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm vitest run
        env:
          DATABASE_URL: postgresql://fb_test:fb_test@localhost:5432/fb_eventos_test
          DATABASE_MIGRATOR_URL: postgresql://fb_test:fb_test@localhost:5432/fb_eventos_test
          BETTER_AUTH_SECRET: test-secret-32-chars-minimum-here

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint-typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
        env:
          NEXT_TELEMETRY_DISABLED: 1
          DATABASE_URL: postgresql://localhost/placeholder
          DATABASE_MIGRATOR_URL: postgresql://localhost/placeholder
          BETTER_AUTH_SECRET: build-time-placeholder-32-chars-minimum
          BETTER_AUTH_URL: http://localhost:3000
```

### Pattern 13: Environment Variables Manifest (FOUND-06)

```bash
# .env.example — committed to git with placeholders ONLY
# Copy to .env.local for local development (gitignored)
# Production values go in Coolify UI environment settings

# ====== Database ======
# Runtime (fb_eventos_app role — DML only, NO BYPASSRLS)
DATABASE_URL=postgresql://fb_app_user:CHANGE_ME@localhost:5432/fb_eventos_dev
# Migrations (fb_eventos_migrator role — DDL, CI/deploy step only)
DATABASE_MIGRATOR_URL=postgresql://fb_migrator:CHANGE_ME@localhost:5432/fb_eventos_dev

# ====== Auth ======
# Generate: openssl rand -hex 32
BETTER_AUTH_SECRET=GENERATE_WITH_openssl_rand_-hex_32
BETTER_AUTH_URL=http://localhost:3000

# ====== Email ======
RESEND_API_KEY=re_CHANGE_ME

# ====== Object Storage ======
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=CHANGE_ME
MINIO_SECRET_KEY=CHANGE_ME
MINIO_USE_SSL=false
MINIO_DEFAULT_BUCKET=fb-eventos

# ====== Observability ======
SENTRY_DSN=https://CHANGE_ME@o0.ingest.sentry.io/0
SENTRY_AUTH_TOKEN=CHANGE_ME
LOG_LEVEL=info

# ====== App ======
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
TZ=America/Sao_Paulo
```

### Anti-Patterns to Avoid

- **`pnpm create next-app@latest`** — resolves to Next.js 16, which renamed `middleware.ts` to `proxy.ts`. Always use `pnpm create next-app@15`.
- **`middleware.ts` renamed to `proxy.ts`** — applies only to Next.js 16+. Do not rename while pinned to Next.js 15.
- **`drizzle-kit push` in CI/production** — no migration file generated, history lost, destructive operations not reviewable.
- **`@hookform/resolvers@4.x` with Zod 4** — v4 resolvers support Zod 3 only; validation silently passes everything. Must use `^5.x`.
- **`next-safe-action@7.x` and expect Zod 4 compatibility** — v7 uses custom `validationAdapter`; v8 uses Standard Schema which Zod 4 implements.
- **`SET app.current_tenant_id` (not SET LOCAL)** — persists across transactions in pooled connections → cross-tenant data leak. Always use `set_config('app.current_tenant_id', $id, true)`.
- **`npm install gitleaks`** — installs an unrelated "custom rules" package, not the security scanner.
- **`fb_eventos_app` role running migrations** — app role has DML only. Migrations need `fb_eventos_migrator` with DDL.
- **BullMQ + Redis for Phase 0** — deferred; use Graphile-Worker (Postgres-backed) per STATE.md reconciliation.
- **`better-auth` `additionalFields` without Drizzle schema update** — additionalFields are not auto-migrated; columns must be added manually to the Drizzle user schema.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth, sessions, email verification | Custom JWT + bcrypt + email links | `better-auth@1.6.16` | 2FA, org plugin, session management, password reset all included; hand-rolled auth = FB_APU04's 21KB file with panic-risk JWT claims |
| Server Action validation | Manual `FormData.get()` parsing | `next-safe-action@8.5.4` | Standard Schema + Zod 4, structured error mapping, typed middleware chain |
| Secret scanning | Custom regex hooks | `gitleaks` binary + `gitleaks-action@v2` | 150+ built-in secret patterns; SARIF output for GitHub Security tab |
| Background jobs | File-based queue, SQLite job tracker | `graphile-worker@0.16.6` | Transactional enqueueing, exactly-once delivery, cron, retry — zero additional infra |
| PII column inventory | Documentation spreadsheet | SQL `COMMENT ON COLUMN` | Comments are queryable via `information_schema`; co-located with schema; LGPD-03 compliance |
| Tenant isolation | Manual `WHERE tenant_id = ?` on every query | Postgres RLS + `pgPolicy` | DB-level enforcement; forgotten WHERE → empty result, not data leak |
| Structured logging | `console.log` | `pino@10.3.1` | 10x faster than Winston; structured JSON; child loggers for request_id + tenant_id binding |

**Key insight:** In multi-tenant SaaS, auth and tenant isolation are the highest-risk hand-rolled solutions. Both have subtle production failure modes (JWT algorithm confusion, BYPASSRLS superuser bypass, connection pool tenant leakage) that only appear under load or adversarial conditions.

---

## Common Pitfalls

### Pitfall 1: Next.js Version Drift to 16

**What goes wrong:** `pnpm create next-app@latest` installs Next.js 16 (current `latest` tag). In v16, `middleware.ts` was renamed to `proxy.ts` and the exported function from `middleware()` to `proxy()`. Existing `middleware.ts` is silently ignored — tenant routing stops working without any build error.

**Why it happens:** Developers use `@latest` tag; npm dist-tag `latest` points to 16.2.9.

**How to avoid:** Always `pnpm create next-app@15`. Pin `"next": "~15.5.19"` in package.json. Add CI gate to block v16 in dependencies.

**Warning signs:** `middleware.ts` not executing; tenant context missing on requests; `x-tenant-slug` header absent in Server Components.

### Pitfall 2: `@hookform/resolvers` v4 + Zod 4 Mismatch

**What goes wrong:** `@hookform/resolvers@4.x` calls the Zod 3 parse API (`safeParse`). Zod 4 changed the schema internals. The resolver may silently pass all validation or throw TypeScript errors that are suppressed at runtime.

**Why it happens:** CLAUDE.md listed `@hookform/resolvers` without version; npm installs latest v4.x.

**How to avoid:** `pnpm add @hookform/resolvers@5.4.0` — v5 targets Zod 4 / Standard Schema explicitly.

### Pitfall 3: `SET` vs `SET LOCAL` Causing Cross-Tenant Leakage

**What goes wrong:** `await tx\`SET app.current_tenant_id = '${tenantId}'\`` (no LOCAL) persists the setting on the connection in the pool. If the transaction ends abnormally and the connection is reused, the next request inherits tenant_id from the previous request — cross-tenant data read without any error.

**How to avoid:** `set_config('app.current_tenant_id', tenantId, true)` (the `true` flag = transaction-local). This is what the `withTenant()` wrapper uses. Never use bare `SET`. Add integration test that verifies tenant_id is NULL after transaction commits.

### Pitfall 4: drizzle-kit `push` in CI Destroys Migration History

**What goes wrong:** `drizzle-kit push` applies schema diff directly to the database without creating SQL files. It has a destructive-confirmation bypass (`--force`). A misconfigured CI step silently drops columns.

**How to avoid:** CI must only call `drizzle-kit generate` + `drizzle-kit migrate`. Never `push`. Add a post-generate dirty check: if new migration files are present in CI after `generate`, it means the schema is out of sync with committed migrations.

### Pitfall 5: Sentry Wizard Generates Next.js 16 File Names on Next.js 15

**What goes wrong:** `@sentry/wizard@latest` may generate `instrumentation-client.ts` (Next.js 16 convention) instead of `sentry.client.config.ts`. On Next.js 15, the client config is not automatically picked up by the wrong file name.

**How to avoid:** After wizard, verify `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` exist. If wizard generated `instrumentation-client.ts`, rename to `sentry.client.config.ts` and verify `instrumentation.ts` registers it.

### Pitfall 6: Better Auth additionalFields Not Appearing in DB

**What goes wrong:** Adding `consentVersion`, `consentAt`, `consentIp` to `additionalFields` in Better Auth config does NOT auto-create the columns. The auth adapter reads/writes these fields but if columns don't exist in the DB, inserts fail silently or throw.

**How to avoid:** After adding `additionalFields`, manually add the corresponding columns to `src/db/schema/auth.ts` (or use Better Auth's schema generation command), then run `drizzle-kit generate` + `drizzle-kit migrate`.

### Pitfall 7: Reserved Slug Collision in Path-Based Tenant Routing

**What goes wrong:** A tenant signs up with slug `api`, `login`, or `health`. Next.js middleware passes `x-tenant-slug: api` to all API routes, causing tenant context to be set during auth calls. The auth endpoint tries to scope database queries to tenant "api" which doesn't resolve.

**How to avoid:** Validate slug against SYSTEM_PREFIXES list at organization creation time. Use a Server Action pre-check before creating the Better Auth organization.

### Pitfall 8: Graphile-Worker Uses `pg` Driver, Not `postgres.js`

**What goes wrong:** Graphile-Worker uses the `pg` driver internally (per its dependencies), while the application uses `postgres.js`. The connection pool for Graphile-Worker is separate from the app pool — RLS settings set via `withTenant()` do NOT carry over to job worker queries.

**How to avoid:** In Graphile-Worker task handlers, always call `withTenant()` (or equivalent `SET LOCAL`) before querying tenant-scoped data. Never assume RLS context is inherited from the enqueuing request.

---

## Code Examples

### Health Check Endpoint (FOUND-08)

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';  // fb_eventos_app connection

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? 'unknown',
    });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
```

### next-safe-action v8 Client Setup

```typescript
// src/lib/actions/safe-action.ts
import { createSafeActionClient } from 'next-safe-action';
import { headers } from 'next/headers';
import { auth } from '@/auth/server';

export const actionClient = createSafeActionClient();

// Authenticated action with tenant context
export const authedAction = createSafeActionClient()
  .use(async ({ next }) => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error('Unauthorized');
    return next({
      ctx: {
        userId: session.user.id,
        orgId: session.session.activeOrganizationId,
      },
    });
  });

// Usage in a Server Action file:
// 'use server';
// import { authedAction } from '@/lib/actions/safe-action';
// import { z } from 'zod';
//
// export const createTenantEvent = authedAction
//   .inputSchema(z.object({ name: z.string().min(1) }))  // NOTE: v8 uses .inputSchema()
//   .action(async ({ parsedInput, ctx }) => {
//     if (!ctx.orgId) throw new Error('No active organization');
//     return withTenant(ctx.orgId, async (db) => { ... });
//   });
```

### Local Dev Docker Compose

```yaml
# docker/compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: fb_dev
      POSTGRES_PASSWORD: fb_dev
      POSTGRES_DB: fb_eventos_dev
    ports: ['5432:5432']
    volumes: ['pg_data:/var/lib/postgresql/data']
    command: >
      postgres
        -c log_statement=all
        -c timezone=America/Sao_Paulo
        -c max_connections=100
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'fb_dev']
      interval: 10s

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ['9000:9000', '9001:9001']

  mailpit:
    image: axllent/mailpit:latest
    ports: ['1025:1025', '8025:8025']

# Note: Redis is intentionally absent.
# Graphile-Worker uses Postgres — no Redis needed for Phase 0-3.
volumes:
  pg_data:
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on Phase 0 |
|--------------|------------------|--------------|-------------------|
| `middleware.ts` | `proxy.ts` | Next.js 16.0.0 | NOT relevant to us — we pin Next.js 15 where `middleware.ts` is still correct |
| `next-safe-action@7` custom validation adapters | `next-safe-action@8` Standard Schema | v8.0.0 (2025) | Breaking: `.schema()` → `.inputSchema()`; no `validationAdapter`. Pin `8.5.4`. |
| `@hookform/resolvers@4` (Zod 3) | `@hookform/resolvers@5` (Zod 4 / Standard Schema) | v5.0.0 (2025) | Must use `^5.x` alongside Zod 4 |
| Drizzle `.enableRLS()` | `pgTable.withRLS()` + `pgPolicy()` | drizzle-orm v1.0.0-beta.1 | Current recommended pattern; `enableRLS()` still works but deprecated |
| BullMQ + Redis queue | Graphile-Worker (Postgres-backed) | Phase 0 project decision | Eliminates Redis infra dependency for queuing |
| ESLint + Prettier | Biome v2.x | Biome 2.0 (2025) | Single Rust binary, `biome.json` only, 10-20x faster |
| Sentry in `_app.tsx` | `instrumentation.ts` + separate config files | Next.js 15.1 stable | `instrumentation.ts` is now stable (not experimental) |

**Deprecated/outdated:**
- `drizzle-kit push` in production: never appropriate
- `middleware.ts` in Next.js 16+: renamed (irrelevant for us)
- `better-auth@<1.6`: org plugin API changed significantly; pin `1.6.x`
- `@hookform/resolvers@^4`: Zod 3 only; must upgrade to `^5` with Zod 4

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Graphile-Worker `graphile_worker.add_job()` SQL function exists in v0.16.6 for in-transaction enqueueing | Pattern 6, FOUND-14 | If SQL function signature changed, outbox pattern needs adjustment (pg-boss or manual _jobs INSERT) |
| A2 | Graphile-Worker task function signature is `(payload: unknown, helpers: JobHelpers) => Promise<void>` | Pattern 6 | Minor API change would break type definitions; check actual `graphile-worker` types |
| A3 | `pgcrypto` and `pg_trgm` are available in Coolify's `postgres:16-alpine` but NOT pre-enabled (need `CREATE EXTENSION`) | FOUND-16 | If extensions not available at all, need custom PG image; if already enabled, the migration `CREATE EXTENSION IF NOT EXISTS` is a harmless no-op |
| A4 | `gitleaks/gitleaks-action@v2` is current GitHub Action for gitleaks CI integration | CI pattern | Action version may have moved to v3; verify at https://github.com/gitleaks/gitleaks-action/releases |
| A5 | Better Auth `additionalFields` requires manual Drizzle schema column addition | Pattern 5 | If Better Auth gained auto-migration in v1.6.x, the extra step is harmless. Safer to always add manually. |
| A6 | Coolify built-in Postgres backup supports PITR (WAL-based) with 7-day retention | FOUND-12 | Coolify may only support snapshot backups; may need to configure pg_dump cron to MinIO as supplement |
| A7 | Next.js 15.5.19 is the correct pin (upgrading from 15.4.x in CLAUDE.md) | Standard Stack | 15.5.x may have introduced behavior changes vs 15.4.x; run full test suite after upgrading. Review Next.js 15.5.x changelog during Phase 0 execution. |
| A8 | `next-safe-action@8` Standard Schema is compatible with Zod 4.4.x | Standard Stack | If Zod 4 Standard Schema implementation has gaps, fall back to `next-safe-action@7.10.8` with Zod 3 resolver (less preferred). |

---

## Open Questions

1. **FOUND-14: Graphile-Worker vs pg-boss final ADR**
   - What we know: Both are Postgres-backed, both support transactional enqueueing. Graphile-Worker simpler API for outbox pattern. pg-boss richer management features.
   - What's unclear: Exact `graphile_worker.add_job()` SQL signature in v0.16.6; pg-boss Drizzle adapter maturity.
   - Recommendation: Default to Graphile-Worker. Document in ADR. Include "revisit at Phase 4 if multi-instance Coolify deploy is needed."

2. **FOUND-16: Postgres extensions on Coolify**
   - What we know: `pgcrypto` and `pg_trgm` ship with `postgres:16-alpine` but need `CREATE EXTENSION IF NOT EXISTS` to activate.
   - What's unclear: Whether Coolify's managed Postgres image pre-enables these or if the migration role needs `SUPERUSER` to create extensions.
   - Recommendation: Add `CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;` to the first migration file. Test during Phase 0 Coolify setup.

3. **FOUND-12: PITR backup in Coolify**
   - What we know: Coolify has a backup UI for Postgres services.
   - What's unclear: Whether Coolify's backup is WAL-based (true PITR) or snapshot-only.
   - Recommendation: During Phase 0 infra setup, check Coolify backup settings. If snapshot-only, add a scheduled `pg_dump` to MinIO for 7-day retention coverage.

4. **TENA-06: Tenant slug reserved words completeness**
   - What we know: `api`, `_next`, `login` etc. must be reserved.
   - What's unclear: Complete list of Next.js reserved segments and future-proofing.
   - Recommendation: Use the SYSTEM_PREFIXES set from Pattern 4 as starting point. Add slug validation to organization creation as early as Wave 1.

---

## Environment Availability

| Dependency | Required By | Available (on dev machine) | Version | Fallback |
|------------|------------|---------------------------|---------|----------|
| Node.js 22 | All | ✓ | v22.22.1 | — |
| PostgreSQL | Tests + local dev | ✓ | 18.4 local (Ubuntu); use `postgres:16-alpine` Docker for exact version match | — |
| pnpm | Bootstrap + all tasks | ✗ | — | `npm install -g pnpm@9` |
| Docker | Local compose + CI builds | ✗ (on this machine) | — | GitHub Actions ubuntu-latest has Docker; local dev can use system Postgres |
| Redis | Phase 0 | Not needed | — | Graphile-Worker uses Postgres — no Redis for Phase 0-3 |
| gitleaks | FOUND-04 | ✗ | — | `gitleaks/gitleaks-action@v2` covers CI; local binary install optional |

**Missing dependencies with no fallback:** pnpm must be installed before Phase 0 execution: `npm install -g pnpm@9`

**Missing dependencies with fallback:**
- Docker: not needed for research; GitHub Actions provides it for CI; local dev can use the system PostgreSQL (v18 available)
- gitleaks local: GitHub Action covers CI coverage; local pre-commit is optional

---

## Validation Architecture

> Nyquist validation is enabled (no `workflow.nyquist_validation: false` in .planning/config.json).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 |
| Config file | `vitest.config.ts` (Wave 0 gap — does not exist yet) |
| Quick run command | `pnpm vitest run --reporter=verbose` |
| Full suite command | `pnpm vitest run --coverage && pnpm playwright test` |

**vitest.config.ts skeleton (Wave 0):**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    alias: { '@': path.resolve(__dirname, './src') },
    testTimeout: 30000,  // DB tests can be slow
  },
});
```

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-02 | No sqlite3/libsql in package.json | CI grep gate | GitHub Actions step (grep) | CI-only |
| FOUND-03 | No *.db files in repo | CI find gate | GitHub Actions step (find) | CI-only |
| FOUND-04 | gitleaks blocks secrets on PR | CI gate | gitleaks-action@v2 | CI-only |
| FOUND-05 | Biome lint + tsc pass | CI | `pnpm biome check && pnpm tsc --noEmit` | CI-only |
| FOUND-08 | /api/health returns 200 with JSON | Integration | `pnpm vitest run tests/health.test.ts` | ❌ Wave 0 |
| FOUND-10 | Pino emits JSON logs on server request | Integration | `pnpm vitest run tests/logging.test.ts` | ❌ Wave 0 |
| AUTH-01 | Signup creates user row in DB | Integration | `pnpm vitest run tests/auth.test.ts -t signup` | ❌ Wave 0 |
| AUTH-02 | Email verification link generated and stored | Integration | `pnpm vitest run tests/auth.test.ts -t verification` | ❌ Wave 0 |
| AUTH-03 | Password reset token created and emailed | Integration | `pnpm vitest run tests/auth.test.ts -t reset` | ❌ Wave 0 |
| AUTH-04 | Session row persists after login | Integration | `pnpm vitest run tests/auth.test.ts -t session` | ❌ Wave 0 |
| AUTH-05 | TOTP 2FA setup and verify | E2E | `pnpm playwright test tests/e2e/auth.spec.ts -g 2fa` | ❌ Wave 0 |
| TENA-01 | All domain tables have tenant_id FK | Schema check | `pnpm drizzle-kit check` + SQL query | ❌ Wave 0 |
| TENA-02 | RLS is FORCED on tenant tables | DB integration | `pnpm vitest run tests/rls.test.ts -t forced` | ❌ Wave 0 |
| TENA-03 | fb_eventos_app has no BYPASSRLS | DB check | SQL: `SELECT rolbypassrls FROM pg_roles WHERE rolname='fb_eventos_app'` | CI-only |
| TENA-05 | SET LOCAL resets after COMMIT | Unit | `pnpm vitest run tests/with-tenant.test.ts` | ❌ Wave 0 |
| TENA-07 | Tenant A cannot read Tenant B data | Integration | `pnpm vitest run tests/tenant-isolation.test.ts` | ❌ Wave 0 |
| TENA-08 | org plugin roles owner/admin/member work | Integration | `pnpm vitest run tests/auth.test.ts -t roles` | ❌ Wave 0 |
| LGPD-01 | consent_records INSERT works with version | Integration | `pnpm vitest run tests/lgpd.test.ts -t consent` | ❌ Wave 0 |
| LGPD-02 | Cookie consent banner renders | E2E | `pnpm playwright test tests/e2e/consent.spec.ts` | ❌ Wave 0 |
| LGPD-04 | audit_log row created for sensitive op | Integration | `pnpm vitest run tests/lgpd.test.ts -t audit` | ❌ Wave 0 |
| LGPD-05 | Soft-delete sets deleted_at, filters from queries | Unit | `pnpm vitest run tests/soft-delete.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run --reporter=verbose` (all unit + integration, target <30s)
- **Per wave merge:** `pnpm vitest run --coverage && pnpm playwright test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps (files that must be created before implementation begins)
- [ ] `vitest.config.ts` — Vitest configuration
- [ ] `src/test/setup.ts` — global setup: test DB connection, create/teardown test tenants
- [ ] `tests/health.test.ts` — FOUND-08
- [ ] `tests/auth.test.ts` — AUTH-01 through AUTH-05, TENA-08
- [ ] `tests/rls.test.ts` — TENA-02
- [ ] `tests/with-tenant.test.ts` — TENA-05 (SET LOCAL behavior)
- [ ] `tests/tenant-isolation.test.ts` — TENA-07 (two-tenant fixture)
- [ ] `tests/lgpd.test.ts` — LGPD-01, LGPD-04, LGPD-05
- [ ] `tests/soft-delete.test.ts` — LGPD-05
- [ ] `tests/e2e/auth.spec.ts` — AUTH-05 TOTP, Playwright
- [ ] `tests/e2e/consent.spec.ts` — LGPD-02 consent banner, Playwright

---

## Security Domain

> `security_enforcement` is not set to false in config — section required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | YES | `better-auth` — email+password, email verification, TOTP 2FA, session management |
| V3 Session Management | YES | Better Auth Postgres-stored sessions, 7-day expiry, daily token refresh |
| V4 Access Control | YES | RLS FORCED + `fb_eventos_app` NO BYPASSRLS + Better Auth org plugin roles (owner/admin/member) |
| V5 Input Validation | YES | `zod@4.4.3` on all Server Actions via `next-safe-action@8.5.4`; all inputs validated before DB |
| V6 Cryptography | YES | Better Auth manages password hashing (argon2 by default); `pgcrypto` for future LGPD anonymization |
| V7 Error Handling | YES | Pino structured logs without stack traces to client; Sentry captures errors with tenant_id tag |
| V9 Communications Security | YES | Traefik handles TLS (Let's Encrypt ACME); all inter-service communication over HTTPS |
| V14 Configuration | YES | `.env.local` gitignored; production secrets in Coolify UI only; `gitleaks` blocks committed secrets |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant data access (missing tenant_id filter) | Information Disclosure | RLS FORCED + `fb_eventos_app` has NO BYPASSRLS + `withTenant()` wrapper is the only DB access path |
| Session fixation / cookie hijacking | Elevation of Privilege | Better Auth regenerates session on login; `Secure; HttpOnly; SameSite=Lax` cookie attributes |
| Connection pool `SET` leaking tenant context | Information Disclosure | Use `set_config('...', id, true)` (LOCAL) exclusively — validated by integration tests |
| Real secrets committed to git (.env, keys) | Information Disclosure | `gitleaks` pre-commit hook + `gitleaks-action@v2` on every PR |
| Destructive migration on app boot | Tampering | `drizzle-kit migrate` in CI deploy step only; no auto-migrate on boot; CI dirty-check gate |
| JWT algorithm confusion (alg:none, RS256→HS256) | Elevation of Privilege | Better Auth manages token signing internally — no hand-rolled JWT |
| Server Action with unvalidated input | Tampering | All actions use `next-safe-action@8` with Zod schema; invalid input rejected before DB access |
| SQLite/embedded DB bypass (as cache or test DB) | Information Disclosure | CI grep gate blocks any embedded-DB package in package.json; Drizzle `peerDependencies` include SQLite but we never install those drivers |
| Slug collision giving tenant access to API routes | Elevation of Privilege | Reserved slug validation at org creation; middleware SYSTEM_PREFIXES guard |

---

## Project Constraints (from CLAUDE.md)

The following actionable directives from `CLAUDE.md` are enforced in this research and the planner must verify compliance in every task:

1. **No SQLite/embedded DB anywhere** — CI gates FOUND-02/03 are mandatory from commit #1.
2. **Stack versions are locked** — do not upgrade without explicit decision; especially do NOT use `next@latest`.
3. **Migrations: `drizzle-kit migrate` only** — never `push` in CI/production.
4. **Runtime DB user must not be `postgres` superuser** — `fb_eventos_app` with DML only, no BYPASSRLS.
5. **No `.env.production` or `.env.local` committed** — only `.env.example` committed.
6. **Watchtower is banned** — semver-tagged Docker images; Coolify deploys deliberate.
7. **`fb_apu0[1-9]` module names banned** — CI grep gate enforces.
8. **Tenant isolation in Postgres, not application layer only** — RLS is non-negotiable.
9. **`SET LOCAL` not `SET` for tenant context** — prevents cross-request leak in pooled connections.
10. **GSD workflow enforcement** — all file changes go through a GSD command (plan execution context).
11. **Dev tooling: pnpm + Biome (not npm + ESLint + Prettier)** — mandatory from bootstrap.
12. **Tests: Vitest + Playwright from day 1** — FB_APU04 had zero coverage; not repeating.

---

## Sources

### Primary (HIGH confidence)
- npm registry — all package versions verified live 2026-06-11: next@15.5.19, drizzle-orm@0.45.2, drizzle-kit@0.31.10, better-auth@1.6.16, zod@4.4.3, next-safe-action@8.5.4, graphile-worker@0.16.6, pg-boss@12.18.3, @hookform/resolvers@5.4.0, @biomejs/biome@2.4.16, vitest@4.1.8, @playwright/test@1.60.0, @sentry/nextjs@10.57.0, pino@10.3.1, postgres@3.4.9, minio@8.0.7, resend@6.12.4, tailwindcss@4.3.0, react@19.2.7
- [Drizzle ORM RLS docs](https://orm.drizzle.team/docs/rls) — `pgTable.withRLS()`, `pgPolicy()` API verified 2026-06-11
- [Drizzle config file docs](https://orm.drizzle.team/docs/drizzle-config-file) — `strict`, `verbose`, migration commands
- [Next.js standalone output docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) — multi-stage Dockerfile pattern verified 2026-06-11
- [Next.js middleware/proxy docs](https://nextjs.org/docs/app/api-reference/file-conventions/middleware) — confirmed `middleware.ts` → `proxy.ts` rename is Next.js 16 ONLY; v15 still uses `middleware.ts`
- [Better Auth installation](https://www.better-auth.com/docs/installation) — `betterAuth()`, `drizzleAdapter`, `toNextJsHandler` verified
- [Better Auth organization plugin](https://www.better-auth.com/docs/plugins/organization) — default roles, 6 added schema tables, Drizzle integration
- [Sentry Next.js docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/) — wizard command, config file names
- [next-safe-action v7→v8 migration](https://next-safe-action.dev/docs/migrations/v7-to-v8) — breaking changes: Standard Schema, `.schema()` → `.inputSchema()`
- [pg-boss README](https://github.com/timgit/pg-boss/blob/master/README.md) — transactional enqueueing, retry, Node 22+, Drizzle adapter
- [graphile-worker homepage](https://worker.graphile.org/) — cron, retry/backoff, LISTEN/NOTIFY, up to 10k jobs/sec
- [Zod v4.4.0 releases](https://github.com/colinhacks/zod/releases) — breaking changes verified (tuple defaults, undefined required properties, merge refinements)
- [Next.js instrumentation.ts](https://nextjs.org/docs/app/guides/instrumentation) — `register()` function, NEXT_RUNTIME guard, stable since Next.js 15
- Project files: CLAUDE.md, .planning/STATE.md, .planning/REQUIREMENTS.md, .planning/ROADMAP.md, .planning/research/STACK.md + SUMMARY.md + PITFALLS.md + ARCHITECTURE.md

### Secondary (MEDIUM confidence)
- npm postinstall script checks — manually run for all Phase 0 packages; none found
- graphile-worker GitHub last publish: 2025-07-29; pg-boss last publish: 2026-06-10
- `@sentry/nextjs@10` peer deps: `next: '^13.2.0 || ^14.0 || ^15.0.0-rc.0'` — Next.js 16 not in peers

### Tertiary (LOW confidence — marked [ASSUMED])
- Graphile-Worker v0.16.6 exact SQL function API (`graphile_worker.add_job()` signature) — worker.graphile.org/docs returned 404 [ASSUMED]
- Coolify Postgres 16 PITR backup capability and retention configuration [ASSUMED]
- Coolify Traefik label patterns for host-based routing + ACME wildcard [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack (versions + APIs): HIGH — all versions verified on npm; Drizzle RLS, Better Auth, Next.js middleware, Sentry setup confirmed from official docs
- CI anti-pitfall gate patterns: HIGH — standard shell grep/find; gitleaks-action@v2 documented
- Middleware.ts rename gotcha: HIGH — directly verified from Next.js docs (v16 changelog)
- next-safe-action v7→v8 breaking changes: HIGH — directly from migration guide
- @hookform/resolvers Zod 4 compatibility: HIGH — peerDependencies verified on npm
- Graphile-Worker internal API details: MEDIUM — homepage confirms features; exact SQL function signature [ASSUMED]
- Coolify deploy + Traefik labels: MEDIUM — pattern known from FB_APU04; Coolify-specific details [ASSUMED]
- LGPD compliance legal completeness: MEDIUM — technical mechanisms verified; legal text out of dev scope

**Research date:** 2026-06-11
**Valid until:** 2026-07-11 for stable packages (Next.js 15.x, Drizzle 0.45.x); re-verify graphile-worker API before implementing outbox pattern.
