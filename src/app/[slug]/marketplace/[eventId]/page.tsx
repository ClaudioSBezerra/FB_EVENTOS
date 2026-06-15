// FB_EVENTOS — Marketplace event detail page (Phase 2, Plan 02-02 Task 2).
//
// Renders one published event for the fornecedor marketplace.
// The "Ver planta" CTA links to /{slug}/marketplace/{eventId}/planta —
// that route is wired in Plan 02-03. Until then, the link may 404; this is
// expected and documented in 02-02-PLAN.md.
//
// Pattern S9 boilerplate (same as marketplace/page.tsx):
//   session check → tenant check → cross-tenant guard → withTenant → render
//
// REFERENCES:
//   - 02-CONTEXT.md FORN-02
//   - 02-02-PLAN.md Task 2
//   - src/lib/actions/marketplace.ts (getOpenEventByIdInTenant)

import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { Button } from '@/components/ui/button'
import { withTenant } from '@/db/with-tenant'
import { getOpenEventByIdInTenant } from '@/lib/actions/marketplace'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; eventId: string }>
}

export default async function MarketplaceEventDetailPage({ params }: PageProps) {
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

  const event = await withTenant(tenant.id, async (db) => {
    return getOpenEventByIdInTenant(db, tenant.id, eventId)
  })

  if (!event) {
    notFound()
  }

  const startDate = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: event.timezone,
  }).format(event.startsAt)

  const endDate = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: event.timezone,
  }).format(event.endsAt)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <nav className="text-sm text-slate-500">
        <Link href={`/${slug}/marketplace`} className="underline hover:text-slate-700">
          Marketplace
        </Link>{' '}
        / {event.name}
      </nav>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Início</dt>
            <dd className="text-slate-900">{startDate}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Término</dt>
            <dd className="text-slate-900">{endDate}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Local</dt>
            <dd className="text-slate-900">{event.placeName}</dd>
          </div>
          {event.capacity !== null && (
            <div>
              <dt className="font-medium text-slate-500">Capacidade</dt>
              <dd className="text-slate-900">{event.capacity.toLocaleString('pt-BR')} pessoas</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex gap-3">
        {/* "Ver planta" — wired in Plan 02-03; may 404 until then */}
        <Button asChild>
          <Link href={`/${slug}/marketplace/${eventId}/planta`}>Ver planta do evento</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/${slug}/marketplace`}>Voltar ao marketplace</Link>
        </Button>
      </div>
    </main>
  )
}
