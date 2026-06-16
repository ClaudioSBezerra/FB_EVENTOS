"use strict";
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
'use server';
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeAddonFromCart = exports.addAddonToCart = void 0;
exports.addAddonToCartInTenant = addAddonToCartInTenant;
exports.removeAddonFromCartInTenant = removeAddonFromCartInTenant;
exports.computeCartTotalInTenant = computeCartTotalInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const cart_addon_lines_1 = require("@/db/schema/cart_addon_lines");
const event_addons_1 = require("@/db/schema/event_addons");
const lot_reservations_1 = require("@/db/schema/lot_reservations");
const lots_1 = require("@/db/schema/lots");
const safe_action_1 = require("@/lib/actions/safe-action");
const price_1 = require("@/lib/lots/price");
const cart_1 = require("@/lib/validators/cart");
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
async function addAddonToCartInTenant(db, _tenantId, input) {
    // 1. Load reservation + validate ownership + TTL.
    const reservationRows = await db
        .select()
        .from(lot_reservations_1.lotReservations)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.id, input.reservationId), (0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.vendorId, input.vendorId), (0, drizzle_orm_1.isNull)(lot_reservations_1.lotReservations.releasedAt)))
        .limit(1);
    const reservation = reservationRows[0];
    if (!reservation) {
        throw new Error('Reserva não encontrada ou não pertence ao fornecedor');
    }
    if (reservation.expiresAt <= new Date()) {
        throw new Error('Reserva expirada — renove a reserva antes de adicionar itens');
    }
    // 2. Load add-on — must be active and belong to the same event.
    const addonRows = await db
        .select()
        .from(event_addons_1.eventAddons)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(event_addons_1.eventAddons.id, input.addonId), (0, drizzle_orm_1.eq)(event_addons_1.eventAddons.eventId, reservation.eventId), (0, drizzle_orm_1.eq)(event_addons_1.eventAddons.active, true), (0, drizzle_orm_1.isNull)(event_addons_1.eventAddons.deletedAt)))
        .limit(1);
    const addon = addonRows[0];
    if (!addon) {
        throw new Error('Add-on não encontrado, inativo ou não pertence a este evento');
    }
    // 3. Check existing quantity in the cart for this reservation + addon.
    const existingRows = await db
        .select({ totalQty: (0, drizzle_orm_1.sql) `COALESCE(SUM(${cart_addon_lines_1.cartAddonLines.quantity}), 0)` })
        .from(cart_addon_lines_1.cartAddonLines)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(cart_addon_lines_1.cartAddonLines.reservationId, input.reservationId), (0, drizzle_orm_1.eq)(cart_addon_lines_1.cartAddonLines.addonId, input.addonId)));
    const existingQty = Number(existingRows[0]?.totalQty ?? 0);
    if (existingQty + input.quantity > addon.maxQty) {
        throw new Error(`Quantidade máxima para este add-on é ${addon.maxQty} (já tem ${existingQty} no carrinho)`);
    }
    // 4. INSERT cart_addon_line with snapshot price.
    const inserted = await db
        .insert(cart_addon_lines_1.cartAddonLines)
        .values({
        tenantId: reservation.tenantId,
        reservationId: input.reservationId,
        addonId: input.addonId,
        quantity: input.quantity,
        // SNAPSHOT: capture current price at add-time. Future price changes
        // on event_addons do NOT affect this line (T-02-05-06).
        priceBrlCentsSnapshot: addon.priceBrlCents,
    })
        .returning();
    const line = inserted[0];
    if (!line)
        throw new Error('addAddonToCart: insert returned no row');
    return line;
}
/**
 * Remove a specific cart_addon_lines row.
 * Verifies the reservation belongs to the vendor (via reservation join).
 */
async function removeAddonFromCartInTenant(db, _tenantId, input) {
    // Verify the reservation belongs to the vendor before allowing deletion.
    const reservationRows = await db
        .select({ id: lot_reservations_1.lotReservations.id })
        .from(lot_reservations_1.lotReservations)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.id, input.reservationId), (0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.vendorId, input.vendorId)))
        .limit(1);
    if (!reservationRows[0]) {
        throw new Error('Reserva não encontrada ou não pertence ao fornecedor');
    }
    // Delete the specific cart line (RLS also enforces tenant isolation).
    await db
        .delete(cart_addon_lines_1.cartAddonLines)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(cart_addon_lines_1.cartAddonLines.id, input.cartAddonLineId), (0, drizzle_orm_1.eq)(cart_addon_lines_1.cartAddonLines.reservationId, input.reservationId)));
}
/**
 * Compute the cart total for a lot reservation.
 *
 * Lot price: computed via computeLotPrice (ADR-0003).
 * Add-ons: SUM(price_brl_cents_snapshot × quantity) from cart_addon_lines
 *   (uses snapshot price — price freeze per T-02-05-06).
 */
async function computeCartTotalInTenant(db, _tenantId, reservationId) {
    // 1. Load reservation → lot → category for lot price.
    const rows = await db
        .select({
        lot: lots_1.lots,
        category: lots_1.lotCategories,
    })
        .from(lot_reservations_1.lotReservations)
        .innerJoin(lots_1.lots, (0, drizzle_orm_1.eq)(lots_1.lots.id, lot_reservations_1.lotReservations.lotId))
        .innerJoin(lots_1.lotCategories, (0, drizzle_orm_1.eq)(lots_1.lotCategories.id, lots_1.lots.categoryId))
        .where((0, drizzle_orm_1.eq)(lot_reservations_1.lotReservations.id, reservationId))
        .limit(1);
    const row = rows[0];
    if (!row) {
        throw new Error('Reserva não encontrada para calcular total do carrinho');
    }
    // computeLotPrice returns BRL (R$) — convert to centavos.
    const lotPriceBrl = (0, price_1.computeLotPrice)(row.category, row.lot);
    const lotCents = Math.round(lotPriceBrl * 100);
    // 2. SUM add-on snapshot prices.
    const addonSumRows = await db
        .select({
        totalCents: (0, drizzle_orm_1.sql) `COALESCE(SUM(${cart_addon_lines_1.cartAddonLines.priceBrlCentsSnapshot} * ${cart_addon_lines_1.cartAddonLines.quantity}), 0)`,
    })
        .from(cart_addon_lines_1.cartAddonLines)
        .where((0, drizzle_orm_1.eq)(cart_addon_lines_1.cartAddonLines.reservationId, reservationId));
    const addonCents = Number(addonSumRows[0]?.totalCents ?? 0);
    return {
        lot_brl_cents: lotCents,
        addons_brl_cents: addonCents,
        total_brl_cents: lotCents + addonCents,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (thin wrappers over the *InTenant helpers)
// ────────────────────────────────────────────────────────────────────────────
exports.addAddonToCart = safe_action_1.withTenantAction
    .inputSchema(cart_1.addAddonSchema)
    .action(async ({ ctx, parsedInput }) => {
    const line = await addAddonToCartInTenant(ctx.db, ctx.tenantId, {
        reservationId: parsedInput.reservationId,
        addonId: parsedInput.addonId,
        quantity: parsedInput.quantity,
        vendorId: ctx.userId, // vendor_id is the authenticated user in Phase 2
    });
    (0, cache_1.revalidatePath)('/[slug]/checkout/[cartId]', 'page');
    return line;
});
exports.removeAddonFromCart = safe_action_1.withTenantAction
    .inputSchema(cart_1.removeAddonSchema)
    .action(async ({ ctx, parsedInput }) => {
    await removeAddonFromCartInTenant(ctx.db, ctx.tenantId, {
        reservationId: parsedInput.reservationId,
        cartAddonLineId: parsedInput.cartAddonLineId,
        vendorId: ctx.userId,
    });
    (0, cache_1.revalidatePath)('/[slug]/checkout/[cartId]', 'page');
});
