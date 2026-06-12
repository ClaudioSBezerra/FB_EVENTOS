// FB_EVENTOS — Landing page (Phase 0, Plan 04 — Task 2).
//
// If logged in → server-side redirect to the active-org dashboard. Else →
// show links to /signup and /login.

import { eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'

export default async function Home() {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })

  if (session?.session.activeOrganizationId) {
    // Look up tenant slug for the active org. organization is tenant-scoped,
    // so we MUST query inside withTenant.
    const orgId = session.session.activeOrganizationId
    const slug = await withTenant(orgId, async (scopedDb) => {
      // Phase 0 invariant: organization.id === tenant.id
      const rows = await scopedDb
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1)
      return rows[0]?.slug ?? null
    })
    if (slug) redirect(`/${slug}/dashboard`)
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">FB_EVENTOS</h1>
      <p className="max-w-prose text-center text-base text-zinc-600">
        Plataforma SaaS de gestão de grandes eventos — venda de espaços, ingressos e operação
        ponta-a-ponta.
      </p>
      <div className="flex gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-slate-50 hover:bg-slate-900/90"
        >
          Criar conta
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
        >
          Entrar
        </Link>
      </div>
    </main>
  )
}
