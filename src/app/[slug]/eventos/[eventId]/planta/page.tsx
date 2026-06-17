// FB_EVENTOS — Planta editor page (Phase 1, Plan 01-03 — Task 2).
//
// Tenant-scoped page at /[slug]/eventos/[eventId]/planta. Server Component
// that loads the event + lots + lot_categories inside withTenant(), then
// passes the snapshot to <PlantaEditor> (client component).
//
// Access control mirrors the event detail page (01-02): session required,
// activeOrganizationId must match the slug's tenant.

import { and, eq, isNull } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { PlantaEditorClient } from '@/components/eventos/planta-editor-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { lotCategories } from '@/db/schema/lots'
import { withTenant } from '@/db/with-tenant'
import { getEventByIdInTenant } from '@/lib/actions/eventos'
import { listEventLotsInTenant } from '@/lib/actions/lots'
import { mintPresignedGet } from '@/lib/storage/minio'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; eventId: string }>
}

export default async function PlantaEditorPage({ params }: PageProps) {
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

  // Load event + lots + categories inside withTenant (RLS-scoped).
  const { event, lots, categories } = await withTenant(tenant.id, async (db) => {
    const ev = await getEventByIdInTenant(db, eventId)
    if (!ev)
      return {
        event: null,
        lots: [],
        categories: [] as Array<{ id: string; name: string; color: string | null }>,
      }
    const lotRows = await listEventLotsInTenant(db, { eventId })
    const catRows = await db
      .select({ id: lotCategories.id, name: lotCategories.name, color: lotCategories.color })
      .from(lotCategories)
      .where(and(eq(lotCategories.eventId, eventId), isNull(lotCategories.deletedAt)))
    return { event: ev, lots: lotRows, categories: catRows }
  })

  if (!event) {
    notFound()
  }

  // Mint a planta GET URL if uploaded — passed as background to the editor.
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
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Editor da planta</h1>
          <p className="text-sm text-slate-600">{event.name}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/${slug}/eventos/${eventId}`}>← Voltar para o evento</Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Lotes</CardTitle>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-medium text-amber-800">Nenhuma categoria de lote cadastrada.</p>
              <p className="text-amber-700">
                Você precisa criar pelo menos uma categoria antes de desenhar lotes.{' '}
                <Link
                  href={`/${slug}/eventos/${eventId}/categorias`}
                  className="font-medium underline"
                >
                  Cadastrar categorias →
                </Link>
              </p>
            </div>
          ) : (
            <PlantaEditorClient
              eventId={eventId}
              plantaUrl={plantaUrl}
              plantaContentType={event.plantaContentType}
              initialLots={lots}
              categories={categories}
            />
          )}
        </CardContent>
      </Card>
    </main>
  )
}
