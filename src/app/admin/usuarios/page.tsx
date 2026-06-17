// FB_EVENTOS — Admin usuários list (2026-06-17 admin-first rework).

import { ArrowUpRight, Plus, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { adminListUsers } from '@/lib/admin/queries'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export default async function UsuariosListPage() {
  const users = await adminListUsers()

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Usuários</h1>
          <p className="text-sm text-slate-600">
            {users.length} {users.length === 1 ? 'usuário cadastrado' : 'usuários cadastrados'}.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/usuarios/novo">
            <Plus className="mr-1 h-4 w-4" /> Novo usuário
          </Link>
        </Button>
      </header>

      {users.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">
          Nenhum usuário cadastrado ainda.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Vínculos</th>
                <th className="px-4 py-2">Criado em</th>
                <th className="px-4 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {u.name ?? '—'}
                    {u.isSuperAdmin && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
                        <ShieldCheck className="h-3 w-3" /> super
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{u.email}</td>
                  <td className="px-4 py-3 text-xs">
                    {u.emailVerified ? (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                        Verificado
                      </span>
                    ) : (
                      <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                        Não verificado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{u.countMemberships}</td>
                  <td className="px-4 py-3 text-slate-600">{dateFmt.format(u.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/usuarios/${u.id}`}
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
