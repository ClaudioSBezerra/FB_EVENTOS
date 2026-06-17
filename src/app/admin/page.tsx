// FB_EVENTOS — Admin overview (2026-06-17 admin-first rework).
//
// Lista paginada de organizadoras com stats rápidos + link para acessar
// cada uma como organizadora. Paginação simples client-side via sort
// (ordenado por created_at DESC no SQL, mais novas em cima).

import { ArrowUpRight, Building2, CalendarDays, Plus, Users } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { adminListOrganizations } from '@/lib/admin/queries'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export default async function AdminOverviewPage() {
  // Layout gate (requireSuperAdmin) already ran — safe to query directly.
  const orgs = await adminListOrganizations()

  const totalEvents = orgs.reduce((s, o) => s + o.countEvents, 0)
  const totalMembers = orgs.reduce((s, o) => s + o.countMembers, 0)

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 lg:p-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Visão geral</h1>
        <p className="text-sm text-slate-600">
          Painel administrativo do sistema. Gerencie organizadoras e usuários globais aqui.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Organizadoras" value={orgs.length} Icon={Building2} />
        <StatTile label="Vínculos ativos" value={totalMembers} Icon={Users} />
        <StatTile label="Eventos cadastrados" value={totalEvents} Icon={CalendarDays} />
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Organizadoras
          </h2>
          <Button asChild size="sm">
            <Link href="/admin/organizadoras/nova">
              <Plus className="mr-1 h-3 w-3" /> Nova organizadora
            </Link>
          </Button>
        </div>

        {orgs.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-600">
              Nenhuma organizadora cadastrada ainda.{' '}
              <Link
                href="/admin/organizadoras/nova"
                className="font-medium text-emerald-700 underline"
              >
                Criar a primeira →
              </Link>
            </CardContent>
          </Card>
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
      </section>
    </main>
  )
}

interface StatTileProps {
  label: string
  value: number
  Icon: typeof Building2
}

function StatTile({ label, value, Icon }: StatTileProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <Icon className="h-5 w-5 text-emerald-600" aria-hidden="true" />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </p>
    </div>
  )
}
