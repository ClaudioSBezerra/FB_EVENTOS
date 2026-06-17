// FB_EVENTOS — Lot reservation Server Actions (Phase 2, Plan 02-03).
//
// Pure helper `reserveLotInTenant` + thin Server Action `reserveLot`.
// Also exports `releaseReservationInTenant` (used by SAGA cancel in Plan 02-06).
//
// ─────────────────────────────────────────────────────────────────────────────
// CONCURRENCY SAFETY (FORN-05 — load-bearing):
// ─────────────────────────────────────────────────────────────────────────────
// Three layers of defense against two fornecedores claiming the same lot:
//
//   Layer 1 — pg_try_advisory_xact_lock(hashtext('lot:{eventId}:{lotId}')::bigint)
//             Serializes concurrent calls on the same (event, lot) pair at the
//             Postgres advisory-lock level. Returns false without waiting if
//             another tx holds the lock — the second caller gets an immediate
//             'Lote já reservado' error (no queue, no wait).
//
//   Layer 2 — Re-SELECT lot.status='available' under the lock (TOCTOU guard).
//             Two callers can both see status='available' before the lock; the
//             second one re-checks AFTER acquiring the lock so it sees the
//             committed reservation.
//
//   Layer 3 — Partial UNIQUE index on lot_reservations (lot_id WHERE
//             released_at IS NULL AND expires_at > now()). Belt-and-suspenders:
//             if Layer 1 collides, the INSERT raises 23505 and we surface the
//             same UX-quality message.
//
// REFERENCES:
//   - 02-PATTERNS.md §reservations + §Pattern 1 (advisory-lock pattern)
//   - 02-RESEARCH.md lines 332-374 §Pattern 1; Pitfall 5 (hashtext collision)
//   - src/lib/actions/lot-assignments.ts (guard-INSERT-audit envelope)

'use server'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { user as userTable } from '@/db/schema/auth'
import { lotReservations } from '@/db/schema/lot_reservations'
import { lots } from '@/db/schema/lots'
import { vendors } from '@/db/schema/vendors'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import { emitOutboxEvent, emitOutboxEventAndNotify } from '@/lib/outbox/emit'
import { type ReserveLotInput, reserveLotSchema } from '@/lib/validators/reservations'

// ────────────────────────────────────────────────────────────────────────────
// Persisted shape returned to callers
// ────────────────────────────────────────────────────────────────────────────

export interface PersistedReservation {
  reservation_id: string
  expires_at: Date
}

// ────────────────────────────────────────────────────────────────────────────
// Pure business helper — reserveLotInTenant
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reserve a lot for a vendor inside an existing withTenant transaction.
 *
 * Steps (per 02-PATTERNS.md §Pattern 1):
 *   1. Acquire advisory lock → fail fast if already locked (FORN-05 Layer 1)
 *   2. Re-verify lot.status='available' under lock (TOCTOU guard — Layer 2)
 *   3. Verify vendor.status='approved' (D-23 approval gate)
 *   4. INSERT lot_reservations with expires_at = now()+15min (D-05/AM-01)
 *   5. emitOutboxEvent 'lot.reserved' (FORN-13 atomicity)
 *   6. emitOutboxEventAndNotify 'lot.status_changed' (AM-03 SSE latency)
 *   7. recordAudit 'lot_reservation.created'
 *   8. Return { reservation_id, expires_at }
 *
 * Throws with Portuguese UX-quality messages on every failure path.
 */
export async function reserveLotInTenant(
  db: TenantDb,
  tenantId: string,
  input: ReserveLotInput,
  userId: string,
): Promise<PersistedReservation> {
  const { eventId, lotId, vendorId } = input

  // ── Step 1: pg_try_advisory_xact_lock (Layer 1 of 3) ─────────────────────
  // The lock key is hashtext('lot:{eventId}:{lotId}') cast to bigint.
  // Advisory xact locks are automatically released on COMMIT or ROLLBACK —
  // no manual release needed. Returns false (not NULL) on failure.
  //
  // Pitfall 5 (02-RESEARCH.md): hashtext maps int4→bigint, so collisions are
  // ~1-in-4B for any fixed (eventId, lotId). Acceptable at Trindade scale
  // (~5000 lots). Phase 4 may switch to two-key form.
  const lockKey = `lot:${eventId}:${lotId}`
  const lockResult = await db.execute<{ got: boolean }>(sql`
    SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint) AS got
  `)
  const lockRows = Array.from(lockResult as Iterable<{ got: boolean }>)
  if (!lockRows[0]?.got) {
    throw new Error('Lote já reservado por outro fornecedor — atualize a página.')
  }

  // ── Step 2: Re-verify lot status under lock (TOCTOU guard — Layer 2) ─────
  const lotRows = await db
    .select({ id: lots.id })
    .from(lots)
    .where(and(eq(lots.id, lotId), eq(lots.status, 'available'), isNull(lots.deletedAt)))
    .limit(1)
  if (!lotRows[0]) {
    throw new Error('Lote indisponível.')
  }

  // ── Step 3: Verify vendor is approved (D-23) ──────────────────────────────
  const vendorRows = await db
    .select({ id: vendors.id, status: vendors.status })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), isNull(vendors.deletedAt)))
    .limit(1)
  const vendor = vendorRows[0]
  if (!vendor) {
    throw new Error('Fornecedor não encontrado ou inacessível.')
  }
  if (vendor.status !== 'approved') {
    throw new Error('Fornecedor não aprovado para comprar lotes.')
  }

  // ── Step 4: INSERT lot_reservations ───────────────────────────────────────
  let inserted: typeof lotReservations.$inferSelect | undefined
  try {
    const rows = await db
      .insert(lotReservations)
      .values({
        tenantId,
        lotId,
        vendorId,
        eventId,
        // Hard-coded 15 min TTL per D-05 simplified by AM-01 (boleto deferred)
        expiresAt: sql`now() + interval '15 minutes'`,
      })
      .returning()
    inserted = rows[0]
  } catch (err) {
    // Walk the error cause chain — Drizzle wraps the PostgresError as `cause`.
    // Layer 3: partial UNIQUE violation (23505) → 'Lote já reservado'
    let cur: unknown = err
    for (let i = 0; i < 4 && cur != null; i++) {
      const msg = cur instanceof Error ? cur.message : String(cur)
      const code = (cur as { code?: unknown }).code
      if (
        /lot_reservations_lot_id_active_unique/.test(msg) ||
        /duplicate key/.test(msg) ||
        code === '23505'
      ) {
        throw new Error('Lote já reservado por outro fornecedor.')
      }
      cur = (cur as { cause?: unknown }).cause
    }
    throw err
  }
  if (!inserted) throw new Error('reserveLotInTenant: insert returned no row')

  // ── Step 5: emitOutboxEvent 'lot.reserved' (FORN-13 — same tx) ───────────
  await emitOutboxEvent(db, 'lot.reserved', lotId, {
    reservation_id: inserted.id,
    vendor_id: vendorId,
    event_id: eventId,
  })

  // ── Step 6: emitOutboxEventAndNotify 'lot.status_changed' (AM-03 SSE) ────
  await emitOutboxEventAndNotify(db, 'lot.status_changed', {
    event_id: eventId,
    lot_id: lotId,
    new_status: 'reserved',
  })

  // ── Step 7: recordAudit ───────────────────────────────────────────────────
  await recordAudit(db, {
    action: 'lot_reservation.created',
    entity: 'lot_reservation',
    entityId: inserted.id,
    userId,
    payload: { lot_id: lotId, vendor_id: vendorId, event_id: eventId },
  })

  // ── Step 8: Return ────────────────────────────────────────────────────────
  return {
    reservation_id: inserted.id,
    expires_at: inserted.expiresAt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// releaseReservationInTenant — used by SAGA cancel (Plan 02-06)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cancel an active reservation (payment failed, user explicitly cancelled).
 * Sets released_at=now(), emits lot.released outbox event.
 *
 * Idempotent: if already released, silently no-ops (released_at IS NULL guard).
 */
export async function releaseReservationInTenant(
  db: TenantDb,
  _tenantId: string,
  reservationId: string,
  userId: string,
): Promise<void> {
  const rows = await db.execute<{ lot_id: string; event_id: string }>(sql`
    UPDATE lot_reservations
    SET released_at = now()
    WHERE id = ${reservationId}::uuid
      AND released_at IS NULL
    RETURNING lot_id, event_id
  `)
  const released = Array.from(rows as Iterable<{ lot_id: string; event_id: string }>)
  if (!released[0]) return // Already released — idempotent

  const { lot_id: lotId, event_id: eventId } = released[0]

  await emitOutboxEvent(db, 'lot.released', lotId, {
    reservation_id: reservationId,
    event_id: eventId,
    reason: 'cancelled',
  })

  await emitOutboxEventAndNotify(db, 'lot.status_changed', {
    event_id: eventId,
    lot_id: lotId,
    new_status: 'available',
  })

  await recordAudit(db, {
    action: 'lot_reservation.released',
    entity: 'lot_reservation',
    entityId: reservationId,
    userId,
    payload: { lot_id: lotId, event_id: eventId, reason: 'cancelled' },
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Thin Server Action wrapper
// ────────────────────────────────────────────────────────────────────────────

export const reserveLot = withTenantAction
  .inputSchema(reserveLotSchema)
  .action(async ({ ctx, parsedInput }) => {
    const result = await reserveLotInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath(`/[slug]/marketplace`, 'page')
    return result
  })

/**
 * Vendor-facing reservation: resolve vendor.id via user.email automaticamente
 * em vez de exigir que o cliente envie. Esse é o caminho usado pelo
 * marketplace buyer view (planta-buyer-client) — o session knows o user,
 * e ele tem 1 vendor row por tenant (lookup por email).
 */
export const reserveLotForCurrentVendor = withTenantAction
  .inputSchema(reserveLotSchema.omit({ vendorId: true }))
  .action(async ({ ctx, parsedInput }) => {
    // Resolve vendor.id via lookup pelo email do user na tenant ativa.
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
    const result = await reserveLotInTenant(
      ctx.db,
      ctx.tenantId,
      { ...parsedInput, vendorId },
      ctx.userId,
    )
    revalidatePath(`/[slug]/marketplace`, 'page')
    return result
  })
