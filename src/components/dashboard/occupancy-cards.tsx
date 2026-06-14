// FB_EVENTOS — Occupancy cards (Phase 1, Plan 01-07 Task 2).
//
// Server Component receives an EventOccupancyResult and renders four shadcn
// Cards in a 2x2 grid (lotes vendidos / m² vendida / receita / total de lotes).
//
// REFERENCES:
//   - src/lib/actions/dashboard.ts (EventOccupancyResult shape)
//   - 01-CONTEXT.md D-12 (mapa + cards lado-a-lado)

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { EventOccupancyResult } from '@/lib/actions/dashboard'
import { formatBRL } from '@/lib/lots/price'

interface OccupancyCardsProps {
  data: EventOccupancyResult
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1).replace('.', ',')}%`
}

function formatInt(n: number): string {
  return n.toLocaleString('pt-BR')
}

function formatM2(m2: number): string {
  return `${formatInt(Math.round(m2))} m²`
}

export function OccupancyCards({ data }: OccupancyCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="occupancy-cards">
      <Card data-card="lots-sold">
        <CardHeader>
          <CardTitle className="text-sm text-slate-600">Lotes vendidos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-red-600">
            {formatInt(data.byStatus.sold)}{' '}
            <span className="text-base font-normal text-slate-500">
              de {formatInt(data.totalLots)}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{formatPct(data.percentLotsSold)} do total</p>
        </CardContent>
      </Card>

      <Card data-card="m2-sold">
        <CardHeader>
          <CardTitle className="text-sm text-slate-600">Área vendida</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-red-600">
            {formatM2(data.soldAreaM2)}{' '}
            <span className="text-base font-normal text-slate-500">
              de {formatM2(data.totalAreaM2)}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{formatPct(data.percentM2Sold)} do total</p>
        </CardContent>
      </Card>

      <Card data-card="revenue-sold">
        <CardHeader>
          <CardTitle className="text-sm text-slate-600">Receita vendida</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-emerald-600">
            {formatBRL(data.soldRevenueBRL)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            de {formatBRL(data.totalRevenueBRL)} — {formatPct(data.percentRevenueSold)}
          </p>
        </CardContent>
      </Card>

      <Card data-card="status-breakdown">
        <CardHeader>
          <CardTitle className="text-sm text-slate-600">Distribuição por status</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                Disponível
              </span>
              <span className="font-medium">{formatInt(data.byStatus.available)}</span>
            </li>
            <li className="flex justify-between">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
                Reservado
              </span>
              <span className="font-medium">{formatInt(data.byStatus.reserved)}</span>
            </li>
            <li className="flex justify-between">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />
                Vendido
              </span>
              <span className="font-medium">{formatInt(data.byStatus.sold)}</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
