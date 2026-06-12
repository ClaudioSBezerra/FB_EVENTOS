// FB_EVENTOS — Tenant dashboard Server Component (Phase 0, Plan 04 — Task 2).
//
// Protected route at /[slug]/dashboard. Validates:
//   1. Session exists (otherwise redirect to /login).
//   2. tenant by slug exists (otherwise 404).
//   3. session.activeOrganizationId matches tenant.id (otherwise 403 — user
//      authenticated but not a member of THIS tenant).
//
// All tenant-scoped data reads go through `withTenant(tenant.id, db => ...)`.
// The pattern is established even in this Phase 0 stub (which displays only
// the global tenant.name) so future plans (Phase 1+) can add tenant queries
// inside the same wrap without architectural surprise.
//
// IMPORTANT — TENA-05 silent-fail mode:
//   If a future maintainer changes this file to query the singleton `db`
//   for tenant-scoped data (e.g. `await db.select().from(member)`), RLS
//   default-deny returns 0 rows. This is the safety net documented in
//   tests/auth/server-component-tenant-isolation.test.ts. The correct
//   pattern is always `withTenant(tenant.id, scopedDb => scopedDb.select()...)`.

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { withTenant } from '@/db/with-tenant'
import { resolveTenantBySlug } from '@/lib/tenant'

interface DashboardProps {
  params: Promise<{ slug: string }>
}

export default async function TenantDashboardPage({ params }: DashboardProps) {
  const { slug } = await params
  const h = await nextHeaders()

  // 1. Session check.
  const session = await auth.api.getSession({ headers: h })
  if (!session) {
    redirect('/login')
  }

  // 2. Tenant lookup (global table, no RLS).
  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) {
    notFound()
  }

  // 3. Active-org match check.
  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId !== tenant.id) {
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

  // 4. Tenant-scoped data reads MUST happen inside withTenant.
  //    Phase 0: no queries yet, but the wrap is mandatory pattern-wise.
  const greeting = await withTenant(tenant.id, async (_scopedDb) => {
    // Future tenant queries go here. Example for Phase 1+:
    // const events = await _scopedDb.select().from(events)
    // For now, the wrap just establishes the contract.
    return `Bem-vindo, ${session.user.name ?? session.user.email}, a ${tenant.name}!`
  })

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">{tenant.name}</h1>
      <p className="text-base text-slate-700">{greeting}</p>
      <p className="text-xs text-slate-500">
        Phase 0 dashboard stub. Phase 1+ plans add events, plantas, fornecedores.
      </p>
    </main>
  )
}
