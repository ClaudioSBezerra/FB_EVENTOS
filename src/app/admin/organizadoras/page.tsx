// FB_EVENTOS — Admin organizadoras list (2026-06-17 admin-first rework).

import { ArrowUpRight, Plus } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { adminListOrganizations } from '@/lib/admin/queries'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export default async function OrganizadorasListPage() {
  const orgs = await adminListOrganizations()

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Organizadoras</h1>
          <p className="text-sm text-slate-600">
            {orgs.length}{' '}
            {orgs.length === 1 ? 'organizadora cadastrada' : 'organizadoras cadastradas'}.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/organizadoras/nova">
            <Plus className="mr-1 h-4 w-4" /> Nova organizadora
          </Link>
        </Button>
      </header>

      {orgs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">
          Nenhuma organizadora cadastrada ainda.{' '}
          <Link href="/admin/organizadoras/nova" className="font-medium text-emerald-700 underline">
            Criar a primeira →
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2 text-right">Membros</th>
                <th className="px-4 py-2 text-right">Eventos</th>
                <th className="px-4 py-2">Criada em</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgs.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{o.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">/{o.slug}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.countMembers}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.countEvents}</td>
                  <td className="px-4 py-3 text-slate-600">{dateFmt.format(o.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/organizadoras/${o.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                    >
                      Editar <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
