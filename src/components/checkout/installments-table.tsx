// FB_EVENTOS — InstallmentsTable component (Phase 2, Plan 02-05, Task 3).
//
// Displays 1..12 installment options with:
//   - Installment count (e.g. "3x")
//   - Per-installment value (computeInstallmentAmount — tabela Price, 3.5%/mo)
//   - Total charged (n × installment_amount)
//   - Juros percentage annotation for n > 1
//
// Single-select via radio — chosen installment propagated to parent via onChange.
// Used inside <CheckoutSidebar> when the fornecedor picks "Cartão".
//
// NOTE: Interest amounts displayed are CLIENT-SIDE estimates (tabela Price at
// DEFAULT_MONTHLY_JUROS_RATE). Final amount on Pagar.me may differ slightly
// after probe-verified (AM-06). Shown as "estimativa".

'use client'

import { computeInstallmentAmount } from '@/lib/pagarme/installments-shape.generated'

interface InstallmentsTableProps {
  /** Total amount in centavos (base for installment calculation). */
  totalCents: number
  /** Currently selected number of installments (1–12). */
  selected: number
  /** Called when user picks a different installment count. */
  onChange: (installments: number) => void
  /** Maximum number of installments to display (default 12). */
  maxInstallments?: number
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function InstallmentsTable({
  totalCents,
  selected,
  onChange,
  maxInstallments = 12,
}: InstallmentsTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-medium" />
            <th className="px-3 py-2 text-left font-medium">Parcelas</th>
            <th className="px-3 py-2 text-right font-medium">Valor/parcela</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxInstallments }, (_, i) => i + 1).map((n) => {
            const installmentAmount = computeInstallmentAmount(totalCents, n)
            const total = n * installmentAmount
            const jurosPercent =
              n > 1 ? (((total - totalCents) / totalCents) * 100).toFixed(1) : null

            return (
              <tr
                key={n}
                className={`cursor-pointer border-b last:border-0 hover:bg-muted/30 ${selected === n ? 'bg-primary/5' : ''}`}
                onClick={() => onChange(n)}
              >
                <td className="px-3 py-2">
                  <input
                    type="radio"
                    name="installments"
                    value={n}
                    checked={selected === n}
                    onChange={() => onChange(n)}
                    className="cursor-pointer"
                    aria-label={`${n}x`}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium">{n}x</span>
                  {n === 1 ? (
                    <span className="ml-1 text-xs text-muted-foreground">sem juros</span>
                  ) : (
                    <span className="ml-1 text-xs text-muted-foreground">
                      +{jurosPercent}% (estimativa)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatBrl(installmentAmount)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatBrl(total)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
