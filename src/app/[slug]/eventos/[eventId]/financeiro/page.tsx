// FB_EVENTOS — Financial dashboard page (Phase 1, Plan 01-07 Task 2).
//
// Tenant-scoped Server Component at /[slug]/eventos/[eventId]/financeiro.
// Fetches financial aggregates inside withTenant() and renders the three
// cards (recebido / a receber / comissão) + by-vendor table.

import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { FinancialByVendorTable } from '@/components/dashboard/financial-by-vendor-table'
import { FinancialCards } from '@/components/dashboard/financial-cards'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withTenant } from '@/db/with-tenant'
import { getEventFinancialsInTenant } from '@/lib/actions/dashboard'
import { getEventByIdInTenant } from '@/lib/actions/eventos'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; eventId: string }>
}

export default async function EventoFinanceiroPage({ params }: PageProps) {
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

  const { event, financials } = await withTenant(tenant.id, async (db) => {
    const ev = await getEventByIdInTenant(db, eventId)
    if (!ev) return { event: null, financials: null }
    const fin = await getEventFinancialsInTenant(db, tenant.id, { eventId })
    return { event: ev, financials: fin }
  })

  if (!event || !financials) {
    notFound()
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Financeiro</h1>
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
            <Link href={`/${slug}/eventos/${eventId}/dashboard`}>← Dashboard</Link>
          </Button>
        </div>
      </header>

      <FinancialCards data={financials} />

      <Card>
        <CardHeader>
          <CardTitle>Por fornecedor</CardTitle>
        </CardHeader>
        <CardContent>
          <FinancialByVendorTable rows={financials.byVendor} />
        </CardContent>
      </Card>
    </main>
  )
}
