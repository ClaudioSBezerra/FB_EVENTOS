// FB_EVENTOS — Org selector for users with n>1 memberships.
//
// Reached via root state router when the user has more than one active
// organization (or when activeOrganizationId is stale and we need them to
// pick again). Server Component that lists memberships in a card grid;
// each card posts to selectActiveOrg via the client SelectOrgList.

import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { SelectOrgList } from '@/components/select-org/select-org-list'
import { listUserMemberships } from '@/lib/auth/memberships'

export const metadata = {
  title: 'Selecionar organização · FB_EVENTOS',
}

export default async function SelectOrgPage() {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) redirect('/login')

  const memberships = await listUserMemberships(session.user.id)
  if (memberships.length === 0) redirect('/no-access')
  // Single membership: fast-forward straight to the dashboard.
  if (memberships.length === 1 && memberships[0]) {
    redirect(`/${memberships[0].slug}/dashboard`)
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

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Selecione a organização
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Você participa de mais de uma organizadora. Escolha em qual deseja entrar agora — você
          pode trocar a qualquer momento voltando para esta tela.
        </p>

        <div className="mt-8">
          <SelectOrgList memberships={memberships} />
        </div>
      </main>
    </div>
  )
}
