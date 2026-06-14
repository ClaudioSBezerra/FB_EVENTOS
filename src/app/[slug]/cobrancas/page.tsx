// FB_EVENTOS — Cobranças (Pagar.me charges) list page (Phase 1, Plan 01-06 Task 2).

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { withTenant } from '@/db/with-tenant'
import { listPaymentsInTenant } from '@/lib/actions/payments'
import { formatBRL } from '@/lib/lots/price'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function PaymentsListPage({ params }: PageProps) {
  const { slug } = await params
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) redirect('/login')

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) notFound()
  if (session.session.activeOrganizationId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
        </div>
      </main>
    )
  }

  const rows = await withTenant(tenant.id, (db) => listPaymentsInTenant(db, {}))

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Cobranças</h1>
        <p className="text-sm text-slate-600">
          Cobranças Pagar.me emitidas para os fornecedores deste tenant.
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhuma cobrança criada ainda. Emita uma cobrança a partir de um contrato assinado.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="px-2 py-2">Criada em</th>
              <th className="px-2 py-2">Método</th>
              <th className="px-2 py-2">Valor</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Pago em</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="px-2 py-2">{p.createdAt.toLocaleString('pt-BR')}</td>
                <td className="px-2 py-2">{p.method.toUpperCase()}</td>
                <td className="px-2 py-2">{formatBRL(p.amountBrlCents / 100)}</td>
                <td className="px-2 py-2">{p.status}</td>
                <td className="px-2 py-2">{p.paidAt ? p.paidAt.toLocaleString('pt-BR') : '—'}</td>
                <td className="px-2 py-2">
                  <a href={`/${slug}/cobrancas/${p.id}`} className="text-primary underline">
                    Detalhes
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
