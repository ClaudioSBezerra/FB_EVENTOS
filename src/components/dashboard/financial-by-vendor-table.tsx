// FB_EVENTOS — Financial by-vendor table (Phase 1, Plan 01-07 Task 2).
//
// Server Component renders a plain semantic <table> with per-fornecedor
// totals sorted by `totalPaidBRL` desc (sorting done in the Server Action
// helper; the component is presentational).
//
// We deliberately do NOT install shadcn `table` here — the project's UI
// surface so far inlines its primitives with Tailwind utility classes
// rather than reaching for new Radix packages on every new card. The
// markup is fully accessible (semantic <table>/<thead>/<tbody>) and
// keyboard-navigable by default.

import type { ByVendorRow } from '@/lib/actions/dashboard'
import { formatBRL } from '@/lib/lots/price'

interface FinancialByVendorTableProps {
  rows: ByVendorRow[]
}

export function FinancialByVendorTable({ rows }: FinancialByVendorTableProps) {
  if (rows.length === 0) {
    return (
      <p
        className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"
        data-testid="financial-by-vendor-empty"
      >
        Nenhum fornecedor com pagamentos neste evento ainda.
      </p>
    )
  }
  return (
    <div
      className="overflow-x-auto rounded-md border border-slate-200"
      data-testid="financial-by-vendor"
    >
      <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">
              Fornecedor
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
              Recebido
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
              Pendente
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium text-slate-600">
              Comissão
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.vendorId} data-vendor-id={r.vendorId}>
              <td className="px-4 py-2 text-slate-900">{r.vendorLegalName}</td>
              <td className="px-4 py-2 text-right font-medium text-emerald-600">
                {formatBRL(r.totalPaidBRL)}
              </td>
              <td className="px-4 py-2 text-right text-amber-600">
                {formatBRL(r.totalPendingBRL)}
              </td>
              <td className="px-4 py-2 text-right text-slate-700">{formatBRL(r.comissaoBRL)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
