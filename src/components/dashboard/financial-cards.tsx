// FB_EVENTOS — Financial summary cards (Phase 1, Plan 01-07 Task 2).
//
// Server Component renders three cards: recebido / a receber / comissão.
// The commission rate is surfaced as a small note so the organizadora
// understands the formula.

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { EventFinancialsResult } from '@/lib/actions/dashboard'
import { formatBRL } from '@/lib/lots/price'

interface FinancialCardsProps {
  data: EventFinancialsResult
}

function formatRatePct(rate: number): string {
  const pct = rate * 100
  // Show 2 dp only when needed (e.g. 8.25%); otherwise compact.
  const text = Number.isInteger(pct) ? pct.toString() : pct.toFixed(2)
  return `${text.replace('.', ',')}%`
}

export function FinancialCards({ data }: FinancialCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="financial-cards">
      <Card data-card="recebido">
        <CardHeader>
          <CardTitle className="text-sm text-slate-600">Recebido</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-emerald-600">{formatBRL(data.recebidoBRL)}</p>
          <p className="mt-1 text-xs text-slate-500">Pagamentos confirmados (status=paid)</p>
        </CardContent>
      </Card>

      <Card data-card="a-receber">
        <CardHeader>
          <CardTitle className="text-sm text-slate-600">A receber</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-amber-600">{formatBRL(data.aReceberBRL)}</p>
          <p className="mt-1 text-xs text-slate-500">Pagamentos pendentes (status=pending)</p>
        </CardContent>
      </Card>

      <Card data-card="comissao">
        <CardHeader>
          <CardTitle className="text-sm text-slate-600">Comissão da plataforma</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-slate-700">{formatBRL(data.comissaoBRL)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatRatePct(data.commissionRate)} de {formatBRL(data.recebidoBRL)}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
