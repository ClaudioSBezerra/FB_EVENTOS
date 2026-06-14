// FB_EVENTOS — Contract detail page (Phase 1, Plan 01-05 Task 2).

import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { ContractDetail } from '@/components/contracts/contract-detail'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { withTenant } from '@/db/with-tenant'
import { getContractByIdInTenant } from '@/lib/actions/contracts'
import { mintPresignedGet } from '@/lib/storage/minio'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; contractId: string }>
}

export default async function ContractDetailPage({ params }: PageProps) {
  const { slug, contractId } = await params
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

  const contract = await withTenant(tenant.id, (db) => getContractByIdInTenant(db, { contractId }))
  if (!contract) notFound()

  let pdfUrl: string | null = null
  let signedPdfUrl: string | null = null
  if (contract.pdfMinioKey) {
    try {
      const r = await mintPresignedGet(slug, contract.pdfMinioKey, 900)
      pdfUrl = r.url
    } catch {
      pdfUrl = null
    }
  }
  if (contract.signedPdfMinioKey) {
    try {
      const r = await mintPresignedGet(slug, contract.signedPdfMinioKey, 900)
      signedPdfUrl = r.url
    } catch {
      signedPdfUrl = null
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">
          Contrato {contract.id.slice(0, 8).toUpperCase()}
        </h1>
        <Button asChild variant="outline">
          <Link href={`/${slug}/contratos`}>← Voltar</Link>
        </Button>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Detalhes</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractDetail
            id={contract.id}
            status={contract.status}
            templateVersion={contract.templateVersion}
            pdfMinioKey={contract.pdfMinioKey}
            zapsignDocId={contract.zapsignDocId}
            signedPdfMinioKey={contract.signedPdfMinioKey}
            createdAt={contract.createdAt}
            pdfUrl={pdfUrl}
            signedPdfUrl={signedPdfUrl}
          />
        </CardContent>
      </Card>
    </main>
  )
}
