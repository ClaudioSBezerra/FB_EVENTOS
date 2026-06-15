// FB_EVENTOS — Marketplace event listing page (Phase 2, Plan 02-02 Task 2).
//
// Pattern S9 boilerplate (from src/app/[slug]/eventos/page.tsx):
//   1. Session check → redirect to /login.
//   2. Tenant resolution → notFound() if slug unknown.
//   3. activeOrganizationId === tenant.id → 403 if cross-tenant.
//   4. withTenant(tenant.id) → listOpenEventsInTenant (published only).
//
// Renders EventCard grid for the tenant's published events.
//
// REFERENCES:
//   - 02-CONTEXT.md FORN-02, T-02-02-03
//   - 02-02-PLAN.md Task 2
//   - src/app/[slug]/eventos/page.tsx (Pattern S9 boilerplate — analog)
//   - src/lib/actions/marketplace.ts (listOpenEventsInTenant)

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { EventCard } from '@/components/marketplace/event-card'
import { withTenant } from '@/db/with-tenant'
import { listOpenEventsInTenant } from '@/lib/actions/marketplace'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function MarketplacePage({ params }: PageProps) {
  const { slug } = await params
  const h = await nextHeaders()

  const session = await auth.api.getSession({ headers: h })
  if (!session) {
    redirect('/login')
  }

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) {
    notFound()
  }

  // T-02-02-03 mitigation: cross-tenant guard — Pattern S9
  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
          <p className="mt-2 text-sm text-red-600">
            Você não tem acesso ao marketplace de <strong>{tenant.name}</strong>.
          </p>
        </div>
      </main>
    )
  }

  const events = await withTenant(tenant.id, async (db) => {
    return listOpenEventsInTenant(db, tenant.id)
  })

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Marketplace</h1>
        <p className="text-sm text-slate-600">
          {tenant.name} — eventos disponíveis para fornecedores.
        </p>
      </header>

      {events.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
          Nenhum evento publicado no momento.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <EventCard key={event.id} tenantSlug={slug} event={event} />
          ))}
        </div>
      )}
    </main>
  )
}
