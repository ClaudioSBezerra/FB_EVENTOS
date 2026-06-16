// FB_EVENTOS — Onboarding page (post-signup / login-without-org landing).
//
// Reached when an authenticated user lands without an active organization.
// Two entry paths:
//   1. Brand-new user just verified email + logged in → no org yet.
//   2. Legacy user created before the org-on-signup flow was wired → no org.
//
// Server-side checks:
//   - No session → redirect /login.
//   - Session has activeOrganizationId → redirect /[slug]/dashboard.
//   - Otherwise render the OnboardingForm client component.

import { eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { OnboardingForm } from '@/components/onboarding/onboarding-form'
import { organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'

export const metadata = {
  title: 'Configurar organização · FB_EVENTOS',
}

export default async function OnboardingPage() {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })

  if (!session) {
    redirect('/login')
  }

  const activeOrgId = session.session.activeOrganizationId
  if (activeOrgId) {
    const slug = await withTenant(activeOrgId, async (scopedDb) => {
      const rows = await scopedDb
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, activeOrgId))
        .limit(1)
      return rows[0]?.slug ?? null
    })
    if (slug) redirect(`/${slug}/dashboard`)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">
            FB<span className="text-emerald-600">_</span>EVENTOS
          </span>
          <span className="text-sm text-slate-500">{session.user.email}</span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Configurar sua organização
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Falta um último passo: dê um nome à sua organizadora. Você poderá criar eventos, planta,
          contratos e cobranças no painel da organização.
        </p>

        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <OnboardingForm />
        </div>
      </main>
    </div>
  )
}
