// FB_EVENTOS — Tenant dashboard (Phase 1 post-MVP, 2026-06-16).
//
// Replaces the Phase 0 stub. Renders a compact overview with:
//   - 3 KPI cards (eventos ativos, fornecedores aprovados, lotes vendidos*)
//   - Quick-action grid linking to the main flows
//
// All tenant-scoped reads happen inside withTenant() (RLS-enforced). The
// layout already verified session + tenant existence; here we re-check
// the activeOrganizationId match so cross-tenant access still 403s.
//
// (*) Lotes vendidos counts via lots.status='sold'. If no lots exist yet
// the KPI just shows 0 — no skeleton/empty-state ceremony.

import { and, count, eq, isNull } from 'drizzle-orm'
import {
  ArrowUpRight,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  FileText,
  PackageCheck,
  Receipt,
  Store,
  Users,
} from 'lucide-react'
import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { events } from '@/db/schema/events'
import { lots } from '@/db/schema/lots'
import { vendors } from '@/db/schema/vendors'
import { withTenant } from '@/db/with-tenant'
import { resolveTenantBySlug } from '@/lib/tenant'

interface DashboardProps {
  params: Promise<{ slug: string }>
}

export default async function TenantDashboardPage({ params }: DashboardProps) {
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
          <p className="mt-2 text-sm text-red-600">
            Você está autenticado, mas não tem acesso à organização <strong>{tenant.name}</strong>.
          </p>
        </div>
      </main>
    )
  }

  const stats = await withTenant(tenant.id, async (db) => {
    const [evRow] = await db.select({ n: count() }).from(events).where(isNull(events.deletedAt))
    const [vdRow] = await db
      .select({ n: count() })
      .from(vendors)
      .where(and(isNull(vendors.deletedAt), eq(vendors.status, 'approved')))
    const [lotRow] = await db
      .select({ n: count() })
      .from(lots)
      .where(and(isNull(lots.deletedAt), eq(lots.status, 'sold')))
    return {
      eventos: Number(evRow?.n ?? 0),
      fornecedoresAprovados: Number(vdRow?.n ?? 0),
      lotesVendidos: Number(lotRow?.n ?? 0),
    }
  })

  const userName = session.user.name ?? session.user.email ?? ''

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 lg:p-8">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{tenant.name}</h1>
        <p className="text-sm text-slate-600">
          Olá, {userName}. Aqui está um resumo da sua operação.
        </p>
      </header>

      {/* KPI cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Eventos cadastrados"
          value={stats.eventos}
          Icon={CalendarDays}
          href={`/${slug}/eventos`}
        />
        <KpiCard
          label="Fornecedores aprovados"
          value={stats.fornecedoresAprovados}
          Icon={CheckCircle2}
          href={`/${slug}/fornecedores`}
        />
        <KpiCard
          label="Lotes vendidos"
          value={stats.lotesVendidos}
          Icon={PackageCheck}
          href={`/${slug}/cobrancas`}
        />
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Ações rápidas
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            href={`/${slug}/eventos/novo`}
            title="Criar evento"
            description="Cadastre um novo evento, suba a planta e defina capacidades."
            Icon={CalendarPlus}
          />
          <QuickAction
            href={`/${slug}/eventos`}
            title="Ver eventos"
            description="Lista de eventos com plantas, lotes e dashboards."
            Icon={CalendarDays}
          />
          <QuickAction
            href={`/${slug}/fornecedores`}
            title="Fornecedores"
            description="Aprovar cadastros, ver documentos e histórico."
            Icon={Users}
          />
          <QuickAction
            href={`/${slug}/marketplace`}
            title="Marketplace"
            description="Veja o que está publicado para fornecedores."
            Icon={Store}
          />
          <QuickAction
            href={`/${slug}/cobrancas`}
            title="Cobranças"
            description="Pagamentos PIX/cartão, reembolsos e status."
            Icon={Receipt}
          />
          <QuickAction
            href={`/${slug}/contratos`}
            title="Contratos"
            description="Contratos digitais e assinaturas via ZapSign."
            Icon={FileText}
          />
        </div>
      </section>
    </main>
  )
}

interface KpiCardProps {
  label: string
  value: number
  Icon: typeof CalendarDays
  href: string
}

function KpiCard({ label, value, Icon, href }: KpiCardProps) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <Icon className="h-5 w-5 text-emerald-600" aria-hidden="true" />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 group-hover:underline">
        Abrir <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
      </p>
    </Link>
  )
}

interface QuickActionProps {
  href: string
  title: string
  description: string
  Icon: typeof CalendarDays
}

function QuickAction({ href, title, description, Icon }: QuickActionProps) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="space-y-2">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={href}>
            Abrir <ArrowUpRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
