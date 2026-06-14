// FB_EVENTOS — Fornecedor detail page (Phase 1, Plan 01-04 — Task 2/3).
//
// Detail view at /[slug]/fornecedores/[vendorId]. Renders:
//   - Identity card (legal/trade name, CNPJ, contact, status)
//   - Approval panel (pending → approve | reject)
//   - Document cofre uploader + list (Task 3)
//
// All inside the standard session + tenant + active-org guard.

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { VendorApprovalPanel } from '@/components/fornecedores/vendor-approval-panel'
import { withTenant } from '@/db/with-tenant'
import { getVendorByIdInTenant } from '@/lib/actions/fornecedores'
import { resolveTenantBySlug } from '@/lib/tenant'
import { formatCNPJ } from '@/lib/validators/cnpj'

interface PageProps {
  params: Promise<{ slug: string; vendorId: string }>
}

export default async function FornecedorDetailPage({ params }: PageProps) {
  const { slug, vendorId } = await params
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

  const vendor = await withTenant(tenant.id, async (db) =>
    getVendorByIdInTenant(db, { id: vendorId }),
  )
  if (!vendor) notFound()

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{vendor.legalName}</h1>
        <p className="text-sm text-slate-600">
          {vendor.tradeName ?? 'Sem nome fantasia'} — CNPJ {formatCNPJ(vendor.cnpj)}
        </p>
      </header>

      <section className="rounded-md border border-slate-200 p-4 text-sm">
        <p>
          <strong>Email:</strong> {vendor.email}
        </p>
        {vendor.phone && (
          <p>
            <strong>Telefone:</strong> {vendor.phone}
          </p>
        )}
        <p className="mt-2">
          <strong>Status:</strong> {vendor.status}
        </p>
        {!vendor.cnpjVerified && (
          <p className="mt-1 text-xs text-amber-700">
            ⚠ CNPJ não verificado contra a Receita (BrasilAPI degradou). Revalide quando voltar.
          </p>
        )}
        {vendor.approvalReason && (
          <p className="mt-2 text-sm">
            <strong>Motivo:</strong> {vendor.approvalReason}
          </p>
        )}
      </section>

      <VendorApprovalPanel vendorId={vendor.id} status={vendor.status} />

      {/* Document cofre uploader + list — wired in Task 3. */}
    </main>
  )
}
