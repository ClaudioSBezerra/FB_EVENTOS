// FB_EVENTOS — Events list page (Phase 1, Plan 01-02 — Task 1).
//
// Tenant-scoped list view at /[slug]/eventos. Follows the Phase 0 dashboard
// pattern:
//   1. Session check → redirect to /login if missing.
//   2. Tenant resolution by slug → 404 if missing.
//   3. activeOrganizationId === tenant.id check → 403 otherwise.
//   4. Data fetch inside withTenant(tenant.id, ...) — the RLS boundary.

import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { EventList } from '@/components/eventos/event-list'
import { Button } from '@/components/ui/button'
import { withTenant } from '@/db/with-tenant'
import { listEventsInTenant } from '@/lib/actions/eventos'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function EventosListPage({ params }: PageProps) {
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

  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
          <p className="mt-2 text-sm text-red-600">
            Você não tem acesso à organização <strong>{tenant.name}</strong>.
          </p>
        </div>
      </main>
    )
  }

  const items = await withTenant(tenant.id, async (db) => {
    return listEventsInTenant(db, tenant.id)
  })

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Eventos</h1>
          <p className="text-sm text-slate-600">
            {tenant.name} — gerencie eventos da organizadora.
          </p>
        </div>
        <Button asChild>
          <Link href={`/${slug}/eventos/novo`}>Novo evento</Link>
        </Button>
      </header>

      <EventList tenantSlug={slug} events={items} />
    </main>
  )
}
