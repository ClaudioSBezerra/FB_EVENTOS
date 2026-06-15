// FB_EVENTOS — Vendor list (Server Component) (Phase 1, Plan 01-04 — Task 2).
//
// Pure presentation — the page caller passes the result of
// listVendorsInTenant(db, input). Renders a card-per-vendor grid with a
// status chip and CTAs.

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
import type { PersistedVendor } from '@/lib/actions/fornecedores.shared'
import { formatCNPJ } from '@/lib/validators/cnpj'

export interface VendorListProps {
  tenantSlug: string
  vendors: PersistedVendor[]
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  approved: { label: 'Aprovado', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rejected: { label: 'Rejeitado', color: 'bg-red-100 text-red-800 border-red-200' },
}

export function VendorList({ tenantSlug, vendors }: VendorListProps) {
  if (vendors.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-600">Nenhum fornecedor cadastrado ainda.</p>
        <Link
          href={`/${tenantSlug}/fornecedores/novo`}
          className="mt-3 inline-block text-sm text-blue-600 underline"
        >
          Cadastrar o primeiro fornecedor
        </Link>
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {vendors.map((v) => {
        const status = STATUS_LABEL[v.status] ?? {
          label: v.status,
          color: 'bg-slate-100 text-slate-700 border-slate-200',
        }
        return (
          <li key={v.id}>
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{v.legalName}</CardTitle>
                  <span
                    className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${status.color}`}
                  >
                    {status.label}
                  </span>
                </div>
                <CardDescription>
                  {v.tradeName ?? 'Sem nome fantasia'} — {formatCNPJ(v.cnpj)}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-slate-700">
                <p>
                  <strong>Email:</strong> {v.email}
                </p>
                {v.phone && (
                  <p>
                    <strong>Telefone:</strong> {v.phone}
                  </p>
                )}
                {!v.cnpjVerified && (
                  <p className="mt-1 text-xs text-amber-700">
                    ⚠ CNPJ não verificado contra Receita
                  </p>
                )}
              </CardContent>
              <CardFooter className="justify-end">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/${tenantSlug}/fornecedores/${v.id}`}>Abrir</Link>
                </Button>
              </CardFooter>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
