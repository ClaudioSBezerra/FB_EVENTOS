"use strict";
// FB_EVENTOS — Checkout Server Action (Phase 2, Plan 02-05, Task 3).
//
// FORN-09: PIX + credit_card checkout for a lot reservation.
//
// Flow (for both methods):
//   1. Validate reservation ownership + not expired + not released.
//   2. Load lot → category → compute lot price (computeLotPrice).
//   3. Sum cart_addon_lines (snapshot prices).
//   4. Build Pagar.me order request (PIX or credit_card).
//   5. INSERT payments row (status=pending).
//   6. INSERT pagarme_orders row with idempotencyKey + request payload.
//   7. POST to Pagar.me /core/v5/orders.
//   8. UPDATE payments (gateway_order_id, gateway_charge_id) + pagarme_orders
//      (response_payload).
//   9. UPDATE lot_reservations.payment_method = input.method.
//  10. recordAudit('payment.created').
//  11. Return PIX QR / installment_amount for UI.
//
// NO BOLETO (AM-01 — deferred to Phase 3+).
// NO SPLIT (Phase 2 adds split via Pagar.me Recipients — future plan).
//
// IDEMPOTENCY:
//   pagarme_orders.idempotency_key UNIQUE catches duplicate submits.
//   Same key on X-Idempotency-Key header covers Pagar.me-side dedup.
//
// INSTALLMENTS (FORN-09 credit_card path):
//   installment_amount is computed client-side via computeInstallmentAmount
//   (tabela Price, 3.5%/mo compound). AM-06 probe is pending — when sandbox
//   confirms Pagar.me returns a different installments key, update
//   src/lib/pagarme/installments-shape.generated.ts.
//
// REFERENCES:
//   - 02-CONTEXT.md FORN-09 (checkout paths)
//   - src/lib/actions/payments.ts (createChargeInTenant analog)
//   - src/lib/pagarme/installments-shape.generated.ts (AM-06)
'use server';
// FB_EVENTOS — Checkout Server Action (Phase 2, Plan 02-05, Task 3).
//
// FORN-09: PIX + credit_card checkout for a lot reservation.
//
// Flow (for both methods):
//   1. Validate reservation ownership + not expired + not released.
//   2. Load lot → category → compute lot price (computeLotPrice).
//   3. Sum cart_addon_lines (snapshot prices).
//   4. Build Pagar.me order request (PIX or credit_card).
//   5. INSERT payments row (status=pending).
//   6. INSERT pagarme_orders row with idempotencyKey + request payload.
//   7. POST to Pagar.me /core/v5/orders.
//   8. UPDATE payments (gateway_order_id, gateway_charge_id) + pagarme_orders
//      (response_payload).
//   9. UPDATE lot_reservations.payment_method = input.method.
//  10. recordAudit('payment.created').
//  11. Return PIX QR / installment_amount for UI.
//
// NO BOLETO (AM-01 — deferred to Phase 3+).
// NO SPLIT (Phase 2 adds split via Pagar.me Recipients — future plan).
//
// IDEMPOTENCY:
//   pagarme_orders.idempotency_key UNIQUE catches duplicate submits.
//   Same key on X-Idempotency-Key header covers Pagar.me-side dedup.
//
// INSTALLMENTS (FORN-09 credit_card path):
//   installment_amount is computed client-side via computeInstallmentAmount
//   (tabela Price, 3.5%/mo compound). AM-06 probe is pending — when sandbox
//   confirms Pagar.me returns a different installments key, update
//   src/lib/pagarme/installments-shape.generated.ts.
//
// REFERENCES:
//   - 02-CONTEXT.md FORN-09 (checkout paths)
//   - src/lib/actions/payments.ts (createChargeInTenant analog)
//   - src/lib/pagarme/installments-shape.generated.ts (AM-06)
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCheckout = void 0;
exports.checkoutCartInTenant = checkoutCartInTenant;
const node_crypto_1 = require("node:crypto");
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const cart_addon_lines_1 = require("@/db/schema/cart_addon_lines");
const contracts_1 = require("@/db/schema/contracts");
const lot_reservations_1 = require("@/db/schema/lot_reservations");
const lots_1 = require("@/db/schema/lots");
const payments_1 = require("@/db/schema/payments");
const vendors_1 = require("@/db/schema/vendors");
const with_tenant_1 = require("@/db/with-tenant");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const price_1 = require("@/lib/lots/price");
const client_1 = require("@/lib/pagarme/client");
const installments_shape_generated_1 = require("@/lib/pagarme/installments-shape.generated");
const types_1 = require("@/lib/pagarme/types");
const checkout_1 = require("@/lib/validators/checkout");
// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
const PIX_EXPIRES_IN_SECONDS = 3600; // 1h
function generateIdempotencyKey(reservationId) {
    return `checkout-${reservationId}-${(0, node_crypto_1.randomBytes)(8).toString('hex')}`;
}
// ────────────────────────────────────────────────────────────────────────────
// Pure helper (tests drive this inside withTenant)
// ────────────────────────────────────────────────────────────────────────────
/**
 * Execute the full checkout flow for a lot reservation.
 *
 * @throws if reservation not found / expired / released, or Pagar.me fails.
 * RLS contract: caller MUST be inside withTenant(tenantId, ...).
 */
async function checkoutCartInTenant(db, tenantId, input, vendorId, userId) {
    // 1. Load reservation + validate ownership + TTL + not released.
    const resRows = await db
        .select()
        .from(lot_reservations_1.lotReservations)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.id, input.reservationId), (0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.vendorId, vendorId), (0, drizzle_orm_1.isNull)(lot_reservations_1.lotReservations.releasedAt)))
        .limit(1);
    const reservation = resRows[0];
    if (!reservation) {
        throw new Error('Reserva não encontrada ou não pertence ao fornecedor');
    }
    if (reservation.expiresAt <= new Date()) {
        throw new Error('Reserva expirada — renove a reserva antes de prosseguir');
    }
    // 2. Load lot → category for lot price.
    const lotRows = await db
        .select({ lot: lots_1.lots, category: lots_1.lotCategories })
        .from(lots_1.lots)
        .innerJoin(lots_1.lotCategories, (0, drizzle_orm_1.eq)(lots_1.lotCategories.id, lots_1.lots.categoryId))
        .where((0, drizzle_orm_1.eq)(lots_1.lots.id, reservation.lotId))
        .limit(1);
    const lotRow = lotRows[0];
    if (!lotRow) {
        throw new Error('Lote da reserva não encontrado');
    }
    // 3. Load vendor for Pagar.me customer fields.
    const vendorRows = await db.select().from(vendors_1.vendors).where((0, drizzle_orm_1.eq)(vendors_1.vendors.id, vendorId)).limit(1);
    const vendor = vendorRows[0];
    if (!vendor) {
        throw new Error('Fornecedor não encontrado');
    }
    // 3b. Look up signed contract for lot + vendor (required for payments FK).
    //     Phase 2 self-service: the contract must exist (created by Phase 1 org flow).
    //     If no signed contract, reject — vendor must complete the contract step first.
    const contractRows = await db
        .select({ id: contracts_1.contracts.id })
        .from(contracts_1.contracts)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(contracts_1.contracts.lotId, reservation.lotId), (0, drizzle_orm_1.eq)(contracts_1.contracts.vendorId, vendorId), (0, drizzle_orm_1.eq)(contracts_1.contracts.eventId, reservation.eventId), (0, drizzle_orm_1.eq)(contracts_1.contracts.status, 'signed'), (0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)))
        .limit(1);
    const contract = contractRows[0];
    if (!contract) {
        throw new Error('Contrato assinado não encontrado para este lote — aguarde o contrato ser assinado antes de prosseguir');
    }
    // 4. Compute cart total = lot price (centavos) + add-on snapshot sum.
    const lotPriceBrl = (0, price_1.computeLotPrice)(lotRow.category, lotRow.lot);
    const lotCents = Math.round(lotPriceBrl * 100);
    const addonSumRows = await db
        .select({
        totalCents: (0, drizzle_orm_1.sql) `COALESCE(SUM(${cart_addon_lines_1.cartAddonLines.priceBrlCentsSnapshot} * ${cart_addon_lines_1.cartAddonLines.quantity}), 0)`,
    })
        .from(cart_addon_lines_1.cartAddonLines)
        .where((0, drizzle_orm_1.eq)(cart_addon_lines_1.cartAddonLines.reservationId, input.reservationId));
    const addonCents = Number(addonSumRows[0]?.totalCents ?? 0);
    const totalCents = lotCents + addonCents;
    // 5. Compute installment amount for credit_card (client-side, AM-06).
    const installments = input.method === 'credit_card' ? (input.installments ?? 1) : null;
    const installmentAmountCents = installments != null ? (0, installments_shape_generated_1.computeInstallmentAmount)(totalCents, installments) : null;
    // 6. Build Pagar.me order request.
    const idempotencyKey = generateIdempotencyKey(input.reservationId);
    const customerName = vendor.tradeName ?? vendor.legalName;
    const customerDoc = vendor.cnpj.replace(/\D/g, '');
    const orderRequest = {
        customer: {
            name: customerName,
            email: vendor.email,
            document: customerDoc,
            type: customerDoc.length === 14 ? 'company' : 'individual',
        },
        items: [
            {
                amount: totalCents,
                description: `Reserva lote ${lotRow.lot.code} — ${lotRow.category.name}`,
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
                        card_token: input.cardToken ?? '',
                        installments: installments ?? 1,
                        statement_descriptor: 'FB EVENTOS',
                    },
                },
        ],
        code: input.reservationId,
    };
    // 7. INSERT payments row (status=pending).
    const insertedPayments = await db
        .insert(payments_1.payments)
        .values({
        tenantId,
        contractId: contract.id,
        gateway: 'pagarme',
        amountBrlCents: totalCents,
        method: input.method,
        status: 'pending',
    })
        .returning();
    const payment = insertedPayments[0];
    if (!payment)
        throw new Error('checkoutCartInTenant: payments insert returned no row');
    // 8. INSERT pagarme_orders row with request payload.
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
        if (isUniqueViolation(err)) {
            throw new Error('Cobrança duplicada detectada — aguarde ou recarregue a página');
        }
        throw err;
    }
    // 9. POST to Pagar.me API.
    let pagarmeResponse;
    try {
        pagarmeResponse = await (0, client_1.createOrder)(orderRequest, idempotencyKey);
    }
    catch (err) {
        const failureReason = err instanceof types_1.PagarmeApiError ? `Pagar.me ${err.status}` : String(err);
        await recordAuditOutOfBand(tenantId, {
            action: 'payment.create_failed',
            entity: 'payment',
            entityId: payment.id,
            userId,
            payload: { reservation_id: input.reservationId, method: input.method, error: failureReason },
        });
        throw err;
    }
    // 10. Persist gateway IDs + response payload.
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
        throw new Error('checkoutCartInTenant: payments update returned no row');
    // 11. Tag the reservation with the payment method chosen.
    await db
        .update(lot_reservations_1.lotReservations)
        .set({ paymentMethod: input.method })
        .where((0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.id, input.reservationId));
    // 12. Audit.
    await (0, audit_1.recordAudit)(db, {
        action: 'payment.created',
        entity: 'payment',
        entityId: updatedPayment.id,
        userId,
        payload: {
            reservation_id: input.reservationId,
            gateway_order_id: pagarmeResponse.id,
            gateway_charge_id: charge.id,
            method: input.method,
            amount_brl_cents: totalCents,
        },
    });
    // 13. Build result.
    const pixDetails = input.method === 'pix'
        ? {
            pix_copy_paste: charge.last_transaction?.qr_code ?? null,
            pix_qr_url: charge.last_transaction?.qr_code_url ?? null,
            pix_expires_at: charge.last_transaction?.expires_at ?? null,
        }
        : { pix_copy_paste: null, pix_qr_url: null, pix_expires_at: null };
    return {
        payment: {
            id: updatedPayment.id,
            tenantId: updatedPayment.tenantId,
            amountBrlCents: updatedPayment.amountBrlCents,
            method: updatedPayment.method,
            status: updatedPayment.status,
            gatewayOrderId: updatedPayment.gatewayOrderId,
            gatewayChargeId: updatedPayment.gatewayChargeId,
        },
        ...pixDetails,
        installment_amount_brl_cents: installmentAmountCents,
        installments,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
async function recordAuditOutOfBand(tenantId, opts) {
    try {
        await (0, with_tenant_1.withTenant)(tenantId, async (db) => {
            await (0, audit_1.recordAudit)(db, opts);
        });
    }
    catch {
        // Swallow — we're already on an error path.
    }
}
function isUniqueViolation(err) {
    let cur = err;
    for (let i = 0; i < 5; i++) {
        if (typeof cur === 'object' && cur !== null) {
            if (cur.code === '23505')
                return true;
            cur = cur.cause;
        }
        else
            break;
    }
    return false;
}
// ────────────────────────────────────────────────────────────────────────────
// Server Action
// ────────────────────────────────────────────────────────────────────────────
exports.startCheckout = safe_action_1.withTenantAction
    .inputSchema(checkout_1.checkoutCartSchema)
    .action(async ({ ctx, parsedInput }) => {
    const result = await checkoutCartInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId, // vendorId = authenticated user in Phase 2
    ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/checkout/[cartId]', 'page');
    return result;
});
