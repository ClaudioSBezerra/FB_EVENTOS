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

'use server'

import { randomBytes } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { user as userTable } from '@/db/schema/auth'
import { cartAddonLines } from '@/db/schema/cart_addon_lines'
import { contracts } from '@/db/schema/contracts'
import { lotReservations } from '@/db/schema/lot_reservations'
import { lotCategories, lots } from '@/db/schema/lots'
import { pagarmeOrders, payments } from '@/db/schema/payments'
import { vendors } from '@/db/schema/vendors'
import { type TenantDb, withTenant } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import { computeLotPrice } from '@/lib/lots/price'
import { createOrder } from '@/lib/pagarme/client'
import { computeInstallmentAmount } from '@/lib/pagarme/installments-shape.generated'
import { createSimulatedOrder, shouldUseSimulator } from '@/lib/pagarme/simulator'
import { PagarmeApiError, type PagarmeOrderCreateRequest } from '@/lib/pagarme/types'
import { type CheckoutCartInput, checkoutCartSchema } from '@/lib/validators/checkout'

// ────────────────────────────────────────────────────────────────────────────
// Result types
// ────────────────────────────────────────────────────────────────────────────

export interface CheckoutResult {
  payment: {
    id: string
    tenantId: string
    amountBrlCents: number
    method: string
    status: string
    gatewayOrderId: string | null
    gatewayChargeId: string | null
  }
  /** PIX copia-cola string. Present when method='pix'. */
  pix_copy_paste: string | null
  /** PIX QR code image URL. Present when method='pix'. */
  pix_qr_url: string | null
  /** PIX expiry instant (ISO). Present when method='pix'. */
  pix_expires_at: string | null
  /** Installment amount per parcel, in centavos. Present when method='credit_card'. */
  installment_amount_brl_cents: number | null
  /** Number of installments requested. */
  installments: number | null
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const PIX_EXPIRES_IN_SECONDS = 3600 // 1h

function generateIdempotencyKey(reservationId: string): string {
  return `checkout-${reservationId}-${randomBytes(8).toString('hex')}`
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
export async function checkoutCartInTenant(
  db: TenantDb,
  tenantId: string,
  input: CheckoutCartInput,
  vendorId: string,
  userId: string,
): Promise<CheckoutResult> {
  // 1. Load reservation + validate ownership + TTL + not released.
  const resRows = await db
    .select()
    .from(lotReservations)
    .where(
      and(
        eq(lotReservations.id, input.reservationId),
        eq(lotReservations.vendorId, vendorId),
        isNull(lotReservations.releasedAt),
      ),
    )
    .limit(1)
  const reservation = resRows[0]
  if (!reservation) {
    throw new Error('Reserva não encontrada ou não pertence ao fornecedor')
  }
  if (reservation.expiresAt <= new Date()) {
    throw new Error('Reserva expirada — renove a reserva antes de prosseguir')
  }

  // 2. Load lot → category for lot price.
  const lotRows = await db
    .select({ lot: lots, category: lotCategories })
    .from(lots)
    .innerJoin(lotCategories, eq(lotCategories.id, lots.categoryId))
    .where(eq(lots.id, reservation.lotId))
    .limit(1)
  const lotRow = lotRows[0]
  if (!lotRow) {
    throw new Error('Lote da reserva não encontrado')
  }

  // 3. Load vendor for Pagar.me customer fields.
  const vendorRows = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1)
  const vendor = vendorRows[0]
  if (!vendor) {
    throw new Error('Fornecedor não encontrado')
  }

  // 3b. Garantir contracts row (FK obrigatória de payments).
  //
  // DESIGN 2026-06-17 (operator decision): a adesão formal do vendor
  // acontece UMA vez no signup (vendor_consents — LGPD), e a aprovação
  // pela organizadora (vendor.status='approved') confirma a habilitação.
  // Não exige um contrato signed POR LOTE.
  //
  // Mas payments.contract_id é NOT NULL com FK pra contracts.id; pra
  // satisfazer o schema sem mudar a tabela, criamos um contracts row
  // por compra com status='signed' (auto-aceito). Reaproveita se já
  // existir um contrato signed pra esse (lot, vendor, event).
  const existingContractRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(
      and(
        eq(contracts.lotId, reservation.lotId),
        eq(contracts.vendorId, vendorId),
        eq(contracts.eventId, reservation.eventId),
        eq(contracts.status, 'signed'),
        isNull(contracts.deletedAt),
      ),
    )
    .limit(1)
  let contract = existingContractRows[0]
  if (!contract) {
    const inserted = await db
      .insert(contracts)
      .values({
        tenantId,
        vendorId,
        lotId: reservation.lotId,
        eventId: reservation.eventId,
        templateVersion: 'fornecedor-stand-v1',
        status: 'signed',
      })
      .returning({ id: contracts.id })
    contract = inserted[0]
    if (!contract) {
      throw new Error('checkoutCartInTenant: falha ao criar contrato auto-signed')
    }
  }

  // 4. Compute cart total = lot price (centavos) + add-on snapshot sum.
  const lotPriceBrl = computeLotPrice(lotRow.category, lotRow.lot)
  const lotCents = Math.round(lotPriceBrl * 100)

  const addonSumRows = await db
    .select({
      totalCents: sql<string>`COALESCE(SUM(${cartAddonLines.priceBrlCentsSnapshot} * ${cartAddonLines.quantity}), 0)`,
    })
    .from(cartAddonLines)
    .where(eq(cartAddonLines.reservationId, input.reservationId))
  const addonCents = Number(addonSumRows[0]?.totalCents ?? 0)
  const totalCents = lotCents + addonCents

  // 5. Compute installment amount for credit_card (client-side, AM-06).
  const installments = input.method === 'credit_card' ? (input.installments ?? 1) : null
  const installmentAmountCents =
    installments != null ? computeInstallmentAmount(totalCents, installments) : null

  // 6. Build Pagar.me order request.
  const idempotencyKey = generateIdempotencyKey(input.reservationId)
  const customerName = vendor.tradeName ?? vendor.legalName
  const customerDoc = vendor.cnpj.replace(/\D/g, '')

  const orderRequest: PagarmeOrderCreateRequest = {
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
  }

  // 7. INSERT payments row (status=pending).
  const insertedPayments = await db
    .insert(payments)
    .values({
      tenantId,
      contractId: contract.id,
      gateway: 'pagarme',
      amountBrlCents: totalCents,
      method: input.method,
      status: 'pending',
    })
    .returning()
  const payment = insertedPayments[0]
  if (!payment) throw new Error('checkoutCartInTenant: payments insert returned no row')

  // 8. INSERT pagarme_orders row with request payload.
  try {
    await db.insert(pagarmeOrders).values({
      tenantId,
      paymentId: payment.id,
      // biome-ignore lint/suspicious/noExplicitAny: jsonb accepts any serializable payload
      requestPayload: orderRequest as any,
      idempotencyKey,
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new Error('Cobrança duplicada detectada — aguarde ou recarregue a página')
    }
    throw err
  }

  // 9. POST to Pagar.me API — OR call the simulator when the operator
  //    has set PAYMENT_SIMULATOR_ENABLED=true (piloto pré-credencial).
  //    The simulator returns the same response shape so steps 10-13 don't
  //    need to branch.
  let pagarmeResponse: Awaited<ReturnType<typeof createOrder>>
  if (shouldUseSimulator()) {
    pagarmeResponse = createSimulatedOrder(orderRequest, idempotencyKey)
  } else {
    try {
      pagarmeResponse = await createOrder(orderRequest, idempotencyKey)
    } catch (err) {
      const failureReason = err instanceof PagarmeApiError ? `Pagar.me ${err.status}` : String(err)
      await recordAuditOutOfBand(tenantId, {
        action: 'payment.create_failed',
        entity: 'payment',
        entityId: payment.id,
        userId,
        payload: {
          reservation_id: input.reservationId,
          method: input.method,
          error: failureReason,
        },
      })
      throw err
    }
  }

  // 10. Persist gateway IDs + response payload.
  const charge = pagarmeResponse.charges[0]
  if (!charge) {
    throw new Error('Resposta do Pagar.me sem charge — payload inválido')
  }
  await db
    .update(pagarmeOrders)
    .set({
      // biome-ignore lint/suspicious/noExplicitAny: jsonb accepts any serializable payload
      responsePayload: pagarmeResponse as any,
    })
    .where(eq(pagarmeOrders.paymentId, payment.id))

  const updatedPaymentsRows = await db
    .update(payments)
    .set({
      gatewayOrderId: pagarmeResponse.id,
      gatewayChargeId: charge.id,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id))
    .returning()
  const updatedPayment = updatedPaymentsRows[0]
  if (!updatedPayment) throw new Error('checkoutCartInTenant: payments update returned no row')

  // 11. Tag the reservation with the payment method chosen.
  await db
    .update(lotReservations)
    .set({ paymentMethod: input.method })
    .where(eq(lotReservations.id, input.reservationId))

  // 12. Audit.
  await recordAudit(db, {
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
  })

  // 13. Build result.
  const pixDetails =
    input.method === 'pix'
      ? {
          pix_copy_paste: charge.last_transaction?.qr_code ?? null,
          pix_qr_url: charge.last_transaction?.qr_code_url ?? null,
          pix_expires_at: charge.last_transaction?.expires_at ?? null,
        }
      : { pix_copy_paste: null, pix_qr_url: null, pix_expires_at: null }

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
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function recordAuditOutOfBand(
  tenantId: string,
  opts: Parameters<typeof recordAudit>[1],
): Promise<void> {
  try {
    await withTenant(tenantId, async (db) => {
      await recordAudit(db, opts)
    })
  } catch {
    // Swallow — we're already on an error path.
  }
}

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err
  for (let i = 0; i < 5; i++) {
    if (typeof cur === 'object' && cur !== null) {
      if ((cur as { code?: unknown }).code === '23505') return true
      cur = (cur as { cause?: unknown }).cause
    } else break
  }
  return false
}

// ────────────────────────────────────────────────────────────────────────────
// Server Action
// ────────────────────────────────────────────────────────────────────────────

export const startCheckout = withTenantAction
  .inputSchema(checkoutCartSchema)
  .action(async ({ ctx, parsedInput }) => {
    // Resolve vendor.id do user autenticado. vendors.id ≠ user.id por
    // design (vendor é cadastro pj, gerado com UUID próprio em
    // createVendorInTenant). Em vez do hack legado de Phase 2 que passava
    // userId como vendorId, fazemos lookup explícito via email matching
    // dentro do tenant ativo. Se o user não tem vendor cadastrado, falha
    // com mensagem amigável.
    const userRows = await ctx.db
      .select({ email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, ctx.userId))
      .limit(1)
    const userEmail = userRows[0]?.email
    if (!userEmail) {
      throw new Error('Usuário não encontrado')
    }
    const vendorRows = await ctx.db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.email, userEmail), isNull(vendors.deletedAt)))
      .limit(1)
    const vendorId = vendorRows[0]?.id
    if (!vendorId) {
      throw new Error(
        'Você ainda não tem cadastro de fornecedor neste evento. Faça o signup pelo marketplace antes de continuar.',
      )
    }
    const result = await checkoutCartInTenant(
      ctx.db,
      ctx.tenantId,
      parsedInput,
      vendorId,
      ctx.userId,
    )
    revalidatePath('/[slug]/checkout/[cartId]', 'page')
    return result
  })
