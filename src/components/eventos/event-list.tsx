// FB_EVENTOS — Event list view (Phase 1, Plan 01-02 — Task 1).
//
// Server Component. The PAGE caller passes the result of
// `listEventsInTenant(db, tenantId)` (inside withTenant) so this component
// stays pure presentation — no DB access here. That keeps the RLS contract
// at the page level where the tenant context is established.

import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { EventListItem } from '@/lib/actions/eventos'

interface EventListProps {
  tenantSlug: string
  events: EventListItem[]
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function EventList({ tenantSlug, events }: EventListProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-600">Nenhum evento cadastrado ainda.</p>
        <Link
          href={`/${tenantSlug}/eventos/novo`}
          className="mt-3 inline-block text-sm text-blue-600 underline"
        >
          Criar o primeiro evento
        </Link>
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((ev) => (
        <li key={ev.id}>
          <Card className="h-full overflow-hidden">
            {ev.plantaUrl ? (
              <div className="relative h-32 w-full bg-slate-100">
                {/* Next/Image with `unoptimized` because MinIO pre-signed
                    URLs have query-string signatures that the Next image
                    loader doesn't whitelist by default. */}
                <Image
                  src={ev.plantaUrl}
                  alt={`Planta — ${ev.name}`}
                  fill
                  unoptimized
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="flex h-32 w-full items-center justify-center bg-slate-100 text-xs text-slate-500">
                Sem planta cadastrada
              </div>
            )}
            <CardHeader>
              <CardTitle className="text-base">{ev.name}</CardTitle>
              <CardDescription>
                {dateFmt.format(ev.startsAt)} → {dateFmt.format(ev.endsAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-700">
              <p>
                <strong>Local:</strong> {ev.placeName}
              </p>
              {ev.capacity != null && (
                <p>
                  <strong>Capacidade:</strong> {ev.capacity.toLocaleString('pt-BR')} pessoas
                </p>
              )}
            </CardContent>
            <CardFooter className="justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${tenantSlug}/eventos/${ev.id}`}>Abrir</Link>
              </Button>
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
  )
}
