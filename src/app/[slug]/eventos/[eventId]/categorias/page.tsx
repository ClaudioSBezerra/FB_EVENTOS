// FB_EVENTOS — Lot categories page (Phase 1, Plan 01-03 — Task 3).
//
// Tenant-scoped page at /[slug]/eventos/[eventId]/categorias. Server
// Component that loads the event + existing categories inside withTenant,
// renders the create form + a list with current pricing.

import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { LotCategoryForm } from '@/components/eventos/lot-category-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withTenant } from '@/db/with-tenant'
import { getEventByIdInTenant } from '@/lib/actions/eventos'
import { listEventCategoriesInTenant } from '@/lib/actions/lot-categories'
import { formatBRL } from '@/lib/lots/price'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; eventId: string }>
}

export default async function CategoriasPage({ params }: PageProps) {
  const { slug, eventId } = await params
  const h = await nextHeaders()

  const session = await auth.api.getSession({ headers: h })
  if (!session) redirect('/login')

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) notFound()

  if (session.session.activeOrganizationId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
        </div>
      </main>
    )
  }

  const { event, categories } = await withTenant(tenant.id, async (db) => {
    const ev = await getEventByIdInTenant(db, eventId)
    if (!ev) return { event: null, categories: [] }
    const cats = await listEventCategoriesInTenant(db, { eventId })
    return { event: ev, categories: cats }
  })

  if (!event) notFound()

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Categorias de lote</h1>
          <p className="text-sm text-slate-600">{event.name}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/${slug}/eventos/${eventId}`}>← Voltar para o evento</Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Nova categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <LotCategoryForm eventId={eventId} tenantSlug={slug} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categorias cadastradas</CardTitle>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma categoria cadastrada ainda.</p>
          ) : (
            <ul className="divide-y">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-block h-6 w-6 rounded border"
                      style={{ backgroundColor: c.color ?? '#22c55e' }}
                      aria-hidden
                    />
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-slate-500">
                        Fixo: {formatBRL(c.baseFixed)} · Por m²: {formatBRL(c.perSqmRate)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
