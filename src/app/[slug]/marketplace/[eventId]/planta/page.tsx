// FB_EVENTOS — Marketplace planta page for fornecedores (Phase 2, Plan 02-03).
//
// Route: /[slug]/marketplace/[eventId]/planta
// Mode:  Buyer-mode PlantaEditor — fornecedor clicks an available lot to
//        trigger the checkout flow (CheckoutSidebar — implemented in Plan 02-05).
//
// Access control (Pattern S9 boilerplate):
//   session required → tenant check → cross-tenant guard → withTenant → render
//
// Data loading:
//   - Open event via getOpenEventByIdInTenant (published events only — RLS)
//   - Lot statuses via getEventLotsForDashboardInTenant (same as dashboard)
//   - Planta image URL via mintPresignedGet (same as editor page)
//
// The CheckoutSidebar is a stub in this plan; Plan 02-05 fills in the
// Pagar.me integration. The buyer holds `selectedLotId` in a Client Component
// that wraps the PlantaEditor.
//
// REFERENCES:
//   - 02-03-PLAN.md Task 2 <action>
//   - src/app/[slug]/eventos/[eventId]/planta/page.tsx (analog)
//   - src/lib/actions/marketplace.ts (getOpenEventByIdInTenant)
//   - src/lib/actions/dashboard.ts (getEventLotsForDashboardInTenant)

import { and, eq, isNull } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { lotCategories } from '@/db/schema/lots'
import { withTenant } from '@/db/with-tenant'
import { getEventLotsForDashboardInTenant } from '@/lib/actions/dashboard'
import { getOpenEventByIdInTenant } from '@/lib/actions/marketplace'
import { resolveTenantBySlug } from '@/lib/tenant'

import { PlantaBuyerClient } from './planta-buyer-client'

interface PageProps {
  params: Promise<{ slug: string; eventId: string }>
}

export default async function MarketplacePlantaPage({ params }: PageProps) {
  const { slug, eventId } = await params
  const h = await nextHeaders()

  const session = await auth.api.getSession({ headers: h })
  if (!session) {
    redirect('/login')
  }

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) {
    notFound()
  }

  // Cross-tenant guard — Pattern S9
  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
          <p className="mt-2 text-sm text-red-600">
            Você não tem acesso a este evento de <strong>{tenant.name}</strong>.
          </p>
        </div>
      </main>
    )
  }

  const { event, lots, lotStatusMap, categories } = await withTenant(tenant.id, async (db) => {
    const ev = await getOpenEventByIdInTenant(db, tenant.id, eventId)
    if (!ev) {
      return {
        event: null,
        lots: [],
        lotStatusMap: {},
        categories: [] as Array<{ id: string; name: string; color: string | null }>,
      }
    }

    const lotItems = await getEventLotsForDashboardInTenant(db, { eventId })

    // Build dashboardLots map keyed by lot.id for PlantaEditor
    const lotStatusMap: Record<
      string,
      {
        id: string
        status: string
        priceBRL: number
        categoryName: string
        vendorLegalName: string | null
        colorFill: string
        colorStroke: string
      }
    > = {}
    for (const item of lotItems) {
      lotStatusMap[item.id] = {
        id: item.id,
        status: item.status,
        priceBRL: item.priceBRL,
        categoryName: item.categoryName,
        vendorLegalName: item.vendorLegalName,
        colorFill: item.colorFill,
        colorStroke: item.colorStroke,
      }
    }

    // Categories for PlantaEditor initialLots geometry rendering
    const catRows = await db
      .select({ id: lotCategories.id, name: lotCategories.name, color: lotCategories.color })
      .from(lotCategories)
      .where(and(eq(lotCategories.eventId, eventId), isNull(lotCategories.deletedAt)))

    return { event: ev, lots: lotItems, lotStatusMap, categories: catRows }
  })

  if (!event) {
    notFound()
  }

  // Planta background image: MarketplaceEvent doesn't expose plantaMinioKey.
  // The PlantaEditor renders without a background image (lots still visible).
  // TODO(Plan 02-05): extend MarketplaceEvent to expose plantaMinioKey if needed.
  const plantaUrl: string | null = null

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Planta do evento</h1>
          <p className="text-sm text-slate-600">{event.name}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/${slug}/marketplace/${eventId}`}>← Voltar ao evento</Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Selecione um lote disponível</CardTitle>
        </CardHeader>
        <CardContent>
          <PlantaBuyerClient
            eventId={eventId}
            slug={slug}
            plantaUrl={plantaUrl}
            lots={lots}
            lotStatusMap={lotStatusMap}
            categories={categories}
          />
        </CardContent>
      </Card>
    </main>
  )
}
