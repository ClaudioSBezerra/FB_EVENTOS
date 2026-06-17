// FB_EVENTOS — Admin org detail/edit page (2026-06-17 admin-first rework).
//
// Fetch é cross-tenant para super_admin: a org info via withTenant() do
// próprio orgId, e os membros via listUserMemberships inversamente
// resolvido… mas precisamos do reverso (membros de uma org, não orgs de
// um user). Reusamos withTenant() com o orgId — membros vivem na mesma
// tenancy da org.

import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EditOrganizadoraForm } from '@/components/admin/edit-organizadora-form'
import { Button } from '@/components/ui/button'
import { member, organization, user as userTable } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

interface PageProps {
  params: Promise<{ orgId: string }>
}

export default async function AdminOrgDetailPage({ params }: PageProps) {
  const { orgId } = await params

  // We use withTenant() because organization + member are RLS-scoped.
  // Even though the layout has already verified super_admin, we keep the
  // contract: tenant-scoped reads always go through withTenant().
  const data = await withTenant(orgId, async (db) => {
    const orgRows = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
      })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    const org = orgRows[0]
    if (!org) return null

    const members = await db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        email: userTable.email,
        name: userTable.name,
      })
      .from(member)
      .innerJoin(userTable, eq(userTable.id, member.userId))
      .where(eq(member.organizationId, orgId))

    return { org, members }
  })

  if (!data) notFound()
  const { org, members } = data

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 lg:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{org.name}</h1>
          <p className="font-mono text-xs text-slate-500">/{org.slug}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/organizadoras">← Voltar</Link>
        </Button>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Dados</h2>
        <EditOrganizadoraForm orgId={org.id} initialName={org.name} />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Membros ({members.length})
          </h2>
        </div>
        {members.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-600">
            Nenhum membro vinculado a essa organização.
          </p>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-6 py-2">Nome</th>
                <th className="px-6 py-2">Email</th>
                <th className="px-6 py-2">Papel</th>
                <th className="px-6 py-2">Desde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3 font-medium text-slate-900">{m.name ?? '—'}</td>
                  <td className="px-6 py-3 text-slate-700">{m.email}</td>
                  <td className="px-6 py-3 text-slate-600">{m.role}</td>
                  <td className="px-6 py-3 text-slate-500">{dateFmt.format(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
