// FB_EVENTOS — Marketplace event card (Phase 2, Plan 02-02 Task 2).
//
// Per-event card showing name + date range + place + capacity, with a
// "Ver lotes disponíveis" CTA linking to the event detail page. The planta
// page itself (/{slug}/marketplace/{eventId}/planta) lands in Plan 02-03.
//
// Server Component — no client interactivity needed. Date formatting uses
// Intl.DateTimeFormat with pt-BR locale (no extra dependency — date-fns is
// not in the project's lockfile as of Phase 2).
//
// REFERENCES:
//   - 02-02-PLAN.md Task 2 (event-card.tsx provides)
//   - src/lib/actions/marketplace.ts (MarketplaceEvent type)
//   - src/components/ui/card.tsx (shadcn Card primitive)

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MarketplaceEvent } from '@/lib/actions/marketplace'

interface EventCardProps {
  tenantSlug: string
  event: MarketplaceEvent
}

const dayMonthYear = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
})

const dayMonth = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
})

const dayOnly = new Intl.DateTimeFormat('pt-BR', { day: '2-digit' })

function formatRange(starts: Date, ends: Date): string {
  const sameDay =
    starts.getFullYear() === ends.getFullYear() &&
    starts.getMonth() === ends.getMonth() &&
    starts.getDate() === ends.getDate()

  if (sameDay) {
    return dayMonthYear.format(starts)
  }

  const sameMonth =
    starts.getFullYear() === ends.getFullYear() && starts.getMonth() === ends.getMonth()

  if (sameMonth) {
    return `${dayOnly.format(starts)}–${dayMonthYear.format(ends)}`
  }

  return `${dayMonth.format(starts)} – ${dayMonthYear.format(ends)}`
}

export function EventCard({ tenantSlug, event }: EventCardProps) {
  const href = `/${tenantSlug}/marketplace/${event.id}`

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">{event.name}</CardTitle>
        <p className="text-sm text-slate-600">{event.placeName}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <dl className="space-y-1 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-slate-500">Quando:</dt>
            <dd className="font-medium">{formatRange(event.startsAt, event.endsAt)}</dd>
          </div>
          {event.capacity != null && (
            <div className="flex items-baseline gap-2">
              <dt className="text-slate-500">Capacidade:</dt>
              <dd className="font-medium">{event.capacity.toLocaleString('pt-BR')}</dd>
            </div>
          )}
        </dl>

        <Link
          href={href}
          className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Ver lotes disponíveis
        </Link>
      </CardContent>
    </Card>
  )
}
