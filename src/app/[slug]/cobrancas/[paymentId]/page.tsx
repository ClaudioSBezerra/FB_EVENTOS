// FB_EVENTOS — Cobrança detail page (Phase 1, Plan 01-06 Task 2).

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { PaymentSimulatorPanel } from '@/components/checkout/payment-simulator-panel'
import { PixQr } from '@/components/payments/pix-qr'
import { withTenant } from '@/db/with-tenant'
import { getPaymentByIdInTenant } from '@/lib/actions/payments'
import { formatBRL } from '@/lib/lots/price'
import { isSimulatedOrderId } from '@/lib/pagarme/simulator'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string; paymentId: string }>
}

export default async function PaymentDetailPage({ params }: PageProps) {
  const { slug, paymentId } = await params
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

  const detail = await withTenant(tenant.id, (db) => getPaymentByIdInTenant(db, { paymentId }))
  if (!detail) notFound()

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Cobrança</h1>
        <p className="text-sm text-slate-600">ID: {detail.payment.id}</p>
      </header>

      <dl className="grid grid-cols-2 gap-4 rounded-md border bg-card p-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium">{detail.payment.status}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Método</dt>
          <dd className="font-medium">{detail.payment.method.toUpperCase()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Valor</dt>
          <dd className="font-medium">{formatBRL(detail.payment.amountBrlCents / 100)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Criada</dt>
          <dd className="font-medium">{detail.payment.createdAt.toLocaleString('pt-BR')}</dd>
        </div>
        {detail.payment.paidAt && (
          <div>
            <dt className="text-muted-foreground">Paga em</dt>
            <dd className="font-medium">{detail.payment.paidAt.toLocaleString('pt-BR')}</dd>
          </div>
        )}
        {detail.payment.gatewayOrderId && (
          <div>
            <dt className="text-muted-foreground">Pagar.me Order</dt>
            <dd className="font-mono text-xs">{detail.payment.gatewayOrderId}</dd>
          </div>
        )}
      </dl>

      {/* Payment simulator (piloto pré-credencial Pagar.me) — só aparece
          quando o pagamento foi criado pelo simulador (gatewayOrderId
          começa com SIM_) E está pendente. */}
      {detail.payment.status === 'pending' && isSimulatedOrderId(detail.payment.gatewayOrderId) && (
        <PaymentSimulatorPanel paymentId={detail.payment.id} tenantId={detail.payment.tenantId} />
      )}

      {/* PIX QR — só pra pagamentos PIX REAIS (sem SIM_). */}
      {detail.payment.method === 'pix' &&
        detail.payment.status === 'pending' &&
        !isSimulatedOrderId(detail.payment.gatewayOrderId) &&
        detail.pix_qr_url &&
        detail.pix_copy_paste && (
          <PixQr qrUrl={detail.pix_qr_url} copyPaste={detail.pix_copy_paste} />
        )}
    </main>
  )
}
