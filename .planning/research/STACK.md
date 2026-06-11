# Stack Research

**Project:** FB_EVENTOS — Plataforma SaaS multi-tenant para gestão de grandes eventos
**Domain:** Multi-tenant SaaS / Event management / Marketplace BR
**Researched:** 2026-06-11
**Overall confidence:** HIGH (frameworks + libraries verified against npm registry and Context7 docs); MEDIUM (payment gateway commercial terms — based on Pagar.me/Asaas/Mercado Pago public API docs, fee schedules from training data and require contract verification).

---

## TL;DR — Stack Recommendation

| Layer | Choice | Version (locked) |
|-------|--------|------------------|
| **Full-stack framework** | **Next.js 15 (App Router) + Server Actions + Route Handlers** | `next@15.4.x` (NOT 16 — see Version Compatibility) |
| **Language** | TypeScript 5.6+ everywhere | `typescript@5.6.x` |
| **Database** | PostgreSQL 16 (Coolify managed) | `postgres:16-alpine` |
| **ORM** | Drizzle ORM + drizzle-kit | `drizzle-orm@0.45.2`, `drizzle-kit@0.31.x` |
| **Postgres driver** | postgres.js (low-overhead, supports `SET LOCAL`) | `postgres@3.4.x` |
| **Multi-tenancy** | **Row-Level Security (RLS) + `current_setting('app.tenant_id')`** | (Postgres native) |
| **Auth** | Better Auth (with organization plugin for multi-tenant) | `better-auth@1.6.x` |
| **Validation** | Zod 4 | `zod@4.4.x` |
| **UI components** | shadcn/ui + Radix primitives + Tailwind CSS 4 | `tailwindcss@4.3.x` |
| **Server-state** | TanStack Query | `@tanstack/react-query@5.101.x` |
| **Forms** | React Hook Form + Zod resolver | `react-hook-form@7.78.x` |
| **Floor plan (2D, v1)** | **Konva.js + react-konva** | `konva@10.3.x`, `react-konva@19.2.x` |
| **Floor plan (3D, v2+)** | Three.js + react-three-fiber | `three@0.184.x` (later) |
| **Payment gateway** | **Pagar.me v5** (primary) + Asaas (backup option) | `pagarme@5.x` REST API |
| **Real-time inventory locks** | Postgres `pg_notify` + SSE (Server-Sent Events) via Route Handler | (native + Next.js) |
| **Background jobs** | BullMQ + Redis | `bullmq@5.78.x`, `redis:7-alpine` |
| **File storage** | MinIO (S3-compatible, self-hosted in Coolify) | `minio@8.x` |
| **Email** | Resend | `resend@6.x` |
| **Observability** | Pino structured logs + Sentry | `pino@10.3.x`, `@sentry/nextjs@10.x` |
| **Orchestration** | Docker + Coolify + Traefik (reuse FB_APU04 pattern) | (infra) |

**Single-line rationale:** TypeScript end-to-end on Next.js 15 App Router gives a solo dev maximum velocity with Claude Code (one language, deep AI/IDE support, Server Actions remove most CRUD boilerplate); Drizzle + Postgres RLS gives bullet-proof tenant isolation enforced at the DB level (the lesson FB_APU04 didn't learn); Pagar.me v5 has native split-payment + PIX (mandatory for the marketplace fee model); Konva.js is the de-facto 2D interactive canvas library with a documented 3D upgrade path via Three.js.

---

## Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Next.js** | `15.4.x` (App Router) | Full-stack framework (React 19 SSR + Route Handlers + Server Actions) | Single repo, single deploy, single language. App Router + Server Actions kill ~60% of CRUD boilerplate (no manual API endpoint for every form). Largest LLM training corpus → best Claude Code productivity. Mature middleware for subdomain/host-based tenant routing (`middleware.ts` + `request.headers.get('host')`). |
| **React** | `19.2.x` | UI runtime | Server Components let you render tenant-scoped data on the server with zero client-side leakage. `useFormStatus`/`useOptimistic` replace ~80% of TanStack Query mutation boilerplate. |
| **TypeScript** | `5.6.x` | Type safety end-to-end | Server Actions auto-type form data with Zod. Drizzle infers DB types into RPC return types. Eliminates the Go-frontend type-drift class of bugs that FB_APU04 has (e.g., DTO mismatch). |
| **PostgreSQL** | `16-alpine` | Single source of truth | **Hard contract from PROJECT.md.** Mature RLS, `pg_notify`, JSONB for flexible event metadata, materialized views for dashboards, full-text search for marketplace. Version 16 over 15 (FB_APU04) for native logical replication on partitioned tables and improved `pg_stat_io`. |
| **Drizzle ORM** | `drizzle-orm@0.45.2`, `drizzle-kit@0.31.x` | Type-safe SQL with explicit migrations | Lightweight (no decorators, no metadata reflection), SQL-first (you can drop to raw SQL anytime — important for RLS policies & `pg_notify`), excellent multi-tenant patterns documented (`pgPolicy`, `pgTable.withRLS` since v1.0-beta.1). Migrations are plain SQL files = reviewable, reversible, no auto-self-heal magic like FB_APU04's destructive `DROP TABLE schema_migrations`. |
| **postgres.js** | `postgres@3.4.x` | PG driver under Drizzle | Supports `SET LOCAL app.tenant_id = ...` per-connection for RLS. Faster than `pg`. Drizzle's recommended driver since 2024. |
| **Better Auth** | `better-auth@1.6.x` | Authentication + sessions + organizations | TypeScript-native, framework-agnostic, has an official **organization plugin** that models multi-tenant ownership (org = tenant, with members & roles). Sessions stored in Postgres (no Redis required). Built-in OAuth, magic link, 2FA. **Replaces** the home-grown `golang-jwt/v5` + bcrypt + `auth.go` 21KB file in FB_APU04 — and its `claims["role"].(string)` panic risk. |
| **Zod** | `zod@4.4.x` | Runtime validation + type inference | Validates incoming Server Action form data, parses webhooks from Pagar.me, defines API contracts. v4 has ~10× smaller bundle and faster parse than v3. |

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **shadcn/ui** | `shadcn@3.x` (CLI) | Copy-paste accessible component library | Use for every form, dialog, table, dashboard. Replaces 28 raw `@radix-ui/*` imports of FB_APU04 with curated, themable components. |
| **Tailwind CSS** | `tailwindcss@4.3.x` | Styling | Required by shadcn/ui. v4 uses Oxide engine — 5-10× faster builds. |
| **TanStack Query** | `@tanstack/react-query@5.101.x` | Server-state cache for client components | Use for paginated lists, marketplace search, live dashboards. Most CRUD doesn't need it (Server Actions + `revalidatePath` handle it). |
| **React Hook Form** | `react-hook-form@7.78.x` + `@hookform/resolvers` | Complex forms | Required for the floor-plan lot configurator (many fields per lot, nested arrays for shapes). For simple forms, native Server Actions + `useFormState` suffice. |
| **Konva.js + react-konva** | `konva@10.3.x` + `react-konva@19.2.x` | 2D interactive floor plan (v1 — MANDATORY) | Use for: rendering uploaded PDF/image as background layer, drawing polygon lots, click/hover/drag interactions, transformer for resize, layer compositing. Has Vue/Svelte bindings too if framework changes later. See "Floor Plan: Why Konva" below. |
| **pdf.js (`pdfjs-dist`)** | `pdfjs-dist@4.x` | PDF → canvas image conversion | When organizadora uploads a planta PDF, render page 1 to a canvas and use it as Konva background. |
| **Three.js + react-three-fiber** | `three@0.184.x` + `@react-three/fiber@8.x` + `@react-three/drei@9.x` | 3D floor plan (v2/v3 — deferred) | Defer until v2. Konva polygons in v1 can carry an extra `extrude_height` prop today; v2 maps them to Three.js `ExtrudeGeometry` for a simple 2.5D upgrade before tackling DWG/IFC. |
| **BullMQ** | `bullmq@5.78.x` | Background jobs (Redis-backed) | Use for: webhook processing (Pagar.me retries), email sending, PDF generation, eventual NF-e dispatch. **Persisted in Redis**, not SQLite — addresses the FB_APU04 watermark anti-pattern by using a proper queue. |
| **Redis** | `redis:7-alpine` | BullMQ backend + Next.js cache + rate-limit | One Redis container in Coolify. Already proven in FB_APU04 compose (was unused there — here it has real jobs). |
| **MinIO** | `minio@8.x` | S3-compatible object storage | Uploaded plantas (PDF, JPG, PNG), digital contracts (PDF), vendor docs. Self-hosted in Coolify, S3 API — easy migration to AWS S3 if you outgrow it. Bucket-per-tenant for isolation + lifecycle policies for LGPD retention. |
| **Resend** | `resend@6.x` | Transactional email | Replaces `net/smtp` in FB_APU04. React Email templates, webhooks for bounces, deliverability dashboard. Free tier 3k/month suffices for pilot. |
| **Pino** | `pino@10.3.x` + `pino-pretty` | Structured JSON logs | Solves FB_APU04 missing-structured-logging concern. JSON output ships cleanly into Loki/CloudWatch later. |
| **@sentry/nextjs** | `@sentry/nextjs@10.x` | Error tracking + tracing | Free tier covers solo dev. Tags every event with tenant_id automatically via Sentry scope. |
| **date-fns + date-fns-tz** | `date-fns@4.x` | Date handling with America/Sao_Paulo TZ | Same choice as FB_APU04 frontend (proven). |
| **react-day-picker** | `react-day-picker@9.x` | Date picker UI | Pairs with date-fns. Used by shadcn `<Calendar />`. |
| **next-safe-action** | `next-safe-action@7.x` | Type-safe Server Actions with Zod | Wraps every Server Action with Zod input/output validation and structured error mapping. Eliminates the "raw FormData" pitfall. |
| **lucide-react** | `lucide-react@latest` | Icon set | Same as FB_APU04. shadcn default. |
| **tRPC** | `@trpc/server@11.x` | **OPTIONAL** type-safe RPC for mobile/3rd-party future | Skip in v1 — Server Actions cover the web app. Add only when you build a mobile app or expose APIs to fornecedores' systems. |

## Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **pnpm** | Package manager | Faster, disk-efficient, deterministic. Switch from npm (FB_APU04). |
| **Biome** | Lint + format (Rust-based, single binary) | Replace ESLint + Prettier (faster, one config). |
| **Vitest** | Unit + integration tests | First-class Vite/Next.js support. Required from day 1 (FB_APU04 has zero coverage). |
| **Playwright** | E2E browser tests | Critical for: floor-plan click flow, checkout flow, multi-tenant subdomain switch. |
| **Drizzle Studio** | DB GUI | `pnpm drizzle-kit studio` — browse data per tenant during dev. |
| **Docker Compose** | Local dev (`postgres`, `redis`, `minio`, `mailpit`) | Mirror Coolify production. |
| **Coolify** | Orchestrator (reuse FB_APU04 pattern) | Self-hosted PaaS on AWS EC2 / Hetzner. Handles Traefik + Let's Encrypt + GitHub Actions webhook. |
| **Traefik** | Edge router + TLS | Subdomain-per-tenant via wildcard cert + dynamic Host rules. |
| **GitHub Actions** | CI/CD | Build, test, push to GHCR, ping Coolify. Same pattern as FB_APU04. |
| **gitleaks (pre-commit)** | Secret scanning | Mandatory from day 1 (FB_APU04 had real credentials in committed `.env`). |

---

## Installation (Greenfield Bootstrap)

```bash
# 1. Scaffold Next.js 15 (App Router, TS, Tailwind, src/, ESLint off — Biome instead)
pnpm create next-app@latest fb_eventos \
  --typescript --tailwind --app --src-dir \
  --import-alias "@/*" --use-pnpm --no-eslint

cd fb_eventos

# 2. Core stack
pnpm add drizzle-orm@0.45.2 postgres@3.4.x
pnpm add -D drizzle-kit@0.31.x

# 3. Auth + validation
pnpm add better-auth@1.6.x zod@4.4.x next-safe-action@7.x

# 4. UI
pnpm dlx shadcn@latest init  # picks tailwind v4, base color, etc.
pnpm dlx shadcn@latest add button input form dialog dropdown-menu table sonner

# 5. Server-state + forms
pnpm add @tanstack/react-query@5.101.x react-hook-form@7.78.x @hookform/resolvers

# 6. Floor plan (2D)
pnpm add konva@10.3.x react-konva@19.2.x pdfjs-dist@4.x

# 7. Background jobs + cache
pnpm add bullmq@5.78.x ioredis

# 8. File storage + email + observability
pnpm add minio@8.x resend@6.x pino@10.3.x pino-pretty
pnpm add @sentry/nextjs@10.x

# 9. Payment gateway (REST, no official Node SDK from Pagar.me — use fetch + Zod)
# (No npm install — call Pagar.me REST API directly with typed wrappers)

# 10. Dev tooling
pnpm add -D @biomejs/biome vitest @vitest/ui @playwright/test
pnpm add -D @types/node tsx
```

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

---

## Multi-Tenancy Strategy — DECISION: RLS with `current_setting('app.tenant_id')`

This is the most important decision in this document. **Three strategies were considered.**

| Strategy | How | Pros | Cons | Verdict |
|---|---|---|---|---|
| **Schema-per-tenant** | One Postgres schema per organizadora; migrations applied to all schemas | Strong isolation | Migrations multiply by N tenants; backup/restore complex; `search_path` gymnastics; bad fit for marketplace queries that span tenants (e.g., "all open events near my city" for público final) | **REJECT** |
| **Row tagging only (`tenant_id` column, no RLS)** | Every query manually filters `WHERE tenant_id = ?` | Simple to implement | A single forgotten `WHERE` clause leaks data across tenants. Auditors hate it. No defense in depth. FB_APU04's config-stem isolation is this category and it failed. | **REJECT** |
| **Row-Level Security (RLS) + session-scoped tenant_id** ✅ | Every tenant-owned table has `tenant_id uuid not null`. Postgres `CREATE POLICY` on every table requires `tenant_id = current_setting('app.tenant_id')::uuid`. At connection acquisition, the API runs `SET LOCAL app.tenant_id = '<uuid>'`. | Isolation enforced by the database itself — forgotten WHERE = empty result set, not data leak. Cross-tenant marketplace queries use a separate `BYPASSRLS` role. Supabase, Drizzle, and Neon all document this pattern. | Requires discipline (every connection from the pool must be scoped before use). Bypass possible via superuser — so the runtime role must be **non-superuser**. | **ADOPT** |

**Concrete implementation:**

```sql
-- Tenant table (no RLS — global)
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subdomain text UNIQUE NOT NULL,        -- 'trindade', 'totustuus'
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- Tenant-owned table (RLS-enabled)
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  -- ...
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Application role (cannot bypass RLS)
CREATE ROLE app_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
-- Migrations still run as superuser
```

In the API (Drizzle + postgres.js):
```ts
// src/db/with-tenant.ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
const sql = postgres(process.env.DATABASE_URL!, { max: 20 });

export async function withTenant<T>(tenantId: string, fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`; // true = LOCAL
    const db = drizzle(tx);
    return fn(db);
  });
}
```

Every Server Action / Route Handler resolves the tenant_id from:
1. Subdomain (`trindade.fbeventos.com.br` → `tenants.subdomain = 'trindade'`)
2. Authenticated user's `organizationId` (Better Auth org plugin)

…and uses `withTenant()` for the whole request. **No raw `db` access outside this wrapper** — enforce via ESLint custom rule or Biome linter.

**Subdomain routing** (Next.js middleware):
```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
export function middleware(req: NextRequest) {
  const host = req.headers.get('host')!;
  const subdomain = host.split('.')[0];
  const isApex = ['www', 'app', 'fbeventos'].includes(subdomain);
  const url = req.nextUrl.clone();
  if (!isApex) url.searchParams.set('__tenant_subdomain', subdomain);
  return NextResponse.rewrite(url);
}
```

Confidence: **HIGH**. Pattern is verified in Drizzle docs (`pgTable.withRLS`, `pgPolicy`), Supabase docs (Realtime + RLS), and is the dominant 2024-2026 multi-tenant SaaS pattern.

---

## Payment Gateway — DECISION: Pagar.me v5 (primary) + Asaas (backup)

**Requirements:** PIX + Cartão (credit/debit), split-payment / marketplace mode (platform takes % of fornecedor sale), webhooks, recurring (assinatura mensal da organizadora), antifraude.

### Comparison Matrix

| Criterion | **Pagar.me v5** | **Mercado Pago** | **Asaas** | **Stripe BR** |
|-----------|-----------------|------------------|-----------|---------------|
| PIX support (v1 critical) | ✅ Native + QR + copia-cola | ✅ Native | ✅ Native | ⚠️ Via partner only (Q4-2025) |
| Cartão (credit/debit) | ✅ Multiple acquirers | ✅ | ✅ | ✅ |
| **Split payment / marketplace** | ✅ **First-class** (`split` object with `recipient_id`, `liable`, `charge_processing_fee`) | ✅ Via "Mercado Pago Marketplace" (more friction) | ✅ Via "split" payments | ❌ Stripe Connect not available BR |
| Recurring / subscriptions | ✅ Plans + subscriptions API | ✅ | ✅ Native | ✅ |
| Webhooks | ✅ Documented event types (`order.paid`, etc.) | ✅ | ✅ | ✅ |
| Antifraude | ✅ Built-in (Clearsale + own engine) | ✅ | ⚠️ Add-on | ✅ |
| Boleto | ✅ | ✅ | ✅ Strong | ✅ |
| Recipient onboarding (KYC) | ✅ API to create + manage recipients | ⚠️ Manual via dashboard | ✅ API | N/A |
| Fees (sample, PIX) | ~0.99% + R$0.49 | ~0.99% | 1.49% PIX (or R$1.99 boleto, no fee in basic plan) | International rates (USD-priced) |
| Solo-dev DX | ✅ REST docs are clear; community SDKs (PHP/Node) | ⚠️ Heavier docs, multiple products overlap (Checkout Pro vs API vs Bricks) | ✅ Clean docs; good for billing-heavy flows | ⚠️ BR product gaps |
| Maturity in BR | ✅ Owned by Stone (large acquirer) | ✅ Owned by Mercado Libre | ✅ Independent fintech | ⚠️ Limited BR coverage |

### Verdict: **Pagar.me v5**

**Why:**
1. **Split-payment is first-class.** The `split` array in the order payload directly maps `[ {recipient_id, amount, type: 'percentage'}, ... ]` and supports `liable` (who eats refunds) + `charge_processing_fee` (who pays the gateway fee) — exactly the marketplace shape FB_EVENTOS needs (organizadora keeps a slice, platform keeps a slice, fornecedor gets the rest).
2. **PIX with split** is a single API call (`payments[].payment_method = 'pix'` + `split` array). Verified in Pagar.me reference docs (Context7-fetched).
3. **Recipient onboarding via API** — when a new fornecedor signs up, the platform can KYC them and create a `recipient` programmatically, no manual dashboard work.
4. **Stone ownership** = robust acquirer settlement, less risk of payout delays.

**Backup plan: Asaas** as a fallback / alternative for organizers who already use Asaas. Asaas is excellent for billing-heavy flows (invoicing fornecedores monthly with NF-e add-on later). Pagar.me wins for v1 because of split + PIX maturity, but Asaas is the second integration to add in v2 if customer demand warrants.

**Explicit reject: Stripe BR** — at time of research, BR PIX/Marketplace gaps make it a poor fit for a v1 piloto. Reconsider when international expansion happens (Out of Scope per PROJECT.md).

**Implementation note:** Pagar.me does **not** publish an official Node SDK. Use `fetch` + Zod-typed wrappers + the REST API documented at `https://docs.pagar.me/reference`. This is fine — keeps the surface small and version-pinned via Zod schemas.

```ts
// src/payments/pagarme/client.ts
const PAGARME_API = 'https://api.pagar.me/core/v5';
export async function createPixOrder(input: PagarmePixOrderInput) {
  const res = await fetch(`${PAGARME_API}/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(process.env.PAGARME_SECRET_KEY + ':').toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(PagarmePixOrderSchema.parse(input)),
  });
  if (!res.ok) throw new PagarmeError(await res.json());
  return PagarmeOrderResponseSchema.parse(await res.json());
}
```

Confidence: **HIGH** on technical capabilities (verified via Pagar.me reference docs through Context7). **MEDIUM** on fee schedule (training data; verify on contract).

---

## Real-Time Inventory (Lot Locking) — DECISION: Postgres `pg_notify` + SSE

**Problem:** When fornecedor A clicks lot #42 to start checkout, fornecedor B viewing the same planta must see lot #42 turn red/locked within ~1s.

**Options evaluated:**

| Approach | Latency | Infra cost | Fit |
|---|---|---|---|
| **Polling** (TanStack Query refetch every 5s) | 5s | None | Acceptable v0; bad UX for "I clicked and someone took it 4 seconds ago" |
| **WebSockets** (socket.io / native ws) | <100ms | Sticky sessions or Redis adapter required for multi-instance | Overkill for v1 — Coolify single-instance is fine for piloto |
| **Server-Sent Events** (Next.js Route Handler streaming) + **Postgres `LISTEN/NOTIFY`** ✅ | <500ms | None beyond Postgres | Native to Next.js, one-way (server → client) which matches the use case, no separate WS server, scales horizontally with Redis pub/sub later if needed |

**Recommended pattern:**

```ts
// src/app/api/events/[eventId]/inventory-stream/route.ts
import postgres from 'postgres';
export async function GET(req: Request, { params }: { params: { eventId: string } }) {
  const stream = new ReadableStream({
    async start(controller) {
      const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
      await sql.listen(`event_inventory_${params.eventId}`, (payload) => {
        controller.enqueue(`data: ${payload}\n\n`);
      });
      req.signal.addEventListener('abort', () => { sql.end(); controller.close(); });
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

// On lot lock (Server Action):
await db.transaction(async (tx) => {
  await tx.update(lots).set({ status: 'locked', lockedBy: userId, lockExpiresAt: in15Min }).where(eq(lots.id, lotId));
  await tx.execute(sql`NOTIFY event_inventory_${eventId}, '{"lotId":"${lotId}","status":"locked"}'`);
});
```

**Lock TTL:** Lots are soft-locked for 15 minutes during checkout. A BullMQ scheduled job releases expired locks every minute.

Confidence: **HIGH**. `pg_notify` + SSE is the documented Next.js 15 pattern; postgres.js supports `LISTEN`/`NOTIFY` natively.

---

## Floor Plan — DECISION: Konva.js + react-konva (v1), Three.js path for v2

**Requirements (v1):** Upload PDF/image as background, draw clickable polygons over it for lots/zones, hover state, click to reserve, drag-resize during admin setup, zoom/pan.

### Library comparison

| Library | Type | Maturity | Fit | Verdict |
|---|---|---|---|---|
| **Konva.js + react-konva** | Canvas-based, OO API | 10+ years, 11k stars, active | Polygons (`Konva.Line` closed), images (`Konva.Image`), transformer (resize), drag-and-drop, event delegation by shape type. Has built-in `Konva.Stage` zoom/pan recipes. Docs are excellent and Context7-indexed (2,481 snippets). | ✅ **ADOPT** |
| **Fabric.js** | Canvas-based | Mature, ~30k stars | Similar capabilities, but namespace collision with Microsoft "Fabric" UI confuses search and Context7 returns Microsoft Fabric Docs by default — sign of lower discoverability. Less idiomatic React integration. | Reject (Konva wins on docs + react bindings) |
| **PixiJS** | WebGL-first | Mature, game-focused | Overkill for static planta; less natural fit for "click polygon → callback". | Reject |
| **SVG (raw + React)** | DOM-based | Always available | Excellent for ≤100 polygons. **Breaks down at 5k+ lots** (each polygon = DOM node). Festa de Trindade may have thousands of stands. | Reject as primary; OK fallback for tiny events |
| **Leaflet/MapLibre with image overlay** | Tile-based | Mature mapping | Great if you want pan-zoom-tile UX similar to Google Maps; learning curve and overkill if you're not doing geographic coords. Worth revisiting if pilotos add real GPS-tagged plantas. | Reject for v1 |

### Why Konva (verified via Context7)

- `Konva.Line` with `closed: true` renders an arbitrary polygon for each lot.
- `node.on('click', ...)` + event delegation (`layer.on('click', 'Lot', handler)`) gives clean React-style handlers without per-shape bindings.
- `Konva.Transformer` snaps to anchors/rotation for the admin "draw your lots" tool.
- `Konva.Image` accepts an `<img>` or `<canvas>` source — perfect for the planta background (PDF rendered to canvas via pdf.js, JPG/PNG used directly).
- React bindings (`react-konva@19.2.5`) are first-party from the Konva team.
- Pure canvas → 5k polygons stay responsive (single DOM node).

### v2 / v3 upgrade path to 3D

Konva polygons today carry `{points: [...], height?: number}`. In v2:
1. Use the same JSON (points + height) → feed into Three.js `ExtrudeGeometry` to make 2.5D extruded prisms.
2. Add `@react-three/fiber` + `@react-three/drei` (OrbitControls, Sky, etc.) for a 3D viewer.
3. For walking-tour / VR (v3), evaluate IFC.js / web-ifc when DWG/IFC import is in scope. Keep that decision deferred per PROJECT.md.

```ts
// Lot record (v1 and v2 compatible)
interface LotShape {
  points: number[];      // Konva.Line points (x1, y1, x2, y2, ...)
  fill?: string;
  extrudeHeight?: number; // metadata for v2 3D; unused in v1
  category: 'food' | 'merch' | 'sponsor' | 'service';
}
```

Confidence: **HIGH** (Konva docs Context7-verified; react-konva@19.x current as of 2026-06).

---

## Sympla / Eventbrite Integration (Fase 4)

| Provider | API status (training data + Context7 not found) | Approach |
|----------|------|----------|
| **Sympla** | Has an official "Sympla Partners API" (REST) — token-based. Webhooks available. | Use official REST API. Implement a "publish to Sympla" Server Action that pushes event metadata + ticket types. Subscribe to `order.confirmed` webhook for ticket counts. |
| **Eventbrite** | Has a v3 REST API (Bearer token, OAuth2). Recently rate-limited heavier (per LLM training cutoff). | Use OAuth2 flow for organizers to authorize. Avoid scraping (TOS violation, brittle). |

**v1 stance:** Per PROJECT.md ("Sem migração automática do Eventbrite no v1"), defer all bidirectional sync. v1 just stores an external `eventbrite_url` / `sympla_url` field on the event for marketplace cross-linking. v4 (Persona 4 — Público Final) adds official-API publish.

**Anti-pattern:** **Do not scrape** Eventbrite/Sympla HTML. Breaks weekly, TOS issues, blacklists.

Confidence: **MEDIUM** (training data; official API URLs and exact endpoints need verification at integration time — flag for Phase 4 research).

---

## LGPD Compliance — Stack-Level Hooks

LGPD requires: consentimento, retenção, direito ao esquecimento, portabilidade, registro de tratamento.

| Requirement | Stack-level implementation |
|---|---|
| **Consentimento** | Better Auth `additionalFields` to store `consent_version`, `consent_at`, `consent_ip` per user. Modal on first login when version bumps. |
| **Direito ao esquecimento** | Soft-delete by default (`deleted_at`); BullMQ job runs `anonymize_user(user_id)` after 30 days → replaces PII columns with hashes, keeps stats. Postgres `pgcrypto` for hashing. |
| **Retenção** | Per-table `retention_days` annotation + scheduled BullMQ purge. MinIO bucket lifecycle policies for uploaded files. |
| **Portabilidade** | Server Action `exportMyData()` → BullMQ job assembles JSON + uploads to MinIO + emails signed URL. |
| **Registro de tratamento** | Append-only `audit_log` Postgres table (insert via Drizzle trigger) — addresses FB_APU04's missing audit log gap. |
| **Data residency** | Coolify on a BR region (AWS São Paulo `sa-east-1` or Hetzner). Configure Postgres + MinIO in BR. |

**Stack additions specifically for LGPD:**
- `argon2` (or `bcrypt`) — already via Better Auth. ✅
- `pgcrypto` Postgres extension — hash PII at anonymization time.
- No additional npm package needed for v1.

Confidence: **HIGH** on technical mechanisms; **MEDIUM** on legal-specific text (DPA, política de privacidade) which is out of dev scope.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **SQLite, file-based `.db`, file watermark trackers** | **HARD CONTRACTUAL BAN** from PROJECT.md (line 58, 85) and FB_APU04 lesson: SQLite watermark grew unbounded, tenant isolation was config-stem-based (fragile, no validation), zero tests. **Any background job/worker MUST persist state in Postgres or Redis.** | Postgres tables for durable state. Redis (via BullMQ) for ephemeral job queues and locks. Never `import sqlite3`, never `*.db` files in volume mounts. CI grep gate: `! grep -rn "sqlite3\|\.db\b" src/` |
| **Self-healing schema migration logic (e.g., `DROP TABLE schema_migrations`)** | FB_APU04 `backend/main.go:160-170` silently destroys migration history if a column type mismatches. Catastrophic. | Drizzle migrations are explicit, file-based, idempotent ALTERs only. Never call `DROP TABLE schema_migrations` from app code. Migrations run via `drizzle-kit migrate` in a one-shot deploy step, not on every backend boot. |
| **Implicit "admin overrides all roles" in middleware** | FB_APU04 `withAuth(handler, "admin")` is ad-hoc and untested. | Better Auth + organization plugin with explicit role checks per Server Action. Wrap admin-only actions in `requireRole('admin', { explicit: true })`. |
| **Storing real secrets in committed `.env` / `.env.production`** | FB_APU04 has placeholder-but-real-looking secrets in committed files. | Two env files only: `.env.example` (committed, all placeholders) + `.env.local` (gitignored, dev). Production secrets in Coolify env UI. `gitleaks` pre-commit hook mandatory. |
| **Reset/Truncate endpoints without confirmation gate + pre-backup** | FB_APU04 2026-05-07 incident: one DELETE wiped 4 months of data. | Any destructive Server Action requires: (1) a per-request confirmation token from a prepare endpoint, (2) automatic `pg_dump` of affected tables before mutation, (3) audit log row, (4) startup allow-list of databases that may be reset. |
| **Watchtower auto-pulling `:latest`** | FB_APU04 bridge ships any `:latest` to all tenants within 5 min, no canary. | Version-tagged Docker images (`fb-eventos-web:1.2.3`). Coolify deploys are deliberate. No Watchtower. |
| **Frontend in a separate repo with a different language** | FB_APU04 Go backend + React frontend = type drift, double dependency tree, double CI, DTO mismatches not caught at compile time. | Next.js single repo — Drizzle types flow into Server Action return types into client components automatically. |
| **`fbtax/fb_apu01` module name reuse** | FB_APU04 still imports `fb_apu01/...` — confused contributors, caused 2026-05-07 wrong-binary deploy. | Project name = `fb-eventos` from day one. CI grep gate against `fb_apu0[1-9]` strings. |
| **MercadoPago Checkout Pro hosted redirect for v1** | Locks UX out of the marketplace flow, friction for fornecedores. | Pagar.me direct API + Transparent Checkout (own forms, you control UX). |
| **WebSockets via custom server for v1** | Adds infra (sticky sessions, Redis adapter), breaks `next start` simplicity. | SSE + `pg_notify` (single Next.js process, scales fine for pilot). Upgrade to WS only when bidirectional client→server low-latency is required. |
| **TypeORM, Prisma migrations magic, Sequelize** | TypeORM has unmaintained edges (last review showed Postgres bugs); Prisma was on the table but its query engine binary, migration limitations (no easy raw SQL for RLS policies), and recent licensing churn favor Drizzle. | Drizzle ORM. |
| **Go + React polyglot (FB_APU04 pattern as-is)** | Two languages, two dep trees, two CIs, manual DTO sync — slow for solo dev + Claude Code. Go is fantastic for high-perf services, but FB_EVENTOS is a CRUD/marketplace, not a high-throughput SPED ingester. | Next.js single-language. Reconsider Go for a future high-throughput sub-service (e.g., ticket scanning at the gate). |
| **Phoenix LiveView** | Real-time-first stack and would shrink lot-lock code; but Elixir/Erlang ecosystem is smaller, fewer Brazilian payment SDKs, and **less Claude Code training data → lower solo-dev velocity**. | Next.js + SSE pattern documented above. |
| **NestJS + separate React** | TypeScript end-to-end ✅ but NestJS adds decorator/Angular-style overhead with no real benefit for solo dev. | Next.js Server Actions are the same idea with less ceremony. |

---

## Alternatives Considered (when they would win)

| Recommended | Alternative | When the alternative wins |
|-------------|-------------|---------------------------|
| Next.js 15 (App Router) | **Phoenix LiveView** | If real-time were the dominant UX everywhere (1000s of concurrent floor-plan editors). Not the case here (mostly form-based CRUD with one real-time view). |
| Next.js 15 | **Remix 2 / React Router 7 (framework mode)** | If you wanted the most form-first / progressive-enhancement UX. Smaller community, less Claude Code training data. |
| Next.js 15 + Drizzle | **Go (FB_APU04 stack) + React** | If you outgrow a single Node process and need a high-throughput backend (ticket-scanning at-the-gate is a strong candidate for a Go sidecar in v3). |
| Drizzle ORM | **Prisma 6** | If you need an admin UI generator or are on a serverless deploy where the query engine binary is fine. Drizzle wins on RLS + raw SQL access. |
| Better Auth | **Auth.js (NextAuth) v5**, **Clerk**, **Lucia** | Clerk if you want zero-auth-code and accept a managed dependency; Auth.js if you need a specific OAuth provider not in Better Auth; Lucia is now in maintenance mode (its author endorsed Better Auth). |
| Pagar.me v5 | **Asaas** | If billing-heavy / NF-e-adjacent flows dominate (Asaas has stronger billing primitives). Plan to add Asaas as a second gateway in v2. |
| Konva.js | **SVG (raw React)** | If a particular event always has ≤100 lots, raw SVG is simpler. Konva still works fine for that case and gives the upgrade path; keep Konva. |
| SSE + pg_notify | **Supabase Realtime / Pusher / Socket.io** | If you need bidirectional WS, presence channels, or you move off self-hosted. Supabase would also collapse half the auth/storage/realtime stack into one vendor — reconsider for v2 if Coolify ops cost rises. |
| MinIO | **AWS S3** | When you outgrow a single-VM MinIO (~TBs of plantas/contratos). The MinIO API is S3-compatible — swap is a one-config change. |
| Resend | **AWS SES** | When free Resend tier (3k/mo) is exhausted and pricing favors SES. |
| Pino | **Winston** | Never. Pino is faster and structured by default. |

---

## Stack Patterns by Variant

**If the piloto needs to ship in <60 days (timeline pressure):**
- Drop **i18n**, advanced search, advanced reporting.
- Use **Vercel** (managed Next.js) for v1 instead of Coolify (1 hour to deploy vs days of infra work) — migrate to Coolify at v2 when you control the ops.
- Use **Clerk** instead of Better Auth (zero auth code; ~$25/mo at low scale).
- Use **Neon / Supabase Postgres** (managed) instead of self-hosted PG.

**If you outgrow a single Postgres at ~10k concurrent fornecedores:**
- Add a **read replica** for marketplace browse / dashboard queries (Drizzle supports a "reader DB" pattern).
- Move public-facing marketplace browse to a **CDN cache** (Next.js `revalidate` + `unstable_cache`).
- Partition `audit_log` and `lot_status_history` by month.

**If a particular tenant has >50k stands (Festa de Trindade scale):**
- Render the Konva canvas with **lazy chunking** (only render lots within the viewport — Konva supports culling via `clip`).
- Use **PostGIS** for spatial indexing of lots by (x,y) for fast viewport queries.
- Pre-bake static planta image tiles at zoom levels (similar to map tiles) — defer until measured pain.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `next@15.4.x` | `react@19.2.x`, `react-dom@19.2.x` | **Avoid `next@16` until ecosystem catches up** — released recently (npm shows 16.2.9 latest); shadcn, several plugins still target 15 LTS. Re-evaluate at v2. |
| `next@15.x` | `tailwindcss@4.x` | Tailwind v4 requires the Next.js PostCSS plugin update — follow shadcn init flow which handles this. |
| `react@19.2.x` | `react-konva@19.2.x` | react-konva tracks React major version. ✅ |
| `drizzle-orm@0.45.x` | `drizzle-kit@0.31.x`, `postgres@3.4.x` | Drizzle is still pre-1.0; pin exact patch in lockfile and review changelog before bumps. RLS API stabilized at v1.0.0-beta.1 — `pgTable.withRLS` recommended over deprecated `.enableRLS()`. |
| `better-auth@1.6.x` | `next@15.x`, `drizzle-orm@0.45.x` | Better Auth has a `drizzleAdapter` exported. |
| `bullmq@5.78.x` | `ioredis@5.x`, `redis@7.x` | BullMQ 5 dropped Node 16. Use Node 22 LTS. |
| `tailwindcss@4.x` | `shadcn@3.x` | shadcn CLI v3.x is the first to default to Tailwind 4. Re-init if migrating from v3. |
| `zod@4.x` | `next-safe-action@7.x`, `react-hook-form@7.78.x` (`@hookform/resolvers@5.x`) | Zod 4 has breaking API changes vs 3 (e.g., `z.string().email()` → `z.email()`). Pin one major across the project. |
| `node` | **Node 22 LTS** | Next.js 15 requires Node ≥18.18; pick 22 LTS for longest support. |

---

## Embedded-DB Anti-Pattern: Explicit Architecture Guard

Per PROJECT.md line 58 and 85, embedded databases are **contractually forbidden**. This is the load-bearing lesson from FB_APU04. Stack-level guards:

1. **No `sqlite3`, `better-sqlite3`, `bun:sqlite`, `@libsql/client` in `package.json`** — CI gate:
   ```bash
   ! grep -E '"(sqlite3|better-sqlite3|@libsql|bun:sqlite)"' package.json
   ```
2. **No `.db` files in `src/`, `volumes/`, or any deploy artifact** — CI gate:
   ```bash
   ! find . -path ./node_modules -prune -o -name "*.db" -print | grep .
   ```
3. **All worker/queue state in BullMQ (Redis) or Drizzle tables (Postgres)** — no file-based watermarks. Document this in `CONTRIBUTING.md`.
4. **Webhook idempotency keys live in a `webhook_events` Postgres table**, not a local file/SQLite cache.
5. **Background job durability** — BullMQ uses Redis AOF persistence; for "must not lose" semantics (payment webhook processing) write to Postgres first, then enqueue, in the same transaction (`pg_notify` triggers a worker to pick up the row).

---

## Reference Architecture vs FB_APU04

**Reuse from FB_APU04** (proven patterns):
- Docker + Coolify orchestration
- Traefik edge router + Let's Encrypt
- GitHub Actions → GHCR → Coolify deploy
- `America/Sao_Paulo` TZ in containers
- Healthcheck endpoint (`/api/health`)
- Multi-service compose for local dev (postgres, redis, minio, mailpit)

**Reject from FB_APU04** (debt to not import):
- Go + React polyglot → single-language Next.js
- Manual `net/http` routing → Next.js App Router conventions
- `lib/pq` raw queries everywhere → Drizzle + Zod everywhere
- `golang-jwt/v5` + bcrypt hand-rolled auth → Better Auth
- SQLite watermark bridge → Postgres + BullMQ
- `schema_migrations` self-heal on boot → `drizzle-kit migrate` one-shot
- Five env files → two (`.env.example` + `.env.local`)
- Stale module name `fb_apu01` → `fb-eventos` everywhere from day 1
- No tests → Vitest + Playwright mandatory from day 1
- No structured logs → Pino JSON from day 1
- No audit log → `audit_log` Postgres table with Drizzle trigger from day 1
- No request_id → Pino bindings + `x-request-id` middleware from day 1

---

## Open Questions / Flags for Later Research

1. **NF-e / NFSe path (v2+):** Asaas has NF-e add-ons; Pagar.me does not. If invoice automation is in scope at v2, plan for Asaas as the billing layer or integrate a dedicated provider (eNotas, NFe.io).
2. **Antifraude for high-value sponsorships:** Pagar.me's built-in Clearsale may not suffice at >R$50k transactions; evaluate Konduto / Cybersource as v2 hardening.
3. **Sympla/Eventbrite API specifics:** Exact endpoints, rate limits, OAuth2 vs API-key — verify at Phase 4 research milestone.
4. **CDN strategy for marketplace public site:** Cloudflare in front of Coolify? Vercel for the public marketplace + Coolify for the tenant admin? Decide at v2.
5. **Postgres extension availability on Coolify-managed PG:** `pgcrypto` for LGPD hashing, `pg_trgm` for fuzzy event search, `postgis` for spatial queries on plantas — confirm Coolify's postgres image includes them or build a custom image.
6. **Better Auth organization plugin maturity:** Verify the role/permission model fits the four personas before v1 ships; fallback is hand-rolled RBAC in a `permissions` table.

---

## Sources

**Context7 (HIGH confidence — current docs verified):**
- `/vercel/next.js` — App Router, Server Actions, multi-zone routing, middleware
- `/drizzle-team/drizzle-orm-docs` — RLS via `pgTable.withRLS`, multi-tenant patterns with `tenantsTable` + `tenant_id`, Supabase integration
- `/konvajs/konva` — `Konva.Line` closed polygons, event delegation, `Konva.Transformer`, stage zoom/pan
- `/konvajs/react-konva` — React bindings, v19.2 tracks React 19
- `/websites/pagar_me_reference` — PIX order with `split` array, webhook `order.paid` payload, recipients API
- `/llmstxt/asaas_llms_txt` — PIX webhook validation, payment notification structure, split-payment support
- `/mercadopago/sdk-nodejs` — Payments + refunds API (verified for completeness comparison)
- `/supabase/supabase` — RLS policy patterns, Realtime + RLS integration with replica identity
- `/better-auth/better-auth` — Framework-agnostic auth, organization plugin, drizzle adapter
- `/tanstack/query` — v5.101.x server-state patterns
- `/shadcn-ui/ui` — v3.x CLI, Tailwind 4 default
- `/porsager/postgres` — postgres.js driver, `LISTEN/NOTIFY` support, `SET LOCAL` for RLS
- `/minio/docs` — S3-compatible object storage

**npm registry (HIGH confidence — versions verified live on 2026-06-11):**
- `next@16.2.9` (latest), recommend pinning to `15.4.x` LTS
- `react@19.2.7`
- `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`
- `@tanstack/react-query@5.101.0`
- `konva@10.3.0`, `react-konva@19.2.5`
- `better-auth@1.6.16`
- `zod@4.4.3`
- `react-hook-form@7.78.0`
- `tailwindcss@4.3.0`
- `postgres@3.4.9`
- `mercadopago@3.1.0`
- `three@0.184.0`
- `bullmq@5.78.0`
- `minio@8.0.7`
- `pino@10.3.1`
- `@sentry/nextjs@10.57.0`
- `resend@6.12.4`

**FB_APU04 reference (HIGH confidence — repository analysis):**
- `/tmp/FB_APU04/.planning/codebase/STACK.md` — what to inherit (Docker, Coolify, Traefik, TZ)
- `/tmp/FB_APU04/.planning/codebase/CONCERNS.md` — what to NOT inherit (SQLite watermark, schema-migration self-heal, AuthMiddleware admin bypass, missing tests, no audit log, committed secrets, destructive endpoints without backup)

**Training data (MEDIUM confidence — flag for verification):**
- Pagar.me / Asaas / Mercado Pago fee schedules (verify with current commercial proposals)
- Sympla / Eventbrite API endpoint specifics (verify at Phase 4 research)
- LGPD legal-text obligations (verify with legal counsel)

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Next.js + Drizzle + Postgres stack choice | **HIGH** | Verified versions on npm; Context7 confirms current API patterns; ubiquitous in 2026 SaaS |
| Multi-tenancy via RLS | **HIGH** | Drizzle official `pgTable.withRLS` + `pgPolicy` API + Supabase patterns verified |
| Pagar.me as primary gateway | **HIGH** technical / **MEDIUM** commercial | Split-payment + PIX verified in Pagar.me reference docs; fees from training data |
| Konva.js for 2D floor plan | **HIGH** | Context7 has 2,481 snippets; verified `Konva.Line` closed polygons + Transformer + events |
| SSE + `pg_notify` for real-time | **HIGH** | Native Next.js + postgres.js LISTEN/NOTIFY documented |
| Better Auth + organization plugin | **HIGH** | Verified `better-auth@1.6.16` on npm with organization plugin docs |
| Embedded-DB ban enforcement | **HIGH** | Direct CI gates specified; matches PROJECT.md hard constraint |
| Sympla/Eventbrite integration spec | **MEDIUM** | Defer details to Phase 4 research |
| LGPD legal completeness | **MEDIUM** | Stack covers technical mechanisms; legal text out of dev scope |
| Three.js v2/v3 upgrade path | **MEDIUM** | Path is sound but DWG/IFC complexity is a v2 deep-dive |

---

*Stack research for: FB_EVENTOS — Multi-tenant SaaS for large-event management (Brazilian religious mass events as piloto)*
*Researched: 2026-06-11*
