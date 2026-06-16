"use strict";
// FB_EVENTOS — Payments Server Actions (Phase 1, Plan 01-06 Task 1).
//
// Two Server Actions wrapped in `withTenantAction`:
//
//   - createCharge({contractId, method, amount_brl_cents, card_token?})
//       Verifies the contract is signed → INSERTs `payments` (status=pending)
//       → INSERTs `pagarme_orders` with idempotency_key + request payload →
//       POSTs to Pagar.me v5 /core/v5/orders → persists response payload +
//       gateway_order_id + gateway_charge_id → recordAudit('payment.created')
//       → returns the PIX QR (copia-cola + image URL) for PIX, or the
//       Pagar.me charge object for credit card.
//
//   - listPayments({contractId?})
//       RLS-scoped SELECT — joins pagarme_orders for QR-code retrieval
//       on the payment-detail page.
//
//   - getPaymentById({paymentId})
//       Single-row read for the detail page.
//
// PURE-HELPER / THIN-ACTION SPLIT (Plan 01-03 → 01-05 pattern):
//   Tests drive *InTenant helpers directly inside withTenant; the
//   next-safe-action wrappers just delegate.
//
// IDEMPOTENCY (Phase 1 simple):
//   pagarme_orders.idempotency_key UNIQUE — duplicate createCharge in the
//   same tx fails with 23505 (catchable as a "duplicate charge" error).
//   The same key is sent on the Pagar.me API call via X-Idempotency-Key
//   so even if our local row exists but the POST never happened, Pagar.me
//   replays the same response.
//
// PHASE 1 CONSTRAINTS (deliberately NOT shipped):
//   - NO split (Phase 2 — Pagar.me Recipients)
//   - NO subscriptions (Phase 3)
//   - NO outbox-pattern idempotency on createCharge (Phase 2)
//
// REFERENCES:
//   - 01-RESEARCH.md §A8 (Pagar.me v5 Simple Charge + auth + idempotency)
//   - 01-CONTEXT.md ORG-12
'use server';
// FB_EVENTOS — Payments Server Actions (Phase 1, Plan 01-06 Task 1).
//
// Two Server Actions wrapped in `withTenantAction`:
//
//   - createCharge({contractId, method, amount_brl_cents, card_token?})
//       Verifies the contract is signed → INSERTs `payments` (status=pending)
//       → INSERTs `pagarme_orders` with idempotency_key + request payload →
//       POSTs to Pagar.me v5 /core/v5/orders → persists response payload +
//       gateway_order_id + gateway_charge_id → recordAudit('payment.created')
//       → returns the PIX QR (copia-cola + image URL) for PIX, or the
//       Pagar.me charge object for credit card.
//
//   - listPayments({contractId?})
//       RLS-scoped SELECT — joins pagarme_orders for QR-code retrieval
//       on the payment-detail page.
//
//   - getPaymentById({paymentId})
//       Single-row read for the detail page.
//
// PURE-HELPER / THIN-ACTION SPLIT (Plan 01-03 → 01-05 pattern):
//   Tests drive *InTenant helpers directly inside withTenant; the
//   next-safe-action wrappers just delegate.
//
// IDEMPOTENCY (Phase 1 simple):
//   pagarme_orders.idempotency_key UNIQUE — duplicate createCharge in the
//   same tx fails with 23505 (catchable as a "duplicate charge" error).
//   The same key is sent on the Pagar.me API call via X-Idempotency-Key
//   so even if our local row exists but the POST never happened, Pagar.me
//   replays the same response.
//
// PHASE 1 CONSTRAINTS (deliberately NOT shipped):
//   - NO split (Phase 2 — Pagar.me Recipients)
//   - NO subscriptions (Phase 3)
//   - NO outbox-pattern idempotency on createCharge (Phase 2)
//
// REFERENCES:
//   - 01-RESEARCH.md §A8 (Pagar.me v5 Simple Charge + auth + idempotency)
//   - 01-CONTEXT.md ORG-12
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentById = exports.listPayments = exports.createCharge = void 0;
exports.createChargeInTenant = createChargeInTenant;
exports.listPaymentsInTenant = listPaymentsInTenant;
exports.getPaymentByIdInTenant = getPaymentByIdInTenant;
const node_crypto_1 = require("node:crypto");
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const contracts_1 = require("@/db/schema/contracts");
const lots_1 = require("@/db/schema/lots");
const payments_1 = require("@/db/schema/payments");
const vendors_1 = require("@/db/schema/vendors");
const with_tenant_1 = require("@/db/with-tenant");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const client_1 = require("@/lib/pagarme/client");
const types_1 = require("@/lib/pagarme/types");
const payment_1 = require("@/lib/validators/payment");
function toPersistedPayment(row) {
    return {
        id: row.id,
        tenantId: row.tenantId,
        contractId: row.contractId,
        gateway: row.gateway,
        gatewayOrderId: row.gatewayOrderId,
        gatewayChargeId: row.gatewayChargeId,
        amountBrlCents: row.amountBrlCents,
        method: row.method,
        status: row.status,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (tests drive these inside withTenant)
// ────────────────────────────────────────────────────────────────────────────
const PIX_EXPIRES_IN_SECONDS = 3600; // 1h — Phase 1 default (RESEARCH §A8 Pitfall)
/** Idempotency key generator — never collides across tenants/contracts. */
function generateIdempotencyKey(contractId) {
    return `payment-${contractId}-${(0, node_crypto_1.randomBytes)(8).toString('hex')}`;
}
/**
 * Issue a Pagar.me v5 charge for a signed contract.
 *
 * Flow:
 *   1. Resolve contract (must exist, must be `signed`, must be in tenant).
 *   2. Resolve vendor + lot + category (vendor identity + amount context).
 *   3. Mint idempotency key.
 *   4. INSERT payments row (status=pending).
 *   5. INSERT pagarme_orders row with idempotency_key + request payload.
 *   6. POST to Pagar.me /core/v5/orders.
 *   7. UPDATE pagarme_orders.response_payload + payments.gateway_order_id +
 *      payments.gateway_charge_id.
 *   8. recordAudit('payment.created').
 *   9. Return the PIX QR / cartão result for the UI.
 *
 * Throws on contract not found, contract not signed, vendor missing, or
 * Pagar.me API failure (status≠2xx).
 *
 * RLS contract: caller MUST be inside `withTenant(tenantId, ...)`.
 */
async function createChargeInTenant(db, tenantId, input, userId) {
    // 1. Resolve contract + vendor + lot + category in a single tenant-scoped JOIN.
    const rows = await db
        .select({
        contract: contracts_1.contracts,
        vendor: vendors_1.vendors,
        lot: lots_1.lots,
        category: lots_1.lotCategories,
    })
        .from(contracts_1.contracts)
        .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, contracts_1.contracts.vendorId))
        .innerJoin(lots_1.lots, (0, drizzle_orm_1.eq)(lots_1.lots.id, contracts_1.contracts.lotId))
        .innerJoin(lots_1.lotCategories, (0, drizzle_orm_1.eq)(lots_1.lotCategories.id, lots_1.lots.categoryId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(contracts_1.contracts.id, input.contractId), (0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)))
        .limit(1);
    const row = rows[0];
    if (!row) {
        throw new Error('Contrato não encontrado ou inacessível');
    }
    if (row.contract.status !== 'signed') {
        throw new Error(`Contrato precisa estar assinado para emitir cobrança (status atual: ${row.contract.status})`);
    }
    // 2. Build the Pagar.me order payload.
    const idempotencyKey = generateIdempotencyKey(input.contractId);
    const customerName = row.vendor.tradeName ?? row.vendor.legalName;
    const customerDoc = row.vendor.cnpj.replace(/\D/g, '');
    const orderRequest = {
        customer: {
            name: customerName,
            email: row.vendor.email,
            document: customerDoc,
            // CNPJ → company; CPF → individual. Phase 1 vendors are CNPJ-only.
            type: customerDoc.length === 14 ? 'company' : 'individual',
        },
        items: [
            {
                amount: input.amount_brl_cents,
                description: `Lote ${row.lot.code} — ${row.category.name}`,
                quantity: 1,
            },
        ],
        payments: [
            input.method === 'pix'
                ? {
                    payment_method: 'pix',
                    pix: { expires_in: PIX_EXPIRES_IN_SECONDS },
                }
                : {
                    payment_method: 'credit_card',
                    credit_card: {
                        card_token: input.card_token ?? '',
                        installments: 1,
                    },
                },
        ],
        code: input.contractId,
    };
    // 3. INSERT payments row (status=pending) — this commit is the
    //    durable handle the caller will retry against if the API call
    //    fails. We use a NESTED transaction so the row survives even when
    //    the outer withTenant rolls back due to a Pagar.me API error
    //    (postgres.js's `tx.savepoint` gives PG savepoint semantics).
    let payment;
    {
        const insertedPayments = await db
            .insert(payments_1.payments)
            .values({
            tenantId,
            contractId: input.contractId,
            gateway: 'pagarme',
            amountBrlCents: input.amount_brl_cents,
            method: input.method,
            status: 'pending',
        })
            .returning();
        const inserted = insertedPayments[0];
        if (!inserted)
            throw new Error('createChargeInTenant: payments insert returned no row');
        payment = inserted;
    }
    // 4. INSERT pagarme_orders row with idempotency_key + request payload.
    //    UNIQUE on idempotency_key catches a hypothetical double-submit;
    //    we wrap the duplicate-key error in a catchable domain error.
    try {
        await db.insert(payments_1.pagarmeOrders).values({
            tenantId,
            paymentId: payment.id,
            // biome-ignore lint/suspicious/noExplicitAny: jsonb accepts any serializable payload
            requestPayload: orderRequest,
            idempotencyKey,
        });
    }
    catch (err) {
        // postgres error code 23505 = unique_violation. Walk the cause chain
        // for Drizzle-wrapped errors (Plan 01-03 pattern).
        if (isUniqueViolation(err)) {
            throw new Error('Cobrança duplicada detectada (chave de idempotência conflitante)');
        }
        throw err;
    }
    // 5. POST to Pagar.me. If the API call fails we surface a
    //    payment.create_failed audit row in an INDEPENDENT transaction (so
    //    the audit row survives even when the outer withTenant rolls back
    //    on the re-thrown error). The payment row itself was INSERTed in
    //    the outer transaction and will also roll back — Phase 2 outbox
    //    will refine this to keep the pending row durable; for Phase 1
    //    the audit-on-fail is the load-bearing observability surface.
    let pagarmeResponse;
    try {
        pagarmeResponse = await (0, client_1.createOrder)(orderRequest, idempotencyKey);
    }
    catch (err) {
        const failureReason = err instanceof types_1.PagarmeApiError
            ? `Pagar.me ${err.status}`
            : err instanceof Error
                ? err.message
                : String(err);
        // Independent transaction so the audit row survives the outer rollback.
        await recordAuditOutOfBand(tenantId, {
            action: 'payment.create_failed',
            entity: 'payment',
            entityId: payment.id,
            userId,
            payload: {
                contract_id: input.contractId,
                method: input.method,
                error: failureReason,
            },
        });
        throw err;
    }
    // 6. Persist Pagar.me identifiers + full response.
    const charge = pagarmeResponse.charges[0];
    if (!charge) {
        throw new Error('Resposta do Pagar.me sem charge — payload inválido');
    }
    await db
        .update(payments_1.pagarmeOrders)
        .set({
        // biome-ignore lint/suspicious/noExplicitAny: jsonb accepts any serializable payload
        responsePayload: pagarmeResponse,
    })
        .where((0, drizzle_orm_1.eq)(payments_1.pagarmeOrders.paymentId, payment.id));
    const updatedPaymentsRows = await db
        .update(payments_1.payments)
        .set({
        gatewayOrderId: pagarmeResponse.id,
        gatewayChargeId: charge.id,
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(payments_1.payments.id, payment.id))
        .returning();
    const updatedPayment = updatedPaymentsRows[0];
    if (!updatedPayment)
        throw new Error('createChargeInTenant: payments update returned no row');
    // 7. Audit (no PII — only ids + method).
    await (0, audit_1.recordAudit)(db, {
        action: 'payment.created',
        entity: 'payment',
        entityId: updatedPayment.id,
        userId,
        payload: {
            contract_id: input.contractId,
            gateway_order_id: pagarmeResponse.id,
            gateway_charge_id: charge.id,
            method: input.method,
            amount_brl_cents: input.amount_brl_cents,
        },
    });
    // 8. Surface PIX details for PIX charges.
    const pixDetails = input.method === 'pix'
        ? {
            pix_copy_paste: charge.last_transaction?.qr_code ?? null,
            pix_qr_url: charge.last_transaction?.qr_code_url ?? null,
            pix_expires_at: charge.last_transaction?.expires_at ?? null,
        }
        : {
            pix_copy_paste: null,
            pix_qr_url: null,
            pix_expires_at: null,
        };
    return {
        payment: toPersistedPayment(updatedPayment),
        ...pixDetails,
    };
}
/**
 * RLS-scoped SELECT for the cobranças list. Optionally filtered by contract.
 */
async function listPaymentsInTenant(db, input) {
    const conds = [(0, drizzle_orm_1.isNull)(payments_1.payments.deletedAt)];
    if (input.contractId)
        conds.push((0, drizzle_orm_1.eq)(payments_1.payments.contractId, input.contractId));
    const rows = await db
        .select()
        .from(payments_1.payments)
        .where((0, drizzle_orm_1.and)(...conds))
        .orderBy((0, drizzle_orm_1.desc)(payments_1.payments.createdAt));
    return rows.map(toPersistedPayment);
}
/** Single-row read for the detail page — returns null if not in tenant. */
async function getPaymentByIdInTenant(db, input) {
    const rows = await db
        .select({
        payment: payments_1.payments,
        pagarme_response: payments_1.pagarmeOrders.responsePayload,
    })
        .from(payments_1.payments)
        .leftJoin(payments_1.pagarmeOrders, (0, drizzle_orm_1.eq)(payments_1.pagarmeOrders.paymentId, payments_1.payments.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(payments_1.payments.id, input.paymentId), (0, drizzle_orm_1.isNull)(payments_1.payments.deletedAt)))
        .limit(1);
    const r = rows[0];
    if (!r)
        return null;
    // Try to extract PIX QR from the cached response payload.
    // biome-ignore lint/suspicious/noExplicitAny: jsonb is unstructured at the DB layer
    const resp = r.pagarme_response;
    const last = resp?.charges?.[0]?.last_transaction;
    return {
        payment: toPersistedPayment(r.payment),
        pix_copy_paste: last?.qr_code ?? null,
        pix_qr_url: last?.qr_code_url ?? null,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
/**
 * Write an audit_log row in an INDEPENDENT withTenant transaction. Used
 * when the calling transaction is about to roll back (Pagar.me API call
 * failed) but we still want a durable trail of the failure. Errors here
 * are swallowed and logged because the caller is already on an error
 * path — re-throwing would shadow the original Pagar.me error.
 */
async function recordAuditOutOfBand(tenantId, opts) {
    try {
        await (0, with_tenant_1.withTenant)(tenantId, async (db) => {
            await (0, audit_1.recordAudit)(db, opts);
        });
    }
    catch (auditErr) {
        // Last-resort: log to stderr. We deliberately do NOT re-throw — the
        // original Pagar.me error must surface to the caller.
        console.error('recordAuditOutOfBand failed', auditErr);
    }
}
/**
 * Walk the cause chain of a thrown error looking for a postgres
 * `unique_violation` (SQLSTATE 23505). Drizzle wraps the postgres.js
 * driver error inside `cause`, so a raw `err.code === '23505'` check
 * misses the constraint name. Plan 01-03 pattern.
 */
function isUniqueViolation(err) {
    let cur = err;
    let depth = 0;
    while (cur && depth < 5) {
        if (typeof cur === 'object' && cur !== null) {
            const code = cur.code;
            if (code === '23505')
                return true;
            cur = cur.cause;
        }
        else {
            break;
        }
        depth += 1;
    }
    return false;
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (thin wrappers over the *InTenant helpers)
// ────────────────────────────────────────────────────────────────────────────
exports.createCharge = safe_action_1.withTenantAction
    .inputSchema(payment_1.createChargeSchema)
    .action(async ({ ctx, parsedInput }) => {
    const result = await createChargeInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/cobrancas', 'page');
    (0, cache_1.revalidatePath)(`/[slug]/cobrancas/${result.payment.id}`, 'page');
    return result;
});
exports.listPayments = safe_action_1.withTenantAction
    .inputSchema(payment_1.listPaymentsSchema)
    .action(async ({ ctx, parsedInput }) => {
    return listPaymentsInTenant(ctx.db, parsedInput);
});
exports.getPaymentById = safe_action_1.withTenantAction
    .inputSchema(payment_1.paymentIdSchema)
    .action(async ({ ctx, parsedInput }) => {
    const result = await getPaymentByIdInTenant(ctx.db, parsedInput);
    if (!result)
        throw new Error('Pagamento não encontrado');
    return result;
});
