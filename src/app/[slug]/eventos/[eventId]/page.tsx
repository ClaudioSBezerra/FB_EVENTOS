// FB_EVENTOS — Event detail page (Phase 1, Plan 01-02 — Task 1 & 2).
//
// Tenant-scoped detail view at /[slug]/eventos/[eventId]. Shows the event
// metadata + a planta uploader (Task 2). Future plans add the Konva editor
// + lot assignment.

import { headers as nextHeaders } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { PlantaUploader } from '@/components/eventos/planta-uploader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withTenant } from '@/db/with-tenant'
import { getEventByIdInTenant } from '@/lib/actions/eventos'
import { mintPresignedGet } from '@/lib/storage/minio'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; eventId: string }>
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export default async function EventoDetailPage({ params }: PageProps) {
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

  const ev = await withTenant(tenant.id, async (db) => {
    return getEventByIdInTenant(db, eventId)
  })

  if (!ev) {
    notFound()
  }

  // Mint a planta GET URL if uploaded — for the detail page preview.
  let plantaUrl: string | null = null
  if (ev.plantaMinioKey) {
    try {
      const r = await mintPresignedGet(slug, ev.plantaMinioKey, 900)
      plantaUrl = r.url
    } catch {
      plantaUrl = null
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{ev.name}</h1>
          <p className="text-sm text-slate-600">
            {dateFmt.format(ev.startsAt)} → {dateFmt.format(ev.endsAt)}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/${slug}/eventos`}>← Voltar</Link>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Detalhes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>Local:</strong> {ev.placeName}
          </p>
          {ev.placeAddress && (
            <p>
              <strong>Endereço:</strong> {ev.placeAddress}
            </p>
          )}
          {ev.capacity != null && (
            <p>
              <strong>Capacidade:</strong> {ev.capacity.toLocaleString('pt-BR')} pessoas
            </p>
          )}
          <p>
            <strong>Timezone:</strong> {ev.timezone}
          </p>
          <p>
            <strong>Moeda:</strong> {ev.currency}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Planta do evento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {plantaUrl ? (
            <div className="relative h-64 w-full overflow-hidden rounded-md border bg-slate-100">
              <Image
                src={plantaUrl}
                alt={`Planta — ${ev.name}`}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nenhuma planta cadastrada ainda.</p>
          )}
          <PlantaUploader eventId={ev.id} tenantSlug={slug} />
        </CardContent>
      </Card>
    </main>
  )
}
