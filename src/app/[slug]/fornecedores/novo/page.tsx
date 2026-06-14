// FB_EVENTOS — Novo fornecedor page (Phase 1, Plan 01-04 — Task 2).

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { VendorForm } from '@/components/fornecedores/vendor-form'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function NovoFornecedorPage({ params }: PageProps) {
  const { slug } = await params
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

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Novo fornecedor</h1>
        <p className="text-sm text-slate-600">
          O CNPJ é validado contra a Receita Federal via BrasilAPI. Caso a API esteja indisponível,
          você pode prosseguir com o cadastro — a verificação será revalidada depois.
        </p>
      </header>
      <VendorForm tenantSlug={slug} />
    </main>
  )
}
