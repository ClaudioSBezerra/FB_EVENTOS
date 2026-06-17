// FB_EVENTOS — Occupancy dashboard page (Phase 1, Plan 01-07 Task 2).
//
// Tenant-scoped Server Component at /[slug]/eventos/[eventId]/dashboard.
// Fetches occupancy aggregates + lots-for-dashboard inside withTenant(),
// renders the planta in read-only mode (mode='dashboard') side-by-side with
// stats cards.
//
// Access control mirrors the planta editor page: session required,
// activeOrganizationId must match the slug's tenant.

import { and, eq, isNull } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { OccupancyCards } from '@/components/dashboard/occupancy-cards'
import type { DashboardLotMeta } from '@/components/eventos/planta-editor'
import { PlantaEditorClient } from '@/components/eventos/planta-editor-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { lotCategories } from '@/db/schema/lots'
import { withTenant } from '@/db/with-tenant'
import {
  getEventLotsForDashboardInTenant,
  getEventOccupancyInTenant,
} from '@/lib/actions/dashboard'
import { getEventByIdInTenant } from '@/lib/actions/eventos'
import { listEventLotsInTenant } from '@/lib/actions/lots'
import { mintPresignedGet } from '@/lib/storage/minio'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; eventId: string }>
}

export default async function EventoDashboardPage({ params }: PageProps) {
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

  if (session.session.activeOrganizationId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
        </div>
      </main>
    )
  }

  // Load event + occupancy + dashboard lots + categories inside withTenant().
  const { event, occupancy, dashboardLots, lots, categories } = await withTenant(
    tenant.id,
    async (db) => {
      const ev = await getEventByIdInTenant(db, eventId)
      if (!ev) {
        return {
          event: null,
          occupancy: null,
          dashboardLots: [],
          lots: [],
          categories: [] as Array<{ id: string; name: string; color: string | null }>,
        }
      }
      const [occ, dashLots, lotRows, catRows] = await Promise.all([
        getEventOccupancyInTenant(db, { eventId }),
        getEventLotsForDashboardInTenant(db, { eventId }),
        listEventLotsInTenant(db, { eventId }),
        db
          .select({ id: lotCategories.id, name: lotCategories.name, color: lotCategories.color })
          .from(lotCategories)
          .where(and(eq(lotCategories.eventId, eventId), isNull(lotCategories.deletedAt))),
      ])
      return {
        event: ev,
        occupancy: occ,
        dashboardLots: dashLots,
        lots: lotRows,
        categories: catRows,
      }
    },
  )

  if (!event || !occupancy) {
    notFound()
  }

  // Build the {lotId → DashboardLotMeta} map consumed by PlantaEditor's
  // dashboard mode (colors + popover content).
  const dashboardLotsMap: Record<string, DashboardLotMeta> = {}
  for (const dl of dashboardLots) {
    dashboardLotsMap[dl.id] = {
      id: dl.id,
      status: dl.status,
      priceBRL: dl.priceBRL,
      categoryName: dl.categoryName,
      vendorLegalName: dl.vendorLegalName,
      colorFill: dl.colorFill,
      colorStroke: dl.colorStroke,
    }
  }

  // Mint a planta GET URL if uploaded — used as the Konva background.
  let plantaUrl: string | null = null
  if (event.plantaMinioKey) {
    try {
      const r = await mintPresignedGet(slug, event.plantaMinioKey, 900)
      plantaUrl = r.url
    } catch {
      plantaUrl = null
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard de ocupação</h1>
          <p className="text-sm text-slate-600">{event.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/${slug}/eventos/${eventId}`}>Detalhes</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/${slug}/eventos/${eventId}/planta`}>Planta</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/${slug}/eventos/${eventId}/financeiro`}>Financeiro →</Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Planta (lg:col-span-2) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Planta — ocupação por status</CardTitle>
          </CardHeader>
          <CardContent>
            {lots.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                Nenhum lote desenhado neste evento ainda.{' '}
                <Link href={`/${slug}/eventos/${eventId}/planta`} className="font-medium underline">
                  Abrir editor →
                </Link>
              </p>
            ) : (
              <PlantaEditorClient
                eventId={eventId}
                plantaUrl={plantaUrl}
                plantaContentType={event.plantaContentType}
                initialLots={lots}
                categories={categories}
                mode="dashboard"
                dashboardLots={dashboardLotsMap}
              />
            )}
          </CardContent>
        </Card>

        {/* Cards (lg:col-span-1) */}
        <div className="lg:col-span-1">
          <OccupancyCards data={occupancy} />
        </div>
      </div>
    </main>
  )
}
