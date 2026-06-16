"use strict";
// FB_EVENTOS — Graphile-Worker task: payment.process-webhook (Phase 2, Plan 02-05).
//
// Processes a Pagar.me webhook event that was previously inserted into
// payment_webhooks_inbox by the Route Handler.
//
// The handler (route.ts) does the minimum work to keep p95 < 100ms:
//   1. HMAC verify
//   2. Inbox INSERT (idempotency)
//   3. Enqueue this worker
//   4. Return 200
//
// THIS WORKER does the heavy lifting:
//   1. Re-fetch the Pagar.me order (belt-and-suspenders D-13).
//      Trusts the API status over the webhook payload to defend against
//      spoofed or stale webhook events.
//   2. Apply FSM transition to payments (pending → paid | failed | canceled).
//   3. Emit outbox events (payment.paid / payment.failed).
//   4. Enqueue side-effect jobs (email notifications).
//   5. Mark the inbox row as 'processed'.
//
// IDEMPOTENCY:
//   The FSM transition is guarded by TERMINAL_PAYMENT_STATUSES: once a
//   payment reaches a terminal state, subsequent re-runs are no-ops.
//   Graphile-Worker retries on task failure (max_attempts=25 default).
//   Both guards together give "at most once" semantics for state changes
//   and "at least once" semantics for job delivery.
//
// REFERENCES:
//   - 02-CONTEXT.md D-13 (re-fetch defense), D-14 (inbox/outbox)
//   - docs/adr/0005-webhook-hmac-strategy.md §Belt-and-suspenders
//   - src/app/api/webhooks/pagarme/route.ts (enqueues this task)
//   - src/jobs/tasks/email-send-status-update.ts (email notification task)
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentProcessWebhook = exports.PAYMENT_PROCESS_WEBHOOK_TASK = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const migrator_pool_1 = require("@/db/migrator-pool");
const payments_1 = require("@/db/schema/payments");
const with_tenant_1 = require("@/db/with-tenant");
const enqueue_1 = require("@/jobs/enqueue");
const raw_sql_from_tenant_db_1 = require("@/jobs/raw-sql-from-tenant-db");
const email_send_status_update_1 = require("@/jobs/tasks/email-send-status-update");
const audit_1 = require("@/lib/audit");
const logger_1 = require("@/lib/logger");
const emit_1 = require("@/lib/outbox/emit");
const client_1 = require("@/lib/pagarme/client");
// ────────────────────────────────────────────────────────────────────────────
// Task identifier — must match the key in src/jobs/tasks/index.ts
// ────────────────────────────────────────────────────────────────────────────
exports.PAYMENT_PROCESS_WEBHOOK_TASK = 'payment.process-webhook';
// ────────────────────────────────────────────────────────────────────────────
// FSM helpers
// ────────────────────────────────────────────────────────────────────────────
const TERMINAL_PAYMENT_STATUSES = new Set(['paid', 'failed', 'canceled', 'refunded']);
/** Map Pagar.me API status → our payments FSM status. */
function decideNewStatus(apiStatus, apiChargeStatus) {
    const s = apiStatus.toLowerCase();
    const cs = (apiChargeStatus ?? '').toLowerCase();
    if (s === 'paid' || cs === 'paid')
        return 'paid';
    if (s === 'failed' || cs === 'failed')
        return 'failed';
    if (s === 'canceled' || cs === 'canceled')
        return 'canceled';
    if (cs === 'refunded')
        return 'refunded';
    return null;
}
// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────
const paymentProcessWebhook = async (payload, _helpers) => {
    const p = payload;
    const log = logger_1.logger.child({
        component: exports.PAYMENT_PROCESS_WEBHOOK_TASK,
        eventId: p.gateway_event_id,
        orderId: p.order_id,
        tenantId: p.tenant_id,
    });
    // ── Step 1: Belt-and-suspenders re-fetch from Pagar.me API (D-13) ───────
    // The webhook payload is a notification; the API is the source of truth.
    // If this fetch fails, graphile-worker retries the job with backoff.
    let apiOrder;
    try {
        apiOrder = await (0, client_1.getOrder)(p.order_id);
    }
    catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'Pagar.me API re-fetch failed — graphile-worker will retry');
        // Re-throw so graphile-worker marks this attempt as failed and retries.
        throw err;
    }
    // ── Step 2: Decide FSM transition ────────────────────────────────────────
    const apiCharge = apiOrder.charges[0];
    const newStatus = decideNewStatus(apiOrder.status, apiCharge?.status);
    // ── Step 3: Apply FSM + emit outbox + side-effects (inside withTenant) ───
    await (0, with_tenant_1.withTenant)(p.tenant_id, async (db) => {
        // Load current payment status (idempotency guard).
        const currentRows = await db
            .select({ status: payments_1.payments.status, id: payments_1.payments.id })
            .from(payments_1.payments)
            .where((0, drizzle_orm_1.eq)(payments_1.payments.id, p.payment_id))
            .limit(1);
        const current = currentRows[0];
        if (!current) {
            log.warn({ paymentId: p.payment_id }, 'payment row not found — skipping');
            return;
        }
        // Audit the webhook arrival regardless of transition.
        await (0, audit_1.recordAudit)(db, {
            action: 'payment.webhook',
            entity: 'payment',
            entityId: p.payment_id,
            userId: '00000000-0000-0000-0000-000000000000',
            payload: {
                gateway_event_id: p.gateway_event_id,
                event_type: p.event_type,
                order_id: p.order_id,
                api_status: apiOrder.status,
                api_charge_status: apiCharge?.status ?? null,
                new_status: newStatus,
            },
        });
        if (newStatus === null) {
            // No FSM transition — transient/informational event.
            log.info({ apiStatus: apiOrder.status }, 'no FSM transition for this event — audited only');
            return;
        }
        if (TERMINAL_PAYMENT_STATUSES.has(current.status)) {
            // Already in terminal state — duplicate delivery or race condition.
            // No-op to avoid double side-effects.
            log.info({ currentStatus: current.status, newStatus }, 'payment already terminal — idempotent no-op');
            return;
        }
        // Apply FSM update.
        const updates = {
            status: newStatus,
            updatedAt: new Date(),
        };
        if (newStatus === 'paid') {
            updates.paidAt = new Date();
        }
        await db.update(payments_1.payments).set(updates).where((0, drizzle_orm_1.eq)(payments_1.payments.id, p.payment_id));
        // Emit outbox events.
        if (newStatus === 'paid') {
            await (0, emit_1.emitOutboxEvent)(db, 'payment.paid', p.payment_id, {
                order_id: p.order_id,
                gateway_event_id: p.gateway_event_id,
                api_status: apiOrder.status,
            });
        }
        else if (newStatus === 'failed') {
            await (0, emit_1.emitOutboxEvent)(db, 'payment.failed', p.payment_id, {
                order_id: p.order_id,
                gateway_event_id: p.gateway_event_id,
                api_status: apiOrder.status,
            });
        }
        // Side-effect: enqueue email on 'paid' transition.
        if (newStatus === 'paid') {
            const rawSql = (0, raw_sql_from_tenant_db_1.rawSqlFromTenantDb)(db);
            await (0, enqueue_1.enqueueJob)(rawSql, email_send_status_update_1.EMAIL_SEND_STATUS_UPDATE_TASK, {
                tenant_id: p.tenant_id,
                payment_id: p.payment_id,
                event: 'pagamento_recebido',
            });
        }
        log.info({ newStatus }, 'FSM transition applied');
    });
    // ── Step 4: Mark inbox row as processed ──────────────────────────────────
    // The inbox row has FORCE RLS but migratorPool can UPDATE cross-tenant.
    try {
        await (0, migrator_pool_1.migratorPool) `
      UPDATE payment_webhooks_inbox
         SET processing_status = 'processed',
             processed_at = now()
       WHERE gateway_event_id = ${p.gateway_event_id}
    `;
    }
    catch (err) {
        // Non-critical — the payment is already processed. Log and continue.
        log.warn({ err: err instanceof Error ? err.message : String(err) }, 'inbox mark-processed failed (non-critical)');
    }
    log.info('payment.process-webhook complete');
};
exports.paymentProcessWebhook = paymentProcessWebhook;
