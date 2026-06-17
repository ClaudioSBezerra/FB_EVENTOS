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
  CheckCircle2,
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

      {/* Módulos do sistema — cards grandes estilo ERP. Cada módulo é uma
          área completa do produto; o botão é a ação principal de entrada. */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Módulos
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ModuleCard
            title="Eventos"
            description="Cadastre eventos, suba plantas, desenhe lotes e defina categorias de preço."
            Icon={CalendarDays}
            primaryHref={`/${slug}/eventos/novo`}
            primaryLabel="Novo evento"
            secondaryHref={`/${slug}/eventos`}
            secondaryLabel="Ver eventos"
          />
          <ModuleCard
            title="Fornecedores"
            description="Cadastros, documentos, aprovação e histórico de vínculos."
            Icon={Users}
            primaryHref={`/${slug}/fornecedores/novo`}
            primaryLabel="Novo fornecedor"
            secondaryHref={`/${slug}/fornecedores`}
            secondaryLabel="Ver fornecedores"
          />
          <ModuleCard
            title="Marketplace"
            description="Veja o que está publicado para fornecedores e acompanhe reservas."
            Icon={Store}
            primaryHref={`/${slug}/marketplace`}
            primaryLabel="Abrir marketplace"
          />
          <ModuleCard
            title="Cobranças & Contratos"
            description="PIX, cartão, reembolsos, contratos digitais e assinaturas."
            Icon={Receipt}
            primaryHref={`/${slug}/cobrancas`}
            primaryLabel="Ver cobranças"
            secondaryHref={`/${slug}/contratos`}
            secondaryLabel="Ver contratos"
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

interface ModuleCardProps {
  title: string
  description: string
  Icon: typeof CalendarDays
  primaryHref: string
  primaryLabel: string
  secondaryHref?: string
  secondaryLabel?: string
}

function ModuleCard({
  title,
  description,
  Icon,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: ModuleCardProps) {
  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      <CardHeader className="space-y-3">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto flex flex-wrap gap-2">
        <Button asChild size="default">
          <Link href={primaryHref}>
            {primaryLabel} <ArrowUpRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
        {secondaryHref && secondaryLabel && (
          <Button asChild size="default" variant="outline">
            <Link href={secondaryHref}>{secondaryLabel}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
