// FB_EVENTOS — Fornecedores list page (Phase 1, Plan 01-04 — Task 2).
//
// Tenant-scoped list view at /[slug]/fornecedores. Same guard pattern as
// /[slug]/eventos: session → tenant resolve → active-org check → withTenant.

import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { VendorList } from '@/components/fornecedores/vendor-list'
import { Button } from '@/components/ui/button'
import { withTenant } from '@/db/with-tenant'
import { listVendorsInTenant } from '@/lib/actions/fornecedores'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string; search?: string }>
}

export default async function FornecedoresListPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const h = await nextHeaders()

  const session = await auth.api.getSession({ headers: h })
  if (!session) redirect('/login')

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) notFound()

  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId !== tenant.id) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-700">403 — Sem acesso</h1>
          <p className="mt-2 text-sm text-red-600">
            Você não tem acesso à organização <strong>{tenant.name}</strong>.
          </p>
        </div>
      </main>
    )
  }

  const statusFilter =
    sp.status === 'pending' || sp.status === 'approved' || sp.status === 'rejected'
      ? sp.status
      : undefined
  const search = sp.search?.trim() || undefined

  const items = await withTenant(tenant.id, async (db) =>
    listVendorsInTenant(db, { status: statusFilter, search }),
  )

  const filters: Array<{ key: 'pending' | 'approved' | 'rejected' | 'all'; label: string }> = [
    { key: 'all', label: 'Todos' },
    { key: 'pending', label: 'Pendentes' },
    { key: 'approved', label: 'Aprovados' },
    { key: 'rejected', label: 'Rejeitados' },
  ]

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Fornecedores</h1>
          <p className="text-sm text-slate-600">
            {tenant.name} — gerencie cadastros, aprovações e documentos.
          </p>
        </div>
        <Button asChild>
          <Link href={`/${slug}/fornecedores/novo`}>Novo fornecedor</Link>
        </Button>
      </header>

      <nav className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const href =
            f.key === 'all' ? `/${slug}/fornecedores` : `/${slug}/fornecedores?status=${f.key}`
          const active = (f.key === 'all' && !statusFilter) || f.key === statusFilter
          return (
            <Link
              key={f.key}
              href={href}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? 'border-slate-700 bg-slate-700 text-white'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {f.label}
            </Link>
          )
        })}
      </nav>

      <VendorList tenantSlug={slug} vendors={items} />
    </main>
  )
}
