// FB_EVENTOS — Contracts list page (Phase 1, Plan 01-05 Task 2).

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { ContractList } from '@/components/contracts/contract-list'
import { withTenant } from '@/db/with-tenant'
import { listContractsInTenant } from '@/lib/actions/contracts'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function ContractsListPage({ params }: PageProps) {
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

  const contracts = await withTenant(tenant.id, (db) => listContractsInTenant(db, {}))

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Contratos</h1>
        <p className="text-sm text-slate-600">
          Contratos emitidos para fornecedores. Status reflete o ciclo no ZapSign.
        </p>
      </header>
      <ContractList contracts={contracts} tenantSlug={slug} />
    </main>
  )
}
