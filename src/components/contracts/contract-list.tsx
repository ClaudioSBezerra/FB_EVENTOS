// FB_EVENTOS — Contract list table (Phase 1, Plan 01-05 Task 2).

import Link from 'next/link'

interface ContractListItem {
  id: string
  status: string
  templateVersion: string
  createdAt: Date
}

interface ContractListProps {
  contracts: ContractListItem[]
  tenantSlug: string
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function statusColor(status: string): string {
  switch (status) {
    case 'signed':
      return 'bg-green-100 text-green-800'
    case 'cancelled':
    case 'expired':
      return 'bg-red-100 text-red-800'
    case 'awaiting_org':
    case 'awaiting_fornecedor':
      return 'bg-yellow-100 text-yellow-800'
    default:
      return 'bg-slate-100 text-slate-800'
  }
}

export function ContractList({ contracts, tenantSlug }: ContractListProps) {
  if (contracts.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum contrato emitido ainda.</p>
  }
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">Contrato</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Template</th>
            <th className="px-3 py-2 text-left">Criado em</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">{c.id.slice(0, 8).toUpperCase()}</td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs ${statusColor(c.status)}`}
                >
                  {c.status}
                </span>
              </td>
              <td className="px-3 py-2 text-xs">{c.templateVersion}</td>
              <td className="px-3 py-2 text-xs">{dateFmt.format(c.createdAt)}</td>
              <td className="px-3 py-2 text-right">
                <Link
                  href={`/${tenantSlug}/contratos/${c.id}`}
                  className="text-blue-600 hover:underline"
                >
                  Detalhes →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
