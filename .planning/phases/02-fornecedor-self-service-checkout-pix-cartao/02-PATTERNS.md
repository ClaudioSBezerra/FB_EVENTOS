# Phase 2: Fornecedor Self-Service + Checkout PIX/Cartão — Pattern Map

**Mapped:** 2026-06-14
**Files analyzed:** 39 (8 schemas + 4 actions extends + 7 new actions + 6 worker tasks + 7 routes/pages + 1 SSE + 3 ADRs + 1 component + 2 lib helpers)
**Analogs found:** 39/39 (100% coverage — Phase 0+1 left a dense template surface)

> **Mandate:** The planner consumes this file. For each Phase 2 new-or-modified file, pick the listed analog and copy the excerpt verbatim into the task action. Do not invent new patterns — the codebase has 16 migrations, 39 typed Server Actions, and 4 worker tasks of established convention. Phase 2 is integration, not invention.

---

## File Classification

### Group A — Refactor existing Phase 1 files (extend pattern, do not rewrite)

| File (existing → Phase 2 delta) | Role | Data Flow | Match |
|---------------------------------|------|-----------|-------|
| `src/lib/pagarme/client.ts` (+ installments, +DELETE cancelCharge, +DELETE refundCharge, +boleto path → DEFERRED per AM-01) | service / REST wrapper | request-response | self-extend |
| `src/lib/pagarme/types.ts` (+ refund response, +webhook event subtypes for `charge.refunded`/`charge.partial_canceled`/`order.canceled`, +installments echo) | model / Zod schemas | request-response | self-extend |
| `src/app/api/webhooks/pagarme/route.ts` (Basic Auth → HMAC; inline FSM → inbox+enqueue; <100ms) | route handler / webhook | event-driven | self-extend |
| `src/lib/actions/payments.ts` `createCharge` (single-lot → cart with lot+add-ons; direct INSERT → outbox emit + tx side-effects) | service action | CRUD + transform | self-extend |
| `src/components/eventos/planta-editor.tsx` (`mode: 'editor'\|'dashboard'` → add `'buyer'`; click → SSE-aware checkout sidebar) | component | event-driven (SSE consumer) | self-extend |
| `src/jobs/runner.ts` (empty `crontab: ''` → register `* * * * * outbox.drain` + `* * * * * reservation.expire`) | config / worker bootstrap | scheduling | self-extend |
| `src/jobs/tasks/index.ts` (3 tasks → +6 outbox handlers + 6 new task ids) | config / registry | n/a | self-extend |

### Group B — New schema files (8 tables + 2 tenants columns)

| New file | Role | Data Flow | Closest analog | Match |
|----------|------|-----------|----------------|-------|
| `src/db/schema/event_addons.ts` | model | CRUD | `src/db/schema/lots.ts::lotCategories` | exact |
| `src/db/schema/cart_addon_lines.ts` | model | CRUD | `src/db/schema/lots.ts::lots` | role-match |
| `src/db/schema/lot_reservations.ts` | model | CRUD + TTL | `src/db/schema/vendors.ts::lotAssignments` (UNIQUE-active pattern) | exact |
| `src/db/schema/lot_waitlist.ts` | model | event-driven | `src/db/schema/vendors.ts::vendorApplications` | exact |
| `src/db/schema/outbox_events.ts` | model | event-log | `src/db/schema/audit.ts::auditLog` (append-only) — but FORCE RLS pattern | role-match |
| `src/db/schema/payment_webhooks_inbox.ts` | model | event-driven | `src/db/schema/contracts.ts::zapsignDocuments` (gateway-id PK pattern) | exact |
| `src/db/schema/vendor_consents.ts` | model | CRUD + audit | `src/db/schema/consent.ts::consentRecords` (Phase 0) | exact |
| `src/db/schema/refund_requests.ts` | model | CRUD + FSM | `src/db/schema/payments.ts::payments` (gateway + status FSM) | exact |
| `src/db/schema/tenants.ts` (+ `vendor_auto_approve bool`, `refund_policy_json jsonb`) | model | extend | self | self-extend |

### Group C — New Drizzle migrations

| New migration | Role | Data Flow | Closest analog | Match |
|--------------|------|-----------|----------------|-------|
| `0017_phase2_domain_tables.sql` (CREATE all 8 tables + ENABLE RLS) | migration | DDL | `0010_phase1_domain_tables.sql` | exact |
| `0018_phase2_force_rls.sql` (FORCE RLS + COMMENT ON COLUMN PII + GRANTs) | migration | DDL | `0011_phase1_force_rls.sql` | exact |
| `0019_pagarme_inbox_migrator_select.sql` (SELECT-only policy for `fb_eventos_migrator` on `payment_webhooks_inbox`) | migration | DDL | `0014_zapsign_webhook_tenant_lookup.sql` | exact |
| `0020_tenants_phase2_columns.sql` (ALTER tenants add `vendor_auto_approve`, `refund_policy_json`) | migration | DDL | `0016_tenant_platform_commission.sql` | exact |

### Group D — New Server Actions (pure-helper + thin-action split per Phase 1 convention)

| New file | Role | Data Flow | Closest analog | Match |
|----------|------|-----------|----------------|-------|
| `src/lib/actions/reservations.ts` (reserveLot, releaseReservation) | service action | CRUD + lock | `src/lib/actions/lot-assignments.ts` | exact |
| `src/lib/actions/cart.ts` (addAddon, removeAddon, computeTotal) | service action | CRUD | `src/lib/actions/lot-categories.ts` | exact |
| `src/lib/actions/checkout.ts` (PIX/cartão branch) | service action | request-response | `src/lib/actions/payments.ts::createChargeInTenant` | exact |
| `src/lib/actions/refunds.ts` (requestRefund + 4-tier policy) | service action | CRUD + external | `src/lib/actions/payments.ts` (audit-out-of-band on API fail) | exact |
| `src/lib/actions/waitlist.ts` (joinWaitlist, leaveWaitlist, consumeWaitlistToken) | service action | event-driven | `src/lib/actions/lot-assignments.ts` (assign+audit) | exact |
| `src/lib/actions/signup-fornecedor.ts` (slug → auth.addMember → vendor INSERT) | service action | CRUD | `src/lib/actions/fornecedores.ts::createVendorInTenant` | role-match |
| `src/lib/actions/vendor-consents.ts` (recordConsent, revokeConsent) | service action | CRUD + audit | `src/lib/actions/consent.ts::recordConsentMetadata` | exact |

### Group E — New lib helpers

| New file | Role | Data Flow | Closest analog | Match |
|----------|------|-----------|----------------|-------|
| `src/lib/pagarme/hmac.ts` | utility | transform | `src/lib/zapsign/client.ts` (verifyBasicAuth shape) | role-match |
| `src/lib/outbox/emit.ts` | utility | event emission | `src/jobs/enqueue.ts::enqueueJob` (in-tx insert) | role-match |
| `src/lib/waitlist/jwt.ts` | utility | sign/verify | NONE (jose library — research §Pattern 5; new shape) | no analog |
| `src/lib/refund/policy.ts` | utility | pure compute | `src/lib/lots/price.ts` (pure pricing helper) | exact |

### Group F — New Graphile-Worker tasks (Pitfall 8: withTenant inside)

| New file | Role | Data Flow | Closest analog | Match |
|----------|------|-----------|----------------|-------|
| `src/jobs/tasks/outbox-drain.ts` | scheduled task | batch | `src/jobs/tasks/zapsign-send-contract.ts` (Task shape) + raw `migratorPool` (cross-tenant drain) | role-match |
| `src/jobs/tasks/reservation-expire.ts` | scheduled task | batch | same | role-match |
| `src/jobs/tasks/payment-process-webhook.ts` | on-demand task | event-driven | `src/jobs/tasks/zapsign-send-contract.ts` (withTenant + re-fetch) | exact |
| `src/jobs/tasks/waitlist-notify-next.ts` | on-demand task | event-driven | `src/jobs/tasks/email-send-status-update.ts` (resolveRecipients + sendEmail + audit) | exact |
| `src/jobs/tasks/refund-process.ts` | on-demand task | external | `src/jobs/tasks/zapsign-send-contract.ts` (external POST + audit) | exact |
| `src/jobs/tasks/lot-notify-channel.ts` | scheduled / one-shot | pub-sub | `src/jobs/enqueue.ts` template (uses `migratorPool` raw `pg_notify`) | role-match |
| `src/jobs/outbox/handlers/{payment-paid,payment-failed,lot-reserved,lot-sold,lot-released,refund-created}.ts` | handler | event handler | `src/jobs/tasks/email-send-status-update.ts` (per-event switch) | role-match |

### Group G — New routes/pages

| New file | Role | Data Flow | Closest analog | Match |
|----------|------|-----------|----------------|-------|
| `src/app/[slug]/fornecedor/cadastro/page.tsx` | page | form | `src/app/(auth)/signup/page.tsx` + signup-form.tsx | exact |
| `src/app/[slug]/marketplace/page.tsx` | page | list | `src/app/[slug]/eventos/page.tsx` (session+tenant+withTenant boilerplate) | exact |
| `src/app/[slug]/marketplace/[eventId]/page.tsx` | page | detail | `src/app/[slug]/eventos/[eventId]/page.tsx` | exact |
| `src/app/[slug]/marketplace/[eventId]/planta/page.tsx` | page | canvas (buyer) | `src/app/[slug]/eventos/[eventId]/planta/page.tsx` (mount PlantaEditor mode='dashboard') | exact |
| `src/app/[slug]/checkout/[cartId]/page.tsx` | page | multi-step | `src/app/[slug]/contratos/[contractId]/page.tsx` (long-form detail+actions) | role-match |
| `src/app/[slug]/portal/page.tsx` + sub-routes | page | dashboard | `src/app/[slug]/dashboard/page.tsx` | exact |
| `src/app/api/sse/events/[eventId]/lots/route.ts` | route handler / SSE | streaming | NONE (new shape) — research §Pattern 3 is canonical | no analog |
| `src/components/checkout/checkout-sidebar.tsx` | component | form | `src/components/contracts/create-charge-button.tsx` (dialog + method picker) | exact |
| `src/components/checkout/installments-table.tsx` | component | display | `src/components/payments/pix-qr.tsx` | role-match |
| `src/components/portal/*.tsx` | component | display | `src/components/dashboard/financial-cards.tsx` | exact |

### Group H — ADRs

| New file | Role | Closest analog | Match |
|----------|------|----------------|-------|
| `docs/adr/0005-webhook-hmac-strategy.md` | doc | `docs/adr/0002-e-sign-provider.md` (provider-with-webhook ADR shape) | exact |
| `docs/adr/0006-outbox-pattern.md` | doc | `docs/adr/0001-queue-backend.md` (queue-mechanism ADR shape) | exact |
| `docs/adr/0007-refund-policy.md` | doc | `docs/adr/0003-pricing-model.md` (configurable-policy ADR shape) | exact |

---

## Pattern Assignments

### `src/lib/pagarme/client.ts` (extend — service, request-response)

**Existing code** at `src/lib/pagarme/client.ts:30-130`. Phase 2 ADDS three exports keeping the same shape (fetch + `buildAuthHeader()` + `pagarmeXxxResponseSchema.parse`).

**Imports + auth pattern to copy verbatim** (lines 30-63):

```typescript
import {
  PagarmeApiError,
  PagarmeNotConfiguredError,
  type PagarmeOrderCreateRequest,
  type PagarmeOrderResponse,
  pagarmeOrderResponseSchema,
} from './types'

const PAGARME_BASE = 'https://api.pagar.me/core/v5'

function getSecretKey(): string {
  const k = process.env.PAGARME_SECRET_KEY
  if (!k) throw new PagarmeNotConfiguredError()
  return k
}

function buildAuthHeader(): string {
  const secret = getSecretKey()
  // Trailing colon is LOAD-BEARING per Pagar.me v5 Basic Auth contract
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`
}
```

**Existing GET pattern to MIRROR for new `cancelCharge`** (lines 116-130):

```typescript
export async function getOrder(orderId: string): Promise<PagarmeOrderResponse> {
  const res = await fetch(`${getPagarmeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: { Authorization: buildAuthHeader(), Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new PagarmeApiError(res.status, text)
  }
  const json = await res.json()
  return pagarmeOrderResponseSchema.parse(json)
}
```

**What changes for Phase 2 (per AM-04 verified Pagar.me v5 endpoint shape):**
- Add `cancelCharge(chargeId, opts?: { amount?: number })` — `DELETE /core/v5/charges/{id}` with optional `{ amount }` JSON body (partial refund). NOT `POST /charges/{id}/refunds` (CONTEXT D-08 was wrong; RESEARCH A10 verified DELETE).
- Add `installments` field in the credit_card payment payload (1..12, integer) — Pagar.me echoes the calculated `installment_amount` in response.
- DROP the boleto path planned in CONTEXT D-04 (AM-01 superseded — Phase 2 ships PIX+cartão only).
- Add `verifyWebhookSignature(rawBody, sig, secret)` helper in NEW file `src/lib/pagarme/hmac.ts` (see Group E below).
- Header name (`X-Hub-Signature` vs `X-ME-WEBHOOK-SIGNATURE`) MUST be probe-verified at execute-time per AM-02 — emit a probe-test task BEFORE writing the webhook refactor.

---

### `src/app/api/webhooks/pagarme/route.ts` (refactor — webhook, event-driven)

**Existing handler** at `src/app/api/webhooks/pagarme/route.ts:114-294`. Phase 2 REPLACES Basic Auth + inline FSM with HMAC + inbox INSERT + enqueue.

**Existing structure to preserve** (basic-auth replacement plus re-fetch defense stays):

```typescript
// Lines 114-130 — entry point: auth → parse → tenant resolve
export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Auth.
  if (!verifyBasicAuth(req)) {
    log.warn('unauthorized webhook delivery (Basic Auth failed)')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // 2. Parse + validate payload.
  let parsed: PagarmeWebhookEvent
  try {
    const raw = (await req.json()) as unknown
    parsed = pagarmeWebhookEventSchema.parse(raw)
  } catch (err) {
    return NextResponse.json({ ok: true, ignored: 'invalid_payload' }, { status: 200 })
  }
```

**Existing migrator-pool tenant resolution to preserve** (lines 78-90):

```typescript
async function resolveTenantForOrderId(orderId: string): Promise<{
  tenantId: string
  paymentId: string
} | null> {
  const rows = await migratorPool<Array<{ tenant_id: string; id: string }>>`
    SELECT tenant_id, id
      FROM payments
     WHERE gateway_order_id = ${orderId}
     LIMIT 1
  `
  const r = rows[0]
  return r ? { tenantId: r.tenant_id, paymentId: r.id } : null
}
```

**Existing belt-and-suspenders re-fetch (PRESERVE per Phase 1 D-13 + AM-02)** (lines 161-172):

```typescript
let apiOrder: Awaited<ReturnType<typeof getOrder>>
try {
  apiOrder = await getOrder(orderId)
} catch (err) {
  log.error({ err, orderId }, 'Pagar.me API re-fetch failed — returning 400 so Pagar.me retries')
  return NextResponse.json({ error: 'refetch_failed' }, { status: 400 })
}
```

**What changes for Phase 2 (D-13/D-14/D-15 + AM-02):**

1. **REPLACE `verifyBasicAuth`** with `verifyWebhookSignature(rawBody, sig, secret)` from `src/lib/pagarme/hmac.ts`.
2. **Read body as raw bytes BEFORE JSON.parse** (Pitfall 1): `const rawBody = Buffer.from(await req.arrayBuffer())` — HMAC must be over the exact bytes.
3. **INSERT into `payment_webhooks_inbox` with `gateway_event_id` PK + `ON CONFLICT DO NOTHING`** — uses the existing `migratorPool` pattern (line 35: `import { migratorPool } from '@/db/migrator-pool'`). Add `tenant_id` denormalization per Open Q4 (resolve tenant via existing `resolveTenantForOrderId` BEFORE the inbox INSERT, store on the row).
4. **Enqueue `payment.process-webhook` task** (NOT inline FSM) — pass `{inbox_id, tenant_id}` via `enqueueJob(migratorPool, 'payment.process-webhook', {inbox_id, tenant_id})`. The handler does the re-fetch + FSM + outbox emit inside `withTenant`.
5. **Return 200 in <100ms** — performance assertion test required (Plan FORN-12).
6. The new `payment.process-webhook` worker task **inherits** the existing Lines 178-272 logic (FSM transitions + terminal-state idempotency + `payment.paid` email enqueue) — it's a literal move, NOT a rewrite. Wrap in `withTenant(payload.tenant_id, ...)` per Pitfall 8.

---

### `src/lib/actions/payments.ts` `createCharge` (refactor — service, CRUD + transform)

**Existing helper** at `src/lib/actions/payments.ts:144-343` ships single-lot PIX/cartão. Phase 2 adds cart + add-ons + outbox emit.

**Pure-helper + thin-action split pattern (lines 442-449) — KEEP this shape**:

```typescript
export const createCharge = withTenantAction
  .inputSchema(createChargeSchema)
  .action(async ({ ctx, parsedInput }) => {
    const result = await createChargeInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath('/[slug]/cobrancas', 'page')
    revalidatePath(`/[slug]/cobrancas/${result.payment.id}`, 'page')
    return result
  })
```

**Existing idempotency key generation (PRESERVE — Phase 2 reuses verbatim)** (lines 117-122):

```typescript
const PIX_EXPIRES_IN_SECONDS = 3600 // 1h — Phase 1 default
function generateIdempotencyKey(contractId: string): string {
  return `payment-${contractId}-${randomBytes(8).toString('hex')}`
}
```

**Existing audit-out-of-band on API failure (PRESERVE — refund + checkout reuse the same shape)** (lines 263-283, 404-414):

```typescript
} catch (err) {
  const failureReason =
    err instanceof PagarmeApiError ? `Pagar.me ${err.status}`
    : err instanceof Error ? err.message : String(err)
  // Independent transaction so the audit row survives the outer rollback.
  await recordAuditOutOfBand(tenantId, {
    action: 'payment.create_failed',
    entity: 'payment',
    entityId: payment.id,
    userId,
    payload: { contract_id: input.contractId, method: input.method, error: failureReason },
  })
  throw err
}
// ...
async function recordAuditOutOfBand(tenantId: string, opts: RecordAuditOptions): Promise<void> {
  try {
    await withTenant(tenantId, async (db) => {
      await recordAudit(db, opts)
    })
  } catch (auditErr) {
    console.error('recordAuditOutOfBand failed', auditErr)
  }
}
```

**Existing unique-violation walk-cause-chain (PRESERVE — outbox + inbox idempotency uses the same)** (lines 421-436):

```typescript
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  let depth = 0
  while (cur && depth < 5) {
    if (typeof cur === 'object' && cur !== null) {
      const code = (cur as { code?: unknown }).code
      if (code === '23505') return true
      cur = (cur as { cause?: unknown }).cause
    } else { break }
    depth += 1
  }
  return false
}
```

**Existing `rawSqlFromTenantDb` extraction (PRESERVE — required for enqueueJob inside withTenant)** — from `src/jobs/raw-sql-from-tenant-db.ts:20-25` and used at `src/app/api/webhooks/pagarme/route.ts:267`:

```typescript
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
// inside withTenant(tenantId, async (db) => { ... }):
await enqueueJob(rawSqlFromTenantDb(db), 'task.name', { tenant_id: tenantId, ... })
```

**What changes for Phase 2:**

1. **Move createCharge to NEW `src/lib/actions/checkout.ts`** — the existing `payments.ts::createCharge` becomes the "back-end of checkoutCart", invoked AFTER reservation + cart validation. Phase 2 introduces a new `checkoutCart(cartId, method, installments?)` Server Action; the OLD createCharge (signed-contract → PIX) stays callable for Phase 1 organizadora-driven flows (per Plan 01-06 SUMMARY which documents this as the carryover).
2. **Cart aggregation**: total = lot price (computeLotPrice from `src/lib/lots/price.ts`) + sum(`cart_addon_lines.price_brl_cents`). Items array becomes one line per (lot, addon×N) — Pagar.me `items` accepts multi-line.
3. **Add `installments: 1..12` field** in credit_card payload (D-03) — Pagar.me calculates juros.
4. **Replace direct `INSERT payments + UPDATE` with outbox emit pattern** — at the end of the happy path, INSERT `outbox_events` row (`event_type='payment.created'`, `aggregate_id=payment_id`, `payload={contract_id, vendor_id, lot_id, addons}`) inside the SAME transaction as the payments INSERT. Use the new `emitOutboxEvent(db, eventType, aggregateId, payload)` helper (see Group E).
5. **PIX hot path**: createCharge response carries PIX QR — return it inline (no waiting for webhook).
6. **Boleto path: DELETE** (per AM-01). The `payment_method` enum drops `boleto`.

---

### `src/components/eventos/planta-editor.tsx` (extend — component, event-driven)

**Existing component** at `src/components/eventos/planta-editor.tsx:1-762`. Already supports `mode: 'editor' | 'dashboard'`. Phase 2 adds `'buyer'`.

**Existing mode discrimination pattern (lines 60, 167-176)** — Phase 2 mirrors this exactly:

```typescript
export type PlantaEditorMode = 'editor' | 'dashboard'   // ← add 'buyer'

export interface DashboardLotMeta {
  id: string
  status: string
  priceBRL: number
  categoryName: string
  vendorLegalName: string | null
  colorFill: string
  colorStroke: string
}

interface PlantaEditorProps {
  // ...
  mode?: PlantaEditorMode  // ← Phase 2: 'editor' | 'dashboard' | 'buyer'
  dashboardLots?: Record<string, DashboardLotMeta>
  // ← Phase 2 ADD: buyerLots?: Record<string, BuyerLotMeta>
  // ← Phase 2 ADD: onLotClicked?: (lotId: string) => void
}
```

**Existing click filtering pattern (lines 601-612) — Phase 2 mirrors for 'buyer'**:

```typescript
onClick={(e: KonvaEventObject<MouseEvent>) => {
  if (isDashboard) {
    // Open the dashboard popover near the click point.
    const stage = e.target.getStage?.() as any
    const pos = stage?.getPointerPosition?.()
    if (pos) setPopover({ lotId: lot.id, x: pos.x, y: pos.y })
    return
  }
  if (mode === 'select') setSelectedId(lot.id)
}}
```

**Existing inline-popover pattern (lines 708-761) — Phase 2 reuses the structural skeleton for the buyer-side checkout sidebar** (or returns a callback-based open via `onLotClicked` prop and renders the sidebar in the parent page).

**Existing color-by-status logic (lines 571-589)** — Phase 2 buyer mode reuses dashboardLots map keyed off `status`:

```typescript
if (isDashboard && dashboardLots?.[lot.id]) {
  const meta = dashboardLots[lot.id]
  if (meta) {
    fill = `${meta.colorFill}40`
    stroke = meta.colorStroke
  } else {
    fill = `${DEFAULT_FILL}40`
    stroke = DEFAULT_STROKE
  }
}
```

**What changes for Phase 2 (D-19/D-20):**

1. **Add `'buyer'` to `PlantaEditorMode` union.** Buyer mode = dashboard mode + click handler enabled only for `status='available'` lots. Lots with `status='sold'` or `status='reserved'` get `cursor: not-allowed` + grey fill + no click handler attachment.
2. **Add SSE subscription** via `EventSource('/api/sse/events/{eventId}/lots')` inside a new `useEffect` keyed on `eventId` when `mode === 'buyer'`. On message, update `dashboardLots[lot_id].status` + recolor. Cleanup on unmount calls `eventSource.close()`.
3. **Add `onLotClicked` callback prop** that the parent page (`/[slug]/marketplace/[eventId]/planta`) wires to open the new `CheckoutSidebar` component.
4. **DO NOT add a new mode discriminator outside the existing `isDashboard` boolean** — pass the buyer-mode props through the same `dashboardLots` map (with a single new optional `clickableWhenAvailable` boolean prop) to minimize component-state explosion. The popover from dashboard mode stays mounted but its DOM is hidden in buyer mode (or moved to the sidebar).

---

### `src/jobs/runner.ts` (extend — config, scheduling)

**Existing bootstrap** at `src/jobs/runner.ts:49-83`. Phase 2 populates the empty `crontab: ''`.

**Existing pattern (lines 49-72)**:

```typescript
export async function startWorker(): Promise<Runner> {
  logger.info({ component: 'graphile-worker', concurrency: 5, taskNames: Object.keys(taskList) }, 'starting worker')

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 5,
    noHandleSignals: false,
    // Empty crontab in Phase 0 — Phase 2 will add expire-lot-reservations
    // and other periodic jobs. Empty string is the documented "no cron"
    // value per graphile-worker docs.
    crontab: '',
    taskList,
  })
```

**What changes for Phase 2 (D-17 + AM-03):**

```typescript
crontab: [
  '* * * * * outbox.drain',          // every minute — AM-03 (5s not achievable via crontab)
  '* * * * * reservation.expire',    // every minute — FORN-06
].join('\n'),
```

**Note: per AM-03, SSE latency does NOT depend on outbox.drain.** The `lot.status_changed` event is emitted by directly calling `pg_notify` in the same transaction as the reservation/sale write (see Group E `emitOutboxEvent` + a sibling helper for inline pg_notify). The drain is for email, PDF, lot=sold marking — latency tolerant.

---

### `src/jobs/tasks/index.ts` (extend — config, registry)

**Existing registry** at `src/jobs/tasks/index.ts:1-20`. Phase 2 adds 6 task ids.

**Existing pattern**:

```typescript
export const taskList: TaskList = {
  echo,
  [PDF_GENERATE_CONTRACT_TASK]: pdfGenerateContract,
  [ZAPSIGN_SEND_CONTRACT_TASK]: zapsignSendContract,
  [EMAIL_SEND_STATUS_UPDATE_TASK]: emailSendStatusUpdate,
}
```

**What changes for Phase 2:**

```typescript
import { OUTBOX_DRAIN_TASK, outboxDrain } from './outbox-drain'
import { RESERVATION_EXPIRE_TASK, reservationExpire } from './reservation-expire'
import { PAYMENT_PROCESS_WEBHOOK_TASK, paymentProcessWebhook } from './payment-process-webhook'
import { WAITLIST_NOTIFY_NEXT_TASK, waitlistNotifyNext } from './waitlist-notify-next'
import { REFUND_PROCESS_TASK, refundProcess } from './refund-process'
import { LOT_NOTIFY_CHANNEL_TASK, lotNotifyChannel } from './lot-notify-channel'

export const taskList: TaskList = {
  echo,
  [PDF_GENERATE_CONTRACT_TASK]: pdfGenerateContract,
  [ZAPSIGN_SEND_CONTRACT_TASK]: zapsignSendContract,
  [EMAIL_SEND_STATUS_UPDATE_TASK]: emailSendStatusUpdate,
  [OUTBOX_DRAIN_TASK]: outboxDrain,
  [RESERVATION_EXPIRE_TASK]: reservationExpire,
  [PAYMENT_PROCESS_WEBHOOK_TASK]: paymentProcessWebhook,
  [WAITLIST_NOTIFY_NEXT_TASK]: waitlistNotifyNext,
  [REFUND_PROCESS_TASK]: refundProcess,
  [LOT_NOTIFY_CHANNEL_TASK]: lotNotifyChannel,
}
```

---

### `src/db/schema/event_addons.ts` (NEW — model, CRUD)

**Closest analog:** `src/db/schema/lots.ts::lotCategories` (lines 31-63) — same shape: tenant-scoped catalog with event_id FK + price columns.

**Excerpt to copy verbatim**:

```typescript
import { sql } from 'drizzle-orm'
import { index, jsonb, numeric, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { events } from './events'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

export const lotCategories = pgTable(
  'lot_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    eventId: uuid('event_id').notNull().references(() => events.id),
    name: text('name').notNull(),
    baseFixed: numeric('base_fixed', { precision: 12, scale: 2 }).notNull().default('0'),
    perSqmRate: numeric('per_sqm_rate', { precision: 10, scale: 4 }).notNull().default('0'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('lot_categories_tenant_id_idx').on(table.tenantId),
    index('lot_categories_event_id_idx').on(table.eventId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
```

**What changes for Phase 2 (D-01):** Rename to `eventAddons` table `event_addons`; replace `baseFixed`/`perSqmRate`/`color` with `priceBrlCents: integer('price_brl_cents').notNull()`, `maxQty: integer('max_qty').notNull().default(1)`, `active: boolean('active').notNull().default(true)`. Index event_id; index active for fast listing.

---

### `src/db/schema/lot_reservations.ts` (NEW — model, CRUD + TTL)

**Closest analog:** `src/db/schema/vendors.ts::lotAssignments` (lines 144-174) — "one active per lot" unique pattern is exactly Phase 2's reservation contract.

**Excerpt to copy verbatim**:

```typescript
export const lotAssignments = pgTable(
  'lot_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
    /** UNIQUE — one active assignment per lot at a time. Enforced via migration. */
    lotId: uuid('lot_id').notNull().references(() => lots.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
    assignedBy: uuid('assigned_by').references(() => user.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('lot_assignments_tenant_id_idx').on(table.tenantId),
    index('lot_assignments_vendor_id_idx').on(table.vendorId),
    index('lot_assignments_lot_id_idx').on(table.lotId),
    pgPolicy('tenant_isolation', { ... }),
  ],
).enableRLS()
```

**Partial unique pattern (from `lot_assignments` Migration 0011)** — Phase 2 reuses this exact shape for `lot_reservations`:

```sql
CREATE UNIQUE INDEX "lot_reservations_lot_id_active_unique"
  ON "lot_reservations" ("lot_id")
  WHERE "released_at" IS NULL AND "expires_at" > now();
```

**What changes for Phase 2 (FORN-04/05):**
- Columns: `tenantId`, `lotId`, `vendorId`, `cartId` (uuid — self-reference for join with cart_addon_lines), `reservedAt` (default now), `expiresAt` (NOT NULL, default `now() + interval '15 minutes'`), `releasedAt` (nullable), `paymentMethod` (text, nullable until checkout commits).
- Index `expires_at` for the scheduled-task scan.
- Partial unique on `(lot_id) WHERE released_at IS NULL AND expires_at > now()` (one active per lot).
- Advisory lock pattern lives in `src/lib/actions/reservations.ts` (see Group D below) — schema alone is insufficient.

---

### `src/db/schema/payment_webhooks_inbox.ts` (NEW — model, event-driven)

**Closest analog:** `src/db/schema/contracts.ts::zapsignDocuments` (lines 92-123) — gateway-id PK + jsonb payload pattern.

**Excerpt to copy verbatim**:

```typescript
export const zapsignDocuments = pgTable(
  'zapsign_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contractId: uuid('contract_id').notNull().references(() => contracts.id),
    /** ZapSign-side ID (the integration's primary key). Unique. */
    zapsignId: text('zapsign_id').notNull(),
    payloadSend: jsonb('payload_send'),
    payloadCallback: jsonb('payload_callback'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // RLS + indexes
).enableRLS()
```

**What changes for Phase 2 (D-14):**
- Table `payment_webhooks_inbox` with `gateway_event_id TEXT PRIMARY KEY` (the Pagar.me event id — NOT a uuid). The PK enforces idempotency via `INSERT ... ON CONFLICT DO NOTHING`.
- Columns: `gateway_event_id` (PK), `tenant_id` (NOT NULL — denormalized at INSERT for the worker's withTenant entry per Open Q4), `event_type` (text), `payload` (jsonb — raw body), `received_at` (default now), `processed_at` (nullable), `processing_status` (text: pending/processed/failed).
- FORCE RLS + tenant_isolation policy.
- Migration 0019 grants SELECT-only to `fb_eventos_migrator` (mirror of `0014_zapsign_webhook_tenant_lookup.sql` — see ADR-0005 below).

---

### `src/db/schema/outbox_events.ts` (NEW — model, event-log)

**Closest analog:** `src/db/schema/audit.ts::auditLog` (append-only pattern) — but tenant-scoped with FORCE RLS like `vendor_documents`.

**Pattern (synthesized — single-table discriminated event log per D-16):**

```typescript
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    eventType: text('event_type').notNull(),        // 'payment.paid' | 'lot.reserved' | ...
    aggregateId: uuid('aggregate_id').notNull(),    // lot_id OR payment_id depending on event_type
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),  // nullable until drained
  },
  (table) => [
    index('outbox_events_tenant_id_idx').on(table.tenantId),
    index('outbox_events_unprocessed_idx').on(table.createdAt).where(sql`processed_at IS NULL`),
    index('outbox_events_event_type_idx').on(table.eventType),
    pgPolicy('tenant_isolation', { ... }),
  ],
).enableRLS()
```

**What changes for Phase 2 (D-16):** `event_type` enum (text constrained via CHECK in migration): `payment.created`, `payment.paid`, `payment.failed`, `lot.reserved`, `lot.sold`, `lot.released`, `lot.status_changed`, `refund.created`. Migration 0019-equivalent grants SELECT to `fb_eventos_migrator` for the drain task (mirror of 0014).

---

### `src/db/schema/vendor_consents.ts` (NEW — model, CRUD + audit)

**Closest analog:** `src/db/schema/consent.ts::consentRecords` (Phase 0).

**Pattern (Phase 0 consent shape — copy ENUM-via-text-CHECK pattern):**

```typescript
export const vendorConsents = pgTable(
  'vendor_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    vendorId: uuid('vendor_id').notNull().references(() => vendors.id),
    consentType: text('consent_type').notNull(),  // 'marketing' | 'analytics' | 'payment_data' (CHECK constraint)
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** PII: client IP at consent time (low-sensitivity but inventoried). */
    ipAddress: text('ip_address'),
    /** Snapshot of consent text the vendor agreed to (LGPD requirement). */
    consentText: text('consent_text'),
    consentVersion: text('consent_version').notNull(),
  },
  // tenant_isolation RLS + indexes
).enableRLS()
```

**What changes for Phase 2 (D-24):** CHECK constraint on `consent_type IN ('marketing','analytics','payment_data')`. Action recordConsent/revokeConsent in `src/lib/actions/vendor-consents.ts` — uses the `extractClientIp` pattern from `src/lib/actions/consent.ts:45-56` (verbatim copy).

---

### `src/lib/actions/reservations.ts` (NEW — service action, CRUD + advisory lock)

**Closest analog:** `src/lib/actions/lot-assignments.ts::assignLotToVendorInTenant` (lines 78-171) — guard-then-INSERT shape with walk-cause-chain unique violation.

**Excerpt to copy verbatim** (lines 78-147 — the guard-INSERT-audit envelope):

```typescript
export async function assignLotToVendorInTenant(
  db: TenantDb,
  tenantId: string,
  input: LotAssignmentCreateInput,
  userId: string,
): Promise<PersistedAssignment> {
  // 1. Verify vendor exists, is in our tenant (RLS), AND has status='approved'.
  const vendorRows = await db
    .select({ id: vendors.id, status: vendors.status, legalName: vendors.legalName })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), isNull(vendors.deletedAt)))
    .limit(1)
  const vendor = vendorRows[0]
  if (!vendor) throw new Error('Fornecedor não encontrado ou inacessível')

  // 2. Verify lot exists in our tenant (RLS gate).
  const lotRows = await db
    .select({ id: lots.id, code: lots.code })
    .from(lots)
    .where(and(eq(lots.id, input.lotId), isNull(lots.deletedAt)))
    .limit(1)
  const lot = lotRows[0]
  if (!lot) throw new Error('Lote não encontrado ou inacessível')

  // 3. INSERT — partial UNIQUE catches the double-assign race.
  let inserted: typeof lotAssignments.$inferSelect | undefined
  try {
    const rows = await db.insert(lotAssignments).values({
      tenantId, vendorId: input.vendorId, lotId: input.lotId, assignedBy: userId,
    }).returning()
    inserted = rows[0]
  } catch (err) {
    let cur: unknown = err
    for (let i = 0; i < 4 && cur != null; i++) {
      const msg = cur instanceof Error ? cur.message : String(cur)
      const code = (cur as { code?: unknown }).code
      if (/lot_assignments_lot_id_active_unique/.test(msg) || code === '23505') {
        throw new Error('Lote já está atribuído a outro fornecedor')
      }
      cur = (cur as { cause?: unknown }).cause
    }
    throw err
  }
  await recordAudit(db, { action: 'lot_assignment.created', ... })
  return inserted
}
```

**What changes for Phase 2 (FORN-04/05):**

Insert advisory-lock BEFORE the SELECT-then-INSERT (research §Pattern 1):

```typescript
// Use raw sql tag from rawSqlFromTenantDb to call pg_try_advisory_xact_lock.
const lockKey = sql`hashtext(${`lot:${input.eventId}:${input.lotId}`})::bigint`
const locked = await db.execute(
  sql`SELECT pg_try_advisory_xact_lock(${lockKey}) AS got`
)
if (!locked.rows[0]?.got) {
  throw new Error('Lote já reservado por outro fornecedor — atualize a página.')
}
// THEN do the SELECT-status='available' guard + INSERT lot_reservations.
// THEN emit outbox: emitOutboxEvent(db, 'lot.reserved', input.lotId, {...})
// THEN inline pg_notify for SSE: rawSqlFromTenantDb(db)`SELECT pg_notify(${channel}, ${JSON.stringify({lot_id, new_status})})`
```

- Replace `lotAssignments` writes with `lotReservations`; same partial-unique pattern (`WHERE released_at IS NULL AND expires_at > now()`).
- Add `releaseReservation(reservationId)` mutation called by `payment.failed` saga handler.

---

### `src/lib/actions/checkout.ts` (NEW — service action, request-response)

**Closest analog:** `src/lib/actions/payments.ts::createChargeInTenant` (lines 144-343) — exact shape (build payload → INSERT row → POST gateway → UPDATE response → audit → emit outbox).

The full pure-helper body from `payments.ts:144-343` is the template; the planner replicates it changing:
- Input: `cartId` (resolves to `lot_reservations` row + `cart_addon_lines`) instead of `contractId`.
- Items array: 1 entry per (lot, addonChoice).
- Payment method: `pix | credit_card` (boleto removed per AM-01); credit_card carries `installments: 1..12`.
- After Pagar.me POST: emit outbox event `payment.created` (or `payment.paid` if PIX returns paid synchronously).

---

### `src/lib/actions/refunds.ts` (NEW — service action, CRUD + external)

**Closest analog:** `src/lib/actions/payments.ts::createChargeInTenant` (lines 263-283 — audit-out-of-band on API failure pattern; see above excerpt).

**Refund-policy helper closest analog:** `src/lib/lots/price.ts` (pure function for monetary compute) — Phase 2 mirror in `src/lib/refund/policy.ts`. Research §Code Example 4 is the canonical body.

**What changes for Phase 2 (D-06/D-07/D-08 + AM-04):**
- Call `cancelCharge(chargeId, opts?)` from `src/lib/pagarme/client.ts` — the new DELETE-shaped helper.
- Compute refund percentage via `computeRefundPct(eventStartsAt, tenants.refund_policy_json)`.
- Emit `refund.created` outbox event inside the same withTenant transaction.

---

### `src/lib/actions/waitlist.ts` (NEW — service action, event-driven)

**Closest analog:** `src/lib/actions/lot-assignments.ts` (same guard-INSERT-audit envelope).

**JWT consumption pattern:** Research §Code Example 5 (jose SignJWT/jwtVerify) is the canonical body for `consumeWaitlistToken`. Single-use enforcement requires a new `waitlist_token_uses` table (PK on jti) OR a `tokenJti` column on `lot_reservations` with UNIQUE constraint — planner picks the lighter option.

---

### `src/lib/actions/signup-fornecedor.ts` (NEW — service action, CRUD)

**Closest analog:** `src/lib/actions/fornecedores.ts::createVendorInTenant` (Phase 1 — uses `lookupCNPJCore` + audit + email enqueue).

**Excerpt of the relevant header pattern** (`src/lib/actions/fornecedores.ts:1-72`):

```typescript
'use server'
// ... imports
export const EMAIL_STATUS_UPDATE_TASK = 'email.send-status-update'
// pure-helper signature:
export async function createVendorInTenant(
  db: TenantDb, tenantId: string, input: VendorCreateInput, userId: string
): Promise<PersistedVendor> {
  // 1. Zod parse → lookupCNPJCore (Layer 2) → INSERT vendors (pending)
  // 2. recordAudit → enqueueJob(rawSqlFromTenantDb(db), EMAIL_TASK, {event: 'signup_fornecedor', ...})
}
```

**What changes for Phase 2 (D-21/D-22/D-23):**
- **Auth integration is server-only via `auth.api.addMember`** — pattern from Better Auth org plugin (RESEARCH §A7). The Server Action receives slug → resolveTenantBySlug → `auth.api.addMember({ organizationId, userId, role: 'member' })` BEFORE the vendor INSERT.
- `cnpj_verified=false` fallback per Phase 1 D-16 if BrasilAPI degraded.
- `vendor.status='pending'` (D-23) — same as Phase 1; organizadora approves separately.
- LGPD consent rows (D-24) recorded in same transaction via `recordConsent` from `src/lib/actions/vendor-consents.ts`.

---

### `src/lib/actions/vendor-consents.ts` (NEW — service action, CRUD + audit)

**Closest analog:** `src/lib/actions/consent.ts::recordConsentMetadata` (Phase 0 — IP capture pattern is exact match).

**Excerpt to copy verbatim** (lines 45-56):

```typescript
function extractClientIp(headerMap: Headers): string {
  const xff = headerMap.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xri = headerMap.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}
```

**What changes for Phase 2 (D-24):** Per-consent-type (marketing|analytics|payment_data) row in `vendor_consents`; revoke = soft-update (`revoked_at` timestamp); recordAudit on every change.

---

### `src/lib/pagarme/hmac.ts` (NEW — utility, transform)

**Closest analog (structural):** `src/app/api/webhooks/zapsign/route.ts::verifyBasicAuth` (lines 51-72) — similar timing-safe-ish pattern, but Phase 2 swaps to true HMAC.

**Canonical body from RESEARCH §Pattern 4** (copy verbatim):

```typescript
// src/lib/pagarme/hmac.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false
  const computed = createHmac('sha256', secret).update(rawBody).digest()
  let received: Buffer
  try { received = Buffer.from(signatureHeader, 'base64') } catch { return false }
  if (received.length !== computed.length) return false
  return timingSafeEqual(computed, received)
}
```

**What changes for Phase 2 (D-13 + AM-02):**
- Header name + encoding (base64 vs hex) are probe-verified at execute-time (AM-02). The probe-test task hits Pagar.me sandbox, captures the actual header name, and the planner pins it into the handler.
- Algorithm: HMAC-SHA256 (per ME parent docs; sandbox-verify confirms).
- Read `rawBody` via `await req.arrayBuffer()` then `Buffer.from(...)` — never `req.json()` (Pitfall 1).

---

### `src/lib/outbox/emit.ts` (NEW — utility, event emission)

**Closest analog:** `src/jobs/enqueue.ts::enqueueJob` (uses an in-transaction `tx` postgres.js tag — same pattern Phase 2 uses for `INSERT outbox_events`).

**Canonical body from RESEARCH §Pattern 2** (copy verbatim):

```typescript
// src/lib/outbox/emit.ts
import { sql } from 'drizzle-orm'
import type { TenantDb } from '@/db/with-tenant'

export type OutboxEventType =
  | 'payment.created' | 'payment.paid' | 'payment.failed'
  | 'lot.reserved' | 'lot.sold' | 'lot.released' | 'lot.status_changed'
  | 'refund.created'

export async function emitOutboxEvent(
  db: TenantDb,
  eventType: OutboxEventType,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO outbox_events (tenant_id, event_type, aggregate_id, payload)
    VALUES (current_setting('app.current_tenant_id', true)::uuid, ${eventType}, ${aggregateId}, ${JSON.stringify(payload)}::jsonb)
  `)
}
```

**What changes for Phase 2 (D-19):** Per AM-03, also expose a `emitOutboxEventAndNotify` variant that issues `pg_notify('event:${eventId}:lots', JSON.stringify({lot_id, new_status, event_id}))` (≤8000 bytes — Pitfall 3) **in the same tx** for `lot.status_changed` events that need SSE-tier latency. The drain handles other event types.

---

### `src/lib/refund/policy.ts` (NEW — utility, pure compute)

**Closest analog:** `src/lib/lots/price.ts` (pure pricing — no DB, no side effects, just math).

**Canonical body from RESEARCH §Code Example 4** (copy verbatim):

```typescript
// src/lib/refund/policy.ts
interface RefundTier { min_days_before_event: number; refund_pct: number }

const DEFAULT_POLICY: RefundTier[] = [
  { min_days_before_event: 30, refund_pct: 100 },
  { min_days_before_event: 15, refund_pct: 50 },
  { min_days_before_event: 7,  refund_pct: 25 },
  { min_days_before_event: 0,  refund_pct: 0 },
]

export function computeRefundPct(
  eventStartsAt: Date,
  policy: RefundTier[] = DEFAULT_POLICY,
  now: Date = new Date(),
): number {
  const daysBefore = (eventStartsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  const sorted = [...policy].sort((a, b) => b.min_days_before_event - a.min_days_before_event)
  for (const tier of sorted) {
    if (daysBefore >= tier.min_days_before_event) return tier.refund_pct
  }
  return 0
}
```

---

### `src/lib/waitlist/jwt.ts` (NEW — utility, sign/verify)

**No analog in repo** — `jose` is a new dependency (RESEARCH §Standard Stack — packages noted with `[ASSUMED]` per slopcheck-unavailable note). Use RESEARCH §Code Example 5 verbatim:

```typescript
// src/lib/waitlist/jwt.ts
import { SignJWT, jwtVerify } from 'jose'

const ALG = 'HS256'
function getKey() { return new TextEncoder().encode(process.env.WAITLIST_JWT_SECRET ?? '') }

export async function signWaitlistToken(opts: {
  tenant_id: string; vendor_id: string; lot_id: string; ttl_seconds?: number
}): Promise<string> {
  const jti = crypto.randomUUID()
  return await new SignJWT({ ...opts, jti })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${opts.ttl_seconds ?? 900}s`)
    .setJti(jti)
    .sign(getKey())
}

export async function verifyWaitlistToken(token: string): Promise<{
  tenant_id: string; vendor_id: string; lot_id: string; jti: string;
}> {
  const { payload } = await jwtVerify(token, getKey(), { algorithms: [ALG] })
  return payload as never
}
```

**Pre-install gate:** `checkpoint:human-verify` before `pnpm add jose` (Phase 2 RESEARCH `[ASSUMED]` policy).

---

### `src/jobs/tasks/outbox-drain.ts` (NEW — scheduled task, batch)

**Closest analog:** `src/jobs/tasks/zapsign-send-contract.ts` (header + Task signature) + cross-tenant `migratorPool` use from `src/app/api/webhooks/pagarme/route.ts:82-89`.

**Excerpt from RESEARCH §Common Operation 3** (copy verbatim with adjustments for `migratorPool`):

```typescript
// src/jobs/tasks/outbox-drain.ts
import type { Task } from 'graphile-worker'
import { migratorPool } from '@/db/migrator-pool'
import { enqueueJob } from '@/jobs/enqueue'

export const OUTBOX_DRAIN_TASK = 'outbox.drain'

interface OutboxRow {
  id: string; tenant_id: string; event_type: string; aggregate_id: string; payload: unknown
}

export const outboxDrain: Task = async (_payload, _helpers) => {
  await migratorPool.begin(async (tx) => {
    const rows = await tx<OutboxRow[]>`
      SELECT id, tenant_id, event_type, aggregate_id, payload
        FROM outbox_events
       WHERE processed_at IS NULL
       ORDER BY created_at
       LIMIT 100
       FOR UPDATE SKIP LOCKED
    `
    for (const row of rows) {
      const taskName = handlerForEventType(row.event_type)
      await enqueueJob(tx, taskName, {
        tenant_id: row.tenant_id,
        outbox_id: row.id,
        aggregate_id: row.aggregate_id,
        payload: row.payload,
      })
      await tx`UPDATE outbox_events SET processed_at = now() WHERE id = ${row.id}`
    }
  })
}
```

**Pitfall 11 mitigation (FOR UPDATE SKIP LOCKED + max-attempt failure):** After N failed attempts (graphile-worker default 25), the handler-task's per-job failure marks the row `processing_status='failed'` — the drain task SHOULD filter `WHERE processing_status != 'failed'` to avoid permanent loops. Planner adds `processing_status` column to `outbox_events` schema.

**Pitfall: rawSqlFromTenantDb is for INSIDE withTenant only.** `outbox-drain` runs OUTSIDE withTenant (cross-tenant) — use `migratorPool` directly. This mirrors the webhook handler's `migratorPool.begin(async (tx) => { enqueueJob(tx, ...) })` shape.

---

### `src/jobs/tasks/payment-process-webhook.ts` (NEW — on-demand task, event-driven)

**Closest analog:** `src/jobs/tasks/zapsign-send-contract.ts:67-207` — Task<Payload> shape with Zod validation + `withTenant(payload.tenant_id, ...)` wrap.

**Excerpt to copy verbatim** (lines 67-72 — the canonical task header):

```typescript
export const zapsignSendContract: Task = async (rawPayload, helpers) => {
  const payload = zapsignSendContractPayloadSchema.parse(rawPayload ?? {})
  const log = childLogger({ tenantId: payload.tenant_id })

  await withTenant(payload.tenant_id, async (db) => {
    // 1. Load entity (RLS-scoped) ...
    // 2. External API call ...
    // 3. Update DB ...
    // 4. Audit ...
    // 5. Enqueue downstream tasks via rawSqlFromTenantDb(db) ...
  })
}
```

**What changes for Phase 2 (FORN-10/12):** This task picks up the WHOLE current webhook FSM logic from `src/app/api/webhooks/pagarme/route.ts:175-272` (re-fetch + decideNewStatus + terminal-state idempotency + email enqueue). It's effectively moved — not rewritten. After FSM update, **emit outbox `payment.paid` or `payment.failed`** instead of inline email enqueue:

```typescript
await emitOutboxEvent(db, newStatus === 'paid' ? 'payment.paid' : 'payment.failed',
  resolved.paymentId, { contract_id, vendor_id, lot_id, ... })
```

The email sending is then handled by the outbox handler `src/jobs/outbox/handlers/payment-paid.ts`.

---

### `src/jobs/tasks/reservation-expire.ts` (NEW — scheduled task, batch)

**Closest analog:** `src/jobs/tasks/outbox-drain.ts` (same skeleton — cross-tenant scan via `migratorPool`).

**Pattern (synthesized; FORN-06):**

```typescript
export const RESERVATION_EXPIRE_TASK = 'reservation.expire'

export const reservationExpire: Task = async (_p, _h) => {
  // Cross-tenant scan: pick rows that expired and have not been released.
  // Per-tenant: enter withTenant and UPDATE released_at + emit lot.released.
  const rows = await migratorPool<Array<{ id: string; tenant_id: string; lot_id: string }>>`
    SELECT id, tenant_id, lot_id FROM lot_reservations
     WHERE expires_at < now() AND released_at IS NULL
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  `
  for (const row of rows) {
    await withTenant(row.tenant_id, async (db) => {
      await db.execute(sql`UPDATE lot_reservations SET released_at = now() WHERE id = ${row.id}`)
      await emitOutboxEvent(db, 'lot.released', row.lot_id, { reservation_id: row.id })
    })
  }
}
```

---

### `src/jobs/tasks/waitlist-notify-next.ts` (NEW — on-demand task, event-driven)

**Closest analog:** `src/jobs/tasks/email-send-status-update.ts:100-164` — exact match (`withTenant` + resolve + `sendEmail` + `recordAudit`).

The fan-out body is `email-send-status-update.ts` template applied N times (top-3 of `lot_waitlist`); for each recipient, mint a JWT via `signWaitlistToken(...)` and inject the link into the email template (new template `waitlist_available`).

---

### `src/jobs/tasks/refund-process.ts` (NEW — on-demand task, external)

**Closest analog:** `src/jobs/tasks/zapsign-send-contract.ts:67-207` (external API call inside withTenant + audit + downstream enqueue).

The handler calls `cancelCharge(chargeId, { amount: computedRefundCents })` (from `src/lib/pagarme/client.ts`), updates `refund_requests.status='completed'`, emits `lot.released` outbox event (so waitlist gets notified).

---

### `src/jobs/tasks/lot-notify-channel.ts` (NEW — outbox handler, pub-sub)

**Closest analog:** `src/jobs/enqueue.ts` (raw postgres.js `tx` use for `pg_notify` call).

**Pattern (synthesized; D-19 + AM-03):**

```typescript
export const LOT_NOTIFY_CHANNEL_TASK = 'lot.notify-channel'

export const lotNotifyChannel: Task = async (rawPayload, _h) => {
  const { tenant_id, event_id, lot_id, new_status } = lotNotifyChannelSchema.parse(rawPayload)
  // No withTenant needed — pg_notify is global and we send only IDs (Pitfall 3).
  // Use migratorPool so the worker doesn't need a tenant context.
  const channel = `event:${event_id}:lots`
  const payload = JSON.stringify({ lot_id, new_status, event_id })
  await migratorPool`SELECT pg_notify(${channel}, ${payload})`
}
```

> Per AM-03, for the *latency-sensitive* `lot.status_changed` events the planner SHOULD bypass this handler entirely and emit `pg_notify` **directly from the same transaction** that wrote the reservation/sale row (via `rawSqlFromTenantDb(db)\`SELECT pg_notify(...)\``). This task handles the case where outbox-drain picks up the event and needs to fan out.

---

### `src/jobs/outbox/handlers/{payment-paid,payment-failed,lot-reserved,lot-sold,lot-released,refund-created}.ts` (NEW — outbox handlers)

**Closest analog:** `src/jobs/tasks/email-send-status-update.ts` — switch-on-event template.

Each handler is a `Task` registered in `taskList` (or a `handlerForEventType()` mapping inside `outbox-drain.ts`). Body wraps in `withTenant(payload.tenant_id, ...)`, checks current state before mutating (idempotency — D-17 contract: "handlers check state before mutating"), emits downstream outbox events.

**Example: `payment-paid` handler responsibilities:**
- Mark `lots.status='sold'` for `payload.lot_id` (no-op if already sold).
- Enqueue `email.send-status-update` with `event='pagamento_recebido'` (reuse Phase 1 template).
- Enqueue `pdf.generate-contract` if Phase 2 still wants a per-purchase receipt PDF.

**Example: `payment-failed` handler (SAGA — D-18):**
- UPDATE `lot_reservations.released_at = now()` for the matching reservation.
- Emit `lot.released` outbox event → cascades to `waitlist.notify-next`.

---

### `src/app/[slug]/fornecedor/cadastro/page.tsx` (NEW — page, form)

**Closest analog:** `src/app/(auth)/signup/page.tsx` + `src/components/auth/signup-form.tsx`.

**Excerpt from signup-form (consent UX template — copy structure)** (`src/components/auth/signup-form.tsx:117-219`):

```typescript
return (
  <Form {...form}>
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <FormField control={form.control} name="email" render={({ field }) => (
        <FormItem><FormLabel>Email</FormLabel>
          <FormControl><Input type="email" autoComplete="email" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )} />
      {/* ... password, name, orgName, orgSlug fields ... */}
      <FormField control={form.control} name="consent" render={({ field }) => (
        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
          <FormControl>
            <Checkbox checked={field.value as unknown as boolean}
              onCheckedChange={(c) => field.onChange(c === true)} />
          </FormControl>
          <div className="space-y-1 leading-none">
            <FormLabel>Consentimento LGPD (obrigatório)</FormLabel>
            <FormDescription>{LGPD_CONSENT_TEXT_V1}</FormDescription>
            <FormMessage />
          </div>
        </FormItem>
      )} />
      <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
        {form.formState.isSubmitting ? 'Criando conta…' : 'Criar conta'}
      </Button>
    </form>
  </Form>
)
```

**onSubmit handler pattern (lines 80-115) — copy structure, swap action**:

```typescript
async function onSubmit(values: SignupFormValues) {
  setSubmitError(null)
  const consentAt = new Date()
  const { error } = await signUp.email({
    email: values.email, password: values.password, name: values.name,
    consentVersion: LGPD_CONSENT_VERSION, consentAt,
  } as Parameters<typeof signUp.email>[0])
  if (error) {
    setSubmitError('Não foi possível concluir o cadastro. Verifique os dados e tente novamente.')
    return
  }
  await recordConsentMetadata({ consentVersion: LGPD_CONSENT_VERSION, consentText: LGPD_CONSENT_TEXT_V1 })
  router.replace('/verify-email')
}
```

**What changes for Phase 2 (D-21/D-22/D-23/D-24):**
- Form fields: email, password, name, **legal_name**, **trade_name**, **cnpj** (with `<CNPJInput />` from `src/components/fornecedores/cnpj-input.tsx`), **phone**, **3 consent checkboxes** (marketing/analytics/payment_data — D-24).
- Submit calls NEW `signupFornecedor(slug, ...)` Server Action (from `src/lib/actions/signup-fornecedor.ts`) — NOT `signUp.email` directly (because the slug-resolved tenant has to be associated server-side via `auth.api.addMember`).
- After success: redirect to `/[slug]/portal` first-page that prompts the new vendor to upload `vendor_documents` (reuse Phase 1 pre-signed PUT via `src/lib/actions/minio-presign.ts`).

---

### `src/app/[slug]/marketplace/page.tsx` (NEW — page, list)

**Closest analog:** `src/app/[slug]/eventos/page.tsx:25-74` — session check + tenant slug + activeOrg gate + withTenant fetch.

**Excerpt to copy verbatim** (lines 25-74):

```typescript
export default async function EventosListPage({ params }: PageProps) {
  const { slug } = await params
  const h = await nextHeaders()

  const session = await auth.api.getSession({ headers: h })
  if (!session) redirect('/login')

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) notFound()

  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
        </div>
      </main>
    )
  }

  const items = await withTenant(tenant.id, async (db) => {
    return listEventsInTenant(db, tenant.id)
  })

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Eventos</h1>
          <p className="text-sm text-slate-600">{tenant.name}</p>
        </div>
      </header>
      <EventList tenantSlug={slug} events={items} />
    </main>
  )
}
```

**What changes for Phase 2 (FORN-02):**
- Filter events to `status='published'` only (the marketplace shows only events the organizadora has explicitly opened for vendor purchase).
- Add per-event card with "% lotes disponíveis", "data limite", and link to `/[slug]/marketplace/[eventId]/planta`.

---

### `src/app/[slug]/marketplace/[eventId]/planta/page.tsx` (NEW — page, canvas buyer-mode)

**Closest analog:** `src/app/[slug]/eventos/[eventId]/planta/page.tsx` (already mounts `PlantaEditor` with mode='editor'). For Phase 2, copy `src/app/[slug]/eventos/[eventId]/dashboard/page.tsx` (`mode='dashboard'` skeleton) and swap to `mode='buyer'` with an `onLotClicked` callback.

---

### `src/app/api/sse/events/[eventId]/lots/route.ts` (NEW — SSE Route Handler, streaming)

**No analog in repo.** Use RESEARCH §Pattern 3 verbatim — it's a canonical Next.js 15 ReadableStream + LISTEN/NOTIFY shape (see RESEARCH lines 397-449 for the full body).

**Tenant-resolution boilerplate at the top** of the handler MUST reuse `src/lib/tenant.ts::resolveTenantBySlug` and `src/auth/server.ts::auth.api.getSession` — same as page Server Components — and verify `session.session.activeOrganizationId === tenantId` before opening the stream (security: Pitfall §SSE auth bypass). Use `migratorPool` (or a dedicated postgres.js sub-pool) for the LISTEN connection — DO NOT use the app pool because LISTEN holds the connection indefinitely.

---

### `src/components/checkout/checkout-sidebar.tsx` (NEW — component, form)

**Closest analog:** `src/components/contracts/create-charge-button.tsx` (139 lines, Phase 1 — dialog + method picker + amount confirm). Already ships PIX/cartão tile selector.

**Phase 2 changes:**
- Cart shows lot + add-on lines with checkboxes (D-01).
- Two method tiles (PIX, cartão — boleto dropped per AM-01).
- On cartão pick: render `<InstallmentsTable />` (1..12) — table shows juros calculation.
- Submit calls new `checkoutCart` Server Action; on PIX response, render `<PixQR />` (reuse Phase 1).

---

### `docs/adr/0005-webhook-hmac-strategy.md` (NEW — doc)

**Closest analog:** `docs/adr/0002-e-sign-provider.md` — same shape (Context → Decision → Comparison table → Consequences → Escape-hatch → References).

**Phase 2 ADR-0005 content (per D-13 + AM-02):**
- Context: Phase 1 used Basic Auth + re-fetch defense; Phase 2 promotes to HMAC because Pagar.me v5 production webhook supports it (per ME parent platform doc — header name pinned at probe-test time).
- Decision: HMAC-SHA256 over raw bytes with `crypto.timingSafeEqual`, secret env `PAGARME_WEBHOOK_SIGNING_SECRET`, retains belt-and-suspenders re-fetch from Phase 1.
- Alternatives: keep Basic Auth (rejected — Phase 1 acknowledged as belt-and-suspenders only); IP allowlist (rejected — Coolify Traefik does not natively support per-route IP allowlists without adding middleware).
- Escape-hatch: if HMAC header drifts (Pagar.me API change), keep `PAGARME_WEBHOOK_USER`/`PAGARME_WEBHOOK_PASS` env vars + Basic Auth code path behind a feature flag for emergency rollback.

---

### `docs/adr/0006-outbox-pattern.md` (NEW — doc)

**Closest analog:** `docs/adr/0001-queue-backend.md` — same shape (Context → Decision → Comparison table → Consequences).

**Phase 2 ADR-0006 content (per D-16/D-17/D-18 + AM-03):**
- Context: Phase 1 created payment + side-effects in the same Server Action body — fragile across the network-failure / partial-write boundary.
- Decision: Single `outbox_events` table with `event_type` discriminator; polling drain via Graphile-Worker scheduled task `outbox.drain @ */1m` (AM-03 — 5s not achievable via crontab); SSE-tier events bypass drain via in-transaction `pg_notify`.
- Alternatives: NOTIFY-driven drain (rejected for Phase 2 simplicity); per-event-type table (rejected — single table easier to drain in order); Debezium/CDC (massively overkill).

---

### `docs/adr/0007-refund-policy.md` (NEW — doc)

**Closest analog:** `docs/adr/0003-pricing-model.md` — same shape (Context → Decision → Configurable policy → Consequences). Pricing ADR is the closest mirror because both are tenant-overridable JSONB-stored policies.

**Phase 2 ADR-0007 content (per D-06/D-07/D-08 + AM-04):**
- Context: refund mechanics differ per payment method + temporal policy.
- Decision: 4-tier default policy stored as `tenants.refund_policy_json` (overridable per tenant); refund endpoint is `DELETE /core/v5/charges/{id}` with optional `{amount}` body (AM-04 — NOT `POST /charges/.../refunds`); refund issues atomic `lot.released` outbox event for waitlist cascade.
- Boleto-paid rows removed per AM-01.

---

## Shared Patterns

### Pattern S1 — withTenant boundary (RLS)

**Source:** `src/db/with-tenant.ts:81-97`
**Apply to:** EVERY Server Action and worker task that reads/writes tenant-scoped data.

```typescript
export async function withTenant<T>(
  tenantId: string,
  fn: (db: TenantDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Transaction-local: the `true` flag is load-bearing.
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`)
    return fn(tx as TenantDb)
  })
}
```

**Phase 2 reuses unchanged.** Advisory locks via `pg_try_advisory_xact_lock` work INSIDE this transaction — the SET LOCAL semantics + lock auto-release on commit/rollback are exactly what FORN-04/05 needs.

---

### Pattern S2 — withTenantAction safe-action chain

**Source:** `src/lib/actions/safe-action.ts:60-83`
**Apply to:** ALL Phase 2 Server Actions (reservations, cart, checkout, refunds, waitlist, vendor-consents, signup-fornecedor).

```typescript
export const withTenantAction = authedAction.use(async ({ ctx, next }) => {
  if (!ctx.orgId) throw new Error('No active organization')
  const tenantId = await fetchTenantIdForOrg(ctx.orgId)
  if (!tenantId) throw new Error('Active organization has no tenant mapping')
  return withTenant(tenantId, async (db) => {
    return next({ ctx: { ...ctx, tenantId, db } })
  })
})
```

**Caveat for signup-fornecedor:** the slug-based signup runs BEFORE `activeOrganizationId` is set (vendor doesn't have an org membership yet). Use `actionClient` (not `withTenantAction`) + manual `resolveTenantBySlug` + `auth.api.addMember` server-side. Mirror of `src/lib/actions/consent.ts::recordConsentMetadata` Phase 0 pattern.

---

### Pattern S3 — Pure-helper + thin-action split

**Source:** `src/lib/actions/payments.ts:442-449` (and every Phase 1 action — verified pattern across `fornecedores.ts`, `lot-assignments.ts`, `lot-categories.ts`, `lots.ts`, `vendor-docs.ts`, `consent.ts`).
**Apply to:** ALL Phase 2 Server Actions.

```typescript
export const createCharge = withTenantAction
  .inputSchema(createChargeSchema)
  .action(async ({ ctx, parsedInput }) => {
    const result = await createChargeInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath('/[slug]/cobrancas', 'page')
    return result
  })
```

Tests drive `*InTenant` helpers directly inside `withTenant(...)` — bypassing Better Auth session round-trip. Phase 2 reuses `tests/test-utils/dual-tenant.ts` (Phase 1 TENA-07) for cross-tenant isolation tests.

---

### Pattern S4 — Walk-cause-chain on PG unique violation (23505)

**Source:** `src/lib/actions/payments.ts:421-436` (also `src/lib/actions/lot-assignments.ts:127-147`).
**Apply to:** reservations.ts (lot already reserved), checkout.ts (idempotency clash), inbox INSERT, outbox INSERT, waitlist JWT jti.

```typescript
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  let depth = 0
  while (cur && depth < 5) {
    if (typeof cur === 'object' && cur !== null) {
      const code = (cur as { code?: unknown }).code
      if (code === '23505') return true
      cur = (cur as { cause?: unknown }).cause
    } else { break }
    depth += 1
  }
  return false
}
```

---

### Pattern S5 — Audit-out-of-band (independent withTenant on rollback path)

**Source:** `src/lib/actions/payments.ts:404-414`
**Apply to:** refunds.ts (Pagar.me cancel/refund API failure), checkout.ts (Pagar.me createOrder failure), refund-process worker task.

```typescript
async function recordAuditOutOfBand(tenantId: string, opts: RecordAuditOptions): Promise<void> {
  try {
    await withTenant(tenantId, async (db) => {
      await recordAudit(db, opts)
    })
  } catch (auditErr) {
    console.error('recordAuditOutOfBand failed', auditErr)
  }
}
```

---

### Pattern S6 — rawSqlFromTenantDb extraction (for in-tx enqueueJob)

**Source:** `src/jobs/raw-sql-from-tenant-db.ts:20-25`
**Apply to:** EVERY emitOutboxEvent + enqueueJob call from inside withTenant in Phase 2.

```typescript
import type { TransactionSql } from 'postgres'
import type { TenantDb } from '@/db/with-tenant'

export function rawSqlFromTenantDb(db: TenantDb): TransactionSql {
  const internal = db as unknown as { session: { client: TransactionSql } }
  return internal.session.client
}
```

**Usage** (Phase 1 ZapSign task, Phase 2 reuses):

```typescript
await enqueueJob(rawSqlFromTenantDb(db), 'task.name', { tenant_id: tenantId, ... })
```

---

### Pattern S7 — migratorPool BYPASSRLS lookup for cross-tenant scans

**Source:** `src/db/migrator-pool.ts:39-42` + `src/app/api/webhooks/pagarme/route.ts:82-89`
**Apply to:** outbox-drain, reservation-expire, lot-notify-channel, payment.process-webhook (inbox INSERT happens at the route handler — see refactor above).

```typescript
// Webhook handler tenant resolution
const rows = await migratorPool<Array<{ tenant_id: string; id: string }>>`
  SELECT tenant_id, id FROM payments
   WHERE gateway_order_id = ${orderId}
   LIMIT 1
`
```

For Phase 2 inbox + outbox + reservations, the migrator role needs SELECT (and for outbox, also UPDATE `processed_at`) — emit a Migration 0019/0020-equivalent SQL granting:

```sql
CREATE POLICY "webhook_tenant_lookup_migrator_read"
  ON "payment_webhooks_inbox" AS PERMISSIVE FOR SELECT
  TO fb_eventos_migrator USING (true);
GRANT SELECT ON "payment_webhooks_inbox" TO fb_eventos_migrator;
-- Similar policies for outbox_events (SELECT + UPDATE processed_at) and lot_reservations (SELECT + UPDATE released_at).
```

---

### Pattern S8 — PII inventory via COMMENT ON COLUMN

**Source:** `src/db/migrations/0011_phase1_force_rls.sql` (Phase 1 PII comments).
**Apply to:** Every Phase 2 new column carrying personal data — at minimum: `vendor_consents.ip_address`, `lot_waitlist` joined vendor.email (already commented), refund_requests.reason (free text — might carry PII).

Pattern: `COMMENT ON COLUMN <table>.<col> IS 'PII: <classification>';` in the Phase 2 force-RLS migration (0018).

---

### Pattern S9 — Page Server Component boilerplate

**Source:** `src/app/[slug]/eventos/page.tsx:25-56` (and every page under `/[slug]/`).
**Apply to:** All Phase 2 page Server Components (marketplace, planta-buyer, checkout, portal, fornecedor/cadastro).

```typescript
const { slug } = await params
const h = await nextHeaders()
const session = await auth.api.getSession({ headers: h })
if (!session) redirect('/login')
const tenant = await resolveTenantBySlug(slug)
if (!tenant) notFound()
if (session.session.activeOrganizationId !== tenant.id) { /* 403 page */ }
const data = await withTenant(tenant.id, async (db) => { return listSomethingInTenant(db) })
```

**Phase 2 special-cases:** `/[slug]/fornecedor/cadastro` is reachable WITHOUT a session (the goal IS to create one) — different shape: `resolveTenantBySlug` + render form, but no session check.

---

### Pattern S10 — Probe-test for external-system contract (per AM-02)

**Source:** Phase 0 Plan 06 graphile-worker add_job signature probe (`tests/jobs/add-job-signature-probe.test.ts`).
**Apply to:** Pagar.me HMAC header probe BEFORE writing webhook handler.

The probe-test is a Vitest case that:
1. Constructs a known payload + computes HMAC over it with a known secret.
2. Sends a POST to Pagar.me sandbox webhook (configured to point at a /probe endpoint that echoes headers).
3. Captures the actual header name + encoding (hex vs base64).
4. Asserts the expectation; if it diverges from the planner's assumption, FAIL CI — operator updates the handler.

Per AM-02, the planner must include a `checkpoint:probe-verify-hmac-header` task BEFORE the webhook refactor lands. Document the captured value in the handler source as a comment.

---

## No Analog Found

Files with no close match in the codebase (planner uses RESEARCH.md pattern as the canonical source):

| File | Role | Data Flow | Reason | Canonical source |
|------|------|-----------|--------|------------------|
| `src/app/api/sse/events/[eventId]/lots/route.ts` | route handler / SSE | streaming | Repo has no streaming/ReadableStream patterns | RESEARCH §Pattern 3 (lines 397-449) |
| `src/lib/waitlist/jwt.ts` | utility | sign/verify | `jose` is a new dep — first JWT-based code in repo | RESEARCH §Code Example 5 (lines 703-729) |
| `src/lib/refund/policy.ts` | utility | pure compute | Trivial; mirrors `src/lib/lots/price.ts` structurally | RESEARCH §Code Example 4 (lines 678-701) |

For these three, the planner's task action MUST cite the RESEARCH.md line ranges verbatim instead of an in-repo analog.

---

## Metadata

**Analog search scope:** `src/db/schema/*`, `src/lib/actions/*`, `src/lib/pagarme/*`, `src/jobs/tasks/*`, `src/app/[slug]/**`, `src/app/api/webhooks/*`, `src/components/*`, `docs/adr/*`.
**Files scanned:** 79 production source files + 4 ADRs + 17 migrations.
**Phase 1 plan SUMMARYs read:** 01-CONTEXT, 01-06-SUMMARY (Pagar.me ship), plus structural references to 01-04 (vendor pattern) + 01-05 (ZapSign webhook re-fetch defense) + 01-07 (PlantaEditor dashboard mode + DashboardLotPopover) + 01-08 (D-14 gate + SMTP swap).
**Pattern extraction date:** 2026-06-14.
**Confidence:** HIGH — 36/39 files have an exact-shape analog in the existing Phase 0+1 codebase; only 3 (SSE route, jose JWT, refund-policy compute) require canonical RESEARCH.md examples.
