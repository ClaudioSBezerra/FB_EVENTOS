// FB_EVENTOS — Checkout page (Phase 2, Plan 02-05, Task 3).
//
// URL: /{slug}/checkout/{reservationId}
//
// Pattern S9 (from src/app/[slug]/eventos/page.tsx):
//   1. Session check → redirect to /login.
//   2. Tenant resolution → notFound() if slug unknown.
//   3. Load reservation (via withTenant) → notFound() if not found.
//   4. Load lot + lot category + available add-ons.
//   5. Mount <CheckoutSidebar> Client Component.
//
// The reservation_id is used as the "cartId" — Phase 2 cart is 1:1 with
// reservation. The lot price is computed server-side via computeLotPrice.
//
// FORN-09: Shows PIX tile and Cartão tile; "Pagar" calls startCheckout.
// FORN-08: Pre-loads existing cart_addon_lines so sidebar shows checked state.
//
// REFERENCES:
//   - 02-CONTEXT.md FORN-09 (checkout paths)
//   - src/components/checkout/checkout-sidebar.tsx
//   - src/lib/actions/cart.ts (computeCartTotalInTenant)

import { eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { CheckoutSidebar } from '@/components/checkout/checkout-sidebar'
import { cartAddonLines } from '@/db/schema/cart_addon_lines'
import { eventAddons } from '@/db/schema/event_addons'
import { lotReservations } from '@/db/schema/lot_reservations'
import { lotCategories, lots } from '@/db/schema/lots'
import { withTenant } from '@/db/with-tenant'
import { computeLotPrice } from '@/lib/lots/price'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; cartId: string }>
}

export default async function CheckoutPage({ params }: PageProps) {
  const { slug, cartId: reservationId } = await params

  // 1. Auth check.
  const headersList = await nextHeaders()
  const session = await auth.api.getSession({ headers: headersList })
  if (!session) {
    redirect('/login')
  }

  // 2. Resolve tenant.
  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) notFound()

  // 3. Load reservation + lot + category (all tenant-scoped via RLS).
  const data = await withTenant(tenant.id, async (db) => {
    const reservationRows = await db
      .select()
      .from(lotReservations)
      .where(eq(lotReservations.id, reservationId))
      .limit(1)

    const reservationRow = reservationRows[0]
    if (!reservationRow) return null

    const lotRows = await db.select().from(lots).where(eq(lots.id, reservationRow.lotId)).limit(1)

    const lotRow = lotRows[0]
    if (!lotRow) return null

    const categoryRows = await db
      .select()
      .from(lotCategories)
      .where(eq(lotCategories.id, lotRow.categoryId))
      .limit(1)

    const categoryRow = categoryRows[0]
    if (!categoryRow) return null

    const cartLines = await db
      .select()
      .from(cartAddonLines)
      .where(eq(cartAddonLines.reservationId, reservationId))

    const eventAddonRows = await db
      .select()
      .from(eventAddons)
      .where(eq(eventAddons.eventId, reservationRow.eventId))

    return {
      reservation: reservationRow,
      lot: lotRow,
      category: categoryRow,
      addonLines: cartLines,
      eventAddonsList: eventAddonRows,
    }
  })

  if (!data) notFound()

  const { reservation, lot, category, addonLines, eventAddonsList } = data

  // 4. Compute lot price.
  const lotPriceCents = computeLotPrice(
    { baseFixed: category.baseFixed, perSqmRate: category.perSqmRate },
    { areaM2: lot.areaM2 },
  )

  // 5. Build add-on props for the sidebar.
  const addonLineMap = new Map(addonLines.map((l) => [l.addonId, l]))
  const sidebarAddons = eventAddonsList.map((a) => ({
    id: a.id,
    addonId: a.id,
    name: a.name,
    priceBrlCents: a.priceBrlCents,
    quantity: addonLineMap.get(a.id)?.quantity ?? 1,
    lineId: addonLineMap.get(a.id)?.id,
  }))

  const lotLabel = lot.code ?? `Lote ${lot.id.slice(0, 8)}`
  const expiresAtStr = reservation.expiresAt
    ? new Date(reservation.expiresAt).toLocaleString('pt-BR')
    : 'N/A'

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Finalizar Reserva</h1>
      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        {/* Lot detail summary */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">{lotLabel}</h2>
          <p className="text-sm text-muted-foreground">Reserva expira em: {expiresAtStr}</p>
        </div>

        {/* Checkout sidebar (Client Component) */}
        <CheckoutSidebar
          tenantSlug={slug}
          reservationId={reservationId}
          lotName={lotLabel}
          lotPriceCents={lotPriceCents}
          addons={sidebarAddons}
        />
      </div>
    </main>
  )
}
