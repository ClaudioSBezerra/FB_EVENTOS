// FB_EVENTOS — New event page (Phase 1, Plan 01-02 — Task 1).
//
// Tenant-scoped form at /[slug]/eventos/novo. The form (EventForm) is a
// Client Component that calls the createEvent Server Action — but we still
// run the page guard (session + tenant + active-org check) at the Server
// Component layer so unauthorized users never see the form shell.

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { EventForm } from '@/components/eventos/event-form'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function NovoEventoPage({ params }: PageProps) {
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

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Novo evento</h1>
        <p className="text-sm text-slate-600">
          Cadastre os dados básicos do evento. Você poderá fazer upload da planta e desenhar os
          lotes nas próximas telas.
        </p>
      </header>
      <EventForm tenantSlug={slug} />
    </main>
  )
}
