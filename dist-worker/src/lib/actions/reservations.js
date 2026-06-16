"use strict";
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
'use server';
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reserveLot = void 0;
exports.reserveLotInTenant = reserveLotInTenant;
exports.releaseReservationInTenant = releaseReservationInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const lot_reservations_1 = require("@/db/schema/lot_reservations");
const lots_1 = require("@/db/schema/lots");
const vendors_1 = require("@/db/schema/vendors");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const emit_1 = require("@/lib/outbox/emit");
const reservations_1 = require("@/lib/validators/reservations");
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
async function reserveLotInTenant(db, tenantId, input, userId) {
    const { eventId, lotId, vendorId } = input;
    // ── Step 1: pg_try_advisory_xact_lock (Layer 1 of 3) ─────────────────────
    // The lock key is hashtext('lot:{eventId}:{lotId}') cast to bigint.
    // Advisory xact locks are automatically released on COMMIT or ROLLBACK —
    // no manual release needed. Returns false (not NULL) on failure.
    //
    // Pitfall 5 (02-RESEARCH.md): hashtext maps int4→bigint, so collisions are
    // ~1-in-4B for any fixed (eventId, lotId). Acceptable at Trindade scale
    // (~5000 lots). Phase 4 may switch to two-key form.
    const lockKey = `lot:${eventId}:${lotId}`;
    const lockResult = await db.execute((0, drizzle_orm_1.sql) `
    SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint) AS got
  `);
    const lockRows = Array.from(lockResult);
    if (!lockRows[0]?.got) {
        throw new Error('Lote já reservado por outro fornecedor — atualize a página.');
    }
    // ── Step 2: Re-verify lot status under lock (TOCTOU guard — Layer 2) ─────
    const lotRows = await db
        .select({ id: lots_1.lots.id })
        .from(lots_1.lots)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lots_1.lots.id, lotId), (0, drizzle_orm_1.eq)(lots_1.lots.status, 'available'), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .limit(1);
    if (!lotRows[0]) {
        throw new Error('Lote indisponível.');
    }
    // ── Step 3: Verify vendor is approved (D-23) ──────────────────────────────
    const vendorRows = await db
        .select({ id: vendors_1.vendors.id, status: vendors_1.vendors.status })
        .from(vendors_1.vendors)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, vendorId), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
        .limit(1);
    const vendor = vendorRows[0];
    if (!vendor) {
        throw new Error('Fornecedor não encontrado ou inacessível.');
    }
    if (vendor.status !== 'approved') {
        throw new Error('Fornecedor não aprovado para comprar lotes.');
    }
    // ── Step 4: INSERT lot_reservations ───────────────────────────────────────
    let inserted;
    try {
        const rows = await db
            .insert(lot_reservations_1.lotReservations)
            .values({
            tenantId,
            lotId,
            vendorId,
            eventId,
            // Hard-coded 15 min TTL per D-05 simplified by AM-01 (boleto deferred)
            expiresAt: (0, drizzle_orm_1.sql) `now() + interval '15 minutes'`,
        })
            .returning();
        inserted = rows[0];
    }
    catch (err) {
        // Walk the error cause chain — Drizzle wraps the PostgresError as `cause`.
        // Layer 3: partial UNIQUE violation (23505) → 'Lote já reservado'
        let cur = err;
        for (let i = 0; i < 4 && cur != null; i++) {
            const msg = cur instanceof Error ? cur.message : String(cur);
            const code = cur.code;
            if (/lot_reservations_lot_id_active_unique/.test(msg) ||
                /duplicate key/.test(msg) ||
                code === '23505') {
                throw new Error('Lote já reservado por outro fornecedor.');
            }
            cur = cur.cause;
        }
        throw err;
    }
    if (!inserted)
        throw new Error('reserveLotInTenant: insert returned no row');
    // ── Step 5: emitOutboxEvent 'lot.reserved' (FORN-13 — same tx) ───────────
    await (0, emit_1.emitOutboxEvent)(db, 'lot.reserved', lotId, {
        reservation_id: inserted.id,
        vendor_id: vendorId,
        event_id: eventId,
    });
    // ── Step 6: emitOutboxEventAndNotify 'lot.status_changed' (AM-03 SSE) ────
    await (0, emit_1.emitOutboxEventAndNotify)(db, 'lot.status_changed', {
        event_id: eventId,
        lot_id: lotId,
        new_status: 'reserved',
    });
    // ── Step 7: recordAudit ───────────────────────────────────────────────────
    await (0, audit_1.recordAudit)(db, {
        action: 'lot_reservation.created',
        entity: 'lot_reservation',
        entityId: inserted.id,
        userId,
        payload: { lot_id: lotId, vendor_id: vendorId, event_id: eventId },
    });
    // ── Step 8: Return ────────────────────────────────────────────────────────
    return {
        reservation_id: inserted.id,
        expires_at: inserted.expiresAt,
    };
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
async function releaseReservationInTenant(db, _tenantId, reservationId, userId) {
    const rows = await db.execute((0, drizzle_orm_1.sql) `
    UPDATE lot_reservations
    SET released_at = now()
    WHERE id = ${reservationId}::uuid
      AND released_at IS NULL
    RETURNING lot_id, event_id
  `);
    const released = Array.from(rows);
    if (!released[0])
        return; // Already released — idempotent
    const { lot_id: lotId, event_id: eventId } = released[0];
    await (0, emit_1.emitOutboxEvent)(db, 'lot.released', lotId, {
        reservation_id: reservationId,
        event_id: eventId,
        reason: 'cancelled',
    });
    await (0, emit_1.emitOutboxEventAndNotify)(db, 'lot.status_changed', {
        event_id: eventId,
        lot_id: lotId,
        new_status: 'available',
    });
    await (0, audit_1.recordAudit)(db, {
        action: 'lot_reservation.released',
        entity: 'lot_reservation',
        entityId: reservationId,
        userId,
        payload: { lot_id: lotId, event_id: eventId, reason: 'cancelled' },
    });
}
// ────────────────────────────────────────────────────────────────────────────
// Thin Server Action wrapper
// ────────────────────────────────────────────────────────────────────────────
exports.reserveLot = safe_action_1.withTenantAction
    .inputSchema(reservations_1.reserveLotSchema)
    .action(async ({ ctx, parsedInput }) => {
    const result = await reserveLotInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)(`/[slug]/marketplace`, 'page');
    return result;
});
