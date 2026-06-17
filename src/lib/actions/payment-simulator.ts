// FB_EVENTOS — Payment simulator Server Actions (piloto, 2026-06-17).
//
// When the operator clicks "Simular Aprovado" / "Simular Recusado" in the
// checkout simulator panel, the client calls one of these actions. The
// action:
//   1. Re-checks PAYMENT_SIMULATOR_ENABLED — refuses to run when off.
//   2. Validates that the payment is simulated (gatewayOrderId starts SIM_)
//      so an accidental click against a real Pagar.me payment is rejected.
//   3. Updates payments.status + paid_at (paid) or just status (failed).
//   4. Emits the matching outbox event so outbox-drain processes the same
//      cascade a real webhook would have triggered (lot.sold, email send,
//      SAGA cancel, etc.).
//
// 🔴 PRODUCTION SAFETY:
//   These actions are short-circuited when env.PAYMENT_SIMULATOR_ENABLED
//   is false. A real Pagar.me deployment can have the action files in
//   place safely — they refuse to run.

'use server'

import { and, eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { contracts } from '@/db/schema/contracts'
import { lotReservations } from '@/db/schema/lot_reservations'
import { payments } from '@/db/schema/payments'
import { withTenant } from '@/db/with-tenant'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { emitOutboxEvent } from '@/lib/outbox/emit'
import { isSimulatedOrderId, shouldUseSimulator } from '@/lib/pagarme/simulator'

const inputSchema = z.object({
  paymentId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export type SimulatePaymentResult =
  | { ok: true }
  | {
      ok: false
      error:
        | 'simulator_disabled'
        | 'no_session'
        | 'invalid_input'
        | 'payment_not_found'
        | 'not_simulated'
        | 'wrong_status'
        | 'update_failed'
    }

interface LoadedPayment {
  id: string
  status: string
  gatewayOrderId: string | null
  contractId: string
}

type LoadCheckResult =
  | { ok: true; data: LoadedPayment }
  | { ok: false; error: 'payment_not_found' | 'not_simulated' | 'wrong_status' }

async function loadAndCheckPayment(tenantId: string, paymentId: string): Promise<LoadCheckResult> {
  return withTenant(tenantId, async (db) => {
    const rows = await db
      .select({
        id: payments.id,
        status: payments.status,
        gatewayOrderId: payments.gatewayOrderId,
        contractId: payments.contractId,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
    const row = rows[0]
    if (!row) return { ok: false as const, error: 'payment_not_found' as const }
    if (!isSimulatedOrderId(row.gatewayOrderId)) {
      return { ok: false as const, error: 'not_simulated' as const }
    }
    if (row.status !== 'pending') {
      return { ok: false as const, error: 'wrong_status' as const }
    }
    return { ok: true as const, data: row }
  })
}

async function findReservationByPayment(
  tenantId: string,
  paymentId: string,
): Promise<{ id: string; lotId: string; eventId: string } | null> {
  return withTenant(tenantId, async (db) => {
    // Resolve reservation via payment → contract → (lot+event+vendor) →
    // reservation. O pagarme_orders.requestPayload NÃO tem metadata.reservation_id
    // no checkout real (verificado em prod 2026-06-17: simulador
    // emitia payment.paid SEM lot_id, e o handler outbox.payment-paid
    // pulava o UPDATE de lots → lot ficava 'available' eternamente).
    // O contract tem todos os IDs necessários pra achar a reserva ativa.
    const contractRows = await db
      .select({
        lotId: contracts.lotId,
        eventId: contracts.eventId,
        vendorId: contracts.vendorId,
      })
      .from(contracts)
      .innerJoin(payments, eq(payments.contractId, contracts.id))
      .where(eq(payments.id, paymentId))
      .limit(1)
    const c = contractRows[0]
    if (!c) return null

    const reservRows = await db
      .select({
        id: lotReservations.id,
        lotId: lotReservations.lotId,
        eventId: lotReservations.eventId,
      })
      .from(lotReservations)
      .where(
        and(
          eq(lotReservations.lotId, c.lotId),
          eq(lotReservations.vendorId, c.vendorId),
          eq(lotReservations.eventId, c.eventId),
        ),
      )
      .orderBy(lotReservations.reservedAt)
      .limit(1)
    if (reservRows[0]) return reservRows[0]
    // Fallback: contract tem os IDs do lote/evento mesmo sem reserva ativa.
    return { id: '', lotId: c.lotId, eventId: c.eventId }
  })
}

// ────────────────────────────────────────────────────────────────────
// simulatePaymentPaid
// ────────────────────────────────────────────────────────────────────

export async function simulatePaymentPaid(raw: unknown): Promise<SimulatePaymentResult> {
  if (!shouldUseSimulator()) return { ok: false, error: 'simulator_disabled' }

  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) return { ok: false, error: 'no_session' }

  const check = await loadAndCheckPayment(parsed.data.tenantId, parsed.data.paymentId)
  if (!check.ok) return check

  const reservation = await findReservationByPayment(parsed.data.tenantId, parsed.data.paymentId)

  try {
    await withTenant(parsed.data.tenantId, async (db) => {
      // 1. Flip payment.status='paid' + paid_at=now().
      await db
        .update(payments)
        .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() })
        .where(and(eq(payments.id, parsed.data.paymentId), eq(payments.status, 'pending')))

      // 2. Emit outbox payment.paid → drain dispatches outbox.payment-paid
      //    handler → marks lot=sold, releases reservation, enqueues email.
      await emitOutboxEvent(db, 'payment.paid', parsed.data.paymentId, {
        payment_id: parsed.data.paymentId,
        contract_id: check.data.contractId,
        reservation_id: reservation?.id,
        lot_id: reservation?.lotId,
        event_id: reservation?.eventId,
        simulated: true,
      })

      // 3. Audit.
      await recordAudit(db, {
        action: 'payment.simulated_paid',
        entity: 'payment',
        entityId: parsed.data.paymentId,
        userId: session.user.id,
        payload: {
          reservation_id: reservation?.id,
          lot_id: reservation?.lotId,
        },
      })
    })
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        paymentId: parsed.data.paymentId,
      },
      'simulate_payment_paid_failed',
    )
    return { ok: false, error: 'update_failed' }
  }

  return { ok: true }
}

// ────────────────────────────────────────────────────────────────────
// simulatePaymentFailed
// ────────────────────────────────────────────────────────────────────

export async function simulatePaymentFailed(raw: unknown): Promise<SimulatePaymentResult> {
  if (!shouldUseSimulator()) return { ok: false, error: 'simulator_disabled' }

  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) return { ok: false, error: 'no_session' }

  const check = await loadAndCheckPayment(parsed.data.tenantId, parsed.data.paymentId)
  if (!check.ok) return check

  const reservation = await findReservationByPayment(parsed.data.tenantId, parsed.data.paymentId)

  try {
    await withTenant(parsed.data.tenantId, async (db) => {
      await db
        .update(payments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(payments.id, parsed.data.paymentId), eq(payments.status, 'pending')))

      await emitOutboxEvent(db, 'payment.failed', parsed.data.paymentId, {
        payment_id: parsed.data.paymentId,
        contract_id: check.data.contractId,
        reservation_id: reservation?.id,
        lot_id: reservation?.lotId,
        event_id: reservation?.eventId,
        reason: 'simulated_failure',
        simulated: true,
      })

      await recordAudit(db, {
        action: 'payment.simulated_failed',
        entity: 'payment',
        entityId: parsed.data.paymentId,
        userId: session.user.id,
        payload: {
          reservation_id: reservation?.id,
          lot_id: reservation?.lotId,
        },
      })
    })
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        paymentId: parsed.data.paymentId,
      },
      'simulate_payment_failed_failed',
    )
    return { ok: false, error: 'update_failed' }
  }

  return { ok: true }
}
