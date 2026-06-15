// FB_EVENTOS — Cart add-on Server Actions (Phase 2, Plan 02-05, Task 2).
//
// Three operations:
//
//   - addAddonToCartInTenant(db, tenantId, input, userId)
//       Pure helper: verifies reservation belongs to vendor + not expired +
//       not yet released. Loads addon (must be active). Checks max_qty.
//       INSERTs cart_addon_lines with price_brl_cents_snapshot (FORN-08).
//
//   - removeAddonFromCartInTenant(db, tenantId, input)
//       Pure helper: DELETEs a cart_addon_lines row.
//
//   - computeCartTotalInTenant(db, tenantId, reservationId)
//       Pure helper: computes lot price (computeLotPrice) + SUM add-on
//       lines (snapshot price × quantity). Returns breakdown.
//
//   - addAddonToCart (Server Action)
//   - removeAddonFromCart (Server Action)
//
// SNAPSHOT PRICE DECISION (T-02-05-06):
//   cart_addon_lines.price_brl_cents_snapshot is set at add-time and NEVER
//   recalculated. Subsequent changes to event_addons.price_brl_cents do NOT
//   affect in-flight carts. This is the "price freeze" contract.
//
// REFERENCES:
//   - 02-CONTEXT.md D-01 (cart add-ons, max_qty, snapshot price)
//   - 02-PATTERNS.md §Group B cart actions
//   - src/db/schema/cart_addon_lines.ts
//   - src/db/schema/event_addons.ts
//   - src/lib/lots/price.ts (computeLotPrice)

'use server'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { cartAddonLines } from '@/db/schema/cart_addon_lines'
import { eventAddons } from '@/db/schema/event_addons'
import { lotReservations } from '@/db/schema/lot_reservations'
import { lotCategories, lots } from '@/db/schema/lots'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { computeLotPrice } from '@/lib/lots/price'
import { addAddonSchema, removeAddonSchema } from '@/lib/validators/cart'

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (tests drive these inside withTenant)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Add an event add-on to a lot reservation's cart.
 *
 * Guards:
 *   1. Reservation must belong to the current vendor (vendor_id matches session).
 *   2. Reservation must not be expired (expires_at > now()).
 *   3. Reservation must not be released (released_at IS NULL).
 *   4. Add-on must be active.
 *   5. Existing qty + new quantity must not exceed addon.max_qty.
 *
 * @throws if any guard fails.
 */
export async function addAddonToCartInTenant(
  db: TenantDb,
  _tenantId: string,
  input: { reservationId: string; addonId: string; quantity: number; vendorId: string },
): Promise<typeof cartAddonLines.$inferSelect> {
  // 1. Load reservation + validate ownership + TTL.
  const reservationRows = await db
    .select()
    .from(lotReservations)
    .where(
      and(
        eq(lotReservations.id, input.reservationId),
        eq(lotReservations.vendorId, input.vendorId),
        isNull(lotReservations.releasedAt),
      ),
    )
    .limit(1)
  const reservation = reservationRows[0]
  if (!reservation) {
    throw new Error('Reserva não encontrada ou não pertence ao fornecedor')
  }
  if (reservation.expiresAt <= new Date()) {
    throw new Error('Reserva expirada — renove a reserva antes de adicionar itens')
  }

  // 2. Load add-on — must be active and belong to the same event.
  const addonRows = await db
    .select()
    .from(eventAddons)
    .where(
      and(
        eq(eventAddons.id, input.addonId),
        eq(eventAddons.eventId, reservation.eventId),
        eq(eventAddons.active, true),
        isNull(eventAddons.deletedAt),
      ),
    )
    .limit(1)
  const addon = addonRows[0]
  if (!addon) {
    throw new Error('Add-on não encontrado, inativo ou não pertence a este evento')
  }

  // 3. Check existing quantity in the cart for this reservation + addon.
  const existingRows = await db
    .select({ totalQty: sql<number>`COALESCE(SUM(${cartAddonLines.quantity}), 0)` })
    .from(cartAddonLines)
    .where(
      and(
        eq(cartAddonLines.reservationId, input.reservationId),
        eq(cartAddonLines.addonId, input.addonId),
      ),
    )
  const existingQty = Number(existingRows[0]?.totalQty ?? 0)
  if (existingQty + input.quantity > addon.maxQty) {
    throw new Error(
      `Quantidade máxima para este add-on é ${addon.maxQty} (já tem ${existingQty} no carrinho)`,
    )
  }

  // 4. INSERT cart_addon_line with snapshot price.
  const inserted = await db
    .insert(cartAddonLines)
    .values({
      tenantId: reservation.tenantId,
      reservationId: input.reservationId,
      addonId: input.addonId,
      quantity: input.quantity,
      // SNAPSHOT: capture current price at add-time. Future price changes
      // on event_addons do NOT affect this line (T-02-05-06).
      priceBrlCentsSnapshot: addon.priceBrlCents,
    })
    .returning()
  const line = inserted[0]
  if (!line) throw new Error('addAddonToCart: insert returned no row')
  return line
}

/**
 * Remove a specific cart_addon_lines row.
 * Verifies the reservation belongs to the vendor (via reservation join).
 */
export async function removeAddonFromCartInTenant(
  db: TenantDb,
  _tenantId: string,
  input: { reservationId: string; cartAddonLineId: string; vendorId: string },
): Promise<void> {
  // Verify the reservation belongs to the vendor before allowing deletion.
  const reservationRows = await db
    .select({ id: lotReservations.id })
    .from(lotReservations)
    .where(
      and(
        eq(lotReservations.id, input.reservationId),
        eq(lotReservations.vendorId, input.vendorId),
      ),
    )
    .limit(1)
  if (!reservationRows[0]) {
    throw new Error('Reserva não encontrada ou não pertence ao fornecedor')
  }

  // Delete the specific cart line (RLS also enforces tenant isolation).
  await db
    .delete(cartAddonLines)
    .where(
      and(
        eq(cartAddonLines.id, input.cartAddonLineId),
        eq(cartAddonLines.reservationId, input.reservationId),
      ),
    )
}

// ────────────────────────────────────────────────────────────────────────────
// computeCartTotalInTenant
// ────────────────────────────────────────────────────────────────────────────

export interface CartTotal {
  /** Lot base price in centavos (category.base_fixed + area × per_sqm_rate × 100). */
  lot_brl_cents: number
  /** Sum of cart_addon_lines snapshot prices × quantity, in centavos. */
  addons_brl_cents: number
  /** lot_brl_cents + addons_brl_cents. */
  total_brl_cents: number
}

/**
 * Compute the cart total for a lot reservation.
 *
 * Lot price: computed via computeLotPrice (ADR-0003).
 * Add-ons: SUM(price_brl_cents_snapshot × quantity) from cart_addon_lines
 *   (uses snapshot price — price freeze per T-02-05-06).
 */
export async function computeCartTotalInTenant(
  db: TenantDb,
  _tenantId: string,
  reservationId: string,
): Promise<CartTotal> {
  // 1. Load reservation → lot → category for lot price.
  const rows = await db
    .select({
      lot: lots,
      category: lotCategories,
    })
    .from(lotReservations)
    .innerJoin(lots, eq(lots.id, lotReservations.lotId))
    .innerJoin(lotCategories, eq(lotCategories.id, lots.categoryId))
    .where(eq(lotReservations.id, reservationId))
    .limit(1)
  const row = rows[0]
  if (!row) {
    throw new Error('Reserva não encontrada para calcular total do carrinho')
  }

  // computeLotPrice returns BRL (R$) — convert to centavos.
  const lotPriceBrl = computeLotPrice(row.category, row.lot)
  const lotCents = Math.round(lotPriceBrl * 100)

  // 2. SUM add-on snapshot prices.
  const addonSumRows = await db
    .select({
      totalCents: sql<string>`COALESCE(SUM(${cartAddonLines.priceBrlCentsSnapshot} * ${cartAddonLines.quantity}), 0)`,
    })
    .from(cartAddonLines)
    .where(eq(cartAddonLines.reservationId, reservationId))
  const addonCents = Number(addonSumRows[0]?.totalCents ?? 0)

  return {
    lot_brl_cents: lotCents,
    addons_brl_cents: addonCents,
    total_brl_cents: lotCents + addonCents,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions (thin wrappers over the *InTenant helpers)
// ────────────────────────────────────────────────────────────────────────────

export const addAddonToCart = withTenantAction
  .inputSchema(addAddonSchema)
  .action(async ({ ctx, parsedInput }) => {
    const line = await addAddonToCartInTenant(ctx.db, ctx.tenantId, {
      reservationId: parsedInput.reservationId,
      addonId: parsedInput.addonId,
      quantity: parsedInput.quantity,
      vendorId: ctx.userId, // vendor_id is the authenticated user in Phase 2
    })
    revalidatePath('/[slug]/checkout/[cartId]', 'page')
    return line
  })

export const removeAddonFromCart = withTenantAction
  .inputSchema(removeAddonSchema)
  .action(async ({ ctx, parsedInput }) => {
    await removeAddonFromCartInTenant(ctx.db, ctx.tenantId, {
      reservationId: parsedInput.reservationId,
      cartAddonLineId: parsedInput.cartAddonLineId,
      vendorId: ctx.userId,
    })
    revalidatePath('/[slug]/checkout/[cartId]', 'page')
  })
