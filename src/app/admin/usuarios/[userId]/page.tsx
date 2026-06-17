// FB_EVENTOS — Admin user detail/edit page (2026-06-17 admin-first rework).

import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AdminResetPasswordForm } from '@/components/admin/reset-password-form'
import { UserMembershipsManager } from '@/components/admin/user-memberships-manager'
import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { user as userTable } from '@/db/schema/auth'
import { adminListOrganizations } from '@/lib/admin/queries'
import { listUserMemberships } from '@/lib/auth/memberships'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

interface PageProps {
  params: Promise<{ userId: string }>
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const { userId } = await params

  // User row is global — no withTenant needed.
  const userRows = await db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      emailVerified: userTable.emailVerified,
      isSuperAdmin: userTable.isSuperAdmin,
      createdAt: userTable.createdAt,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)
  const u = userRows[0]
  if (!u) notFound()

  const [memberships, allOrgs] = await Promise.all([
    listUserMemberships(userId),
    adminListOrganizations(),
  ])

  const currentOrgIds = new Set(memberships.map((m) => m.organizationId))
  const availableOrgs = allOrgs
    .filter((o) => !currentOrgIds.has(o.id))
    .map((o) => ({ id: o.id, name: o.name, slug: o.slug }))

  const membershipsForUI = memberships.map((m) => ({
    memberId: m.memberId,
    organizationId: m.organizationId,
    orgName: m.name,
    orgSlug: m.slug,
    role: m.role,
  }))

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 lg:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {u.name ?? u.email}
          </h1>
          <p className="text-sm text-slate-600">
            {u.email}
            {' · '}
            {u.emailVerified ? (
              <span className="text-emerald-700">verificado</span>
            ) : (
              <span className="text-amber-700">não verificado</span>
            )}
            {' · '}criado em {dateFmt.format(u.createdAt)}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/usuarios">← Voltar</Link>
        </Button>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <UserMembershipsManager
          userId={u.id}
          userEmail={u.email}
          isSuperAdmin={u.isSuperAdmin}
          memberships={membershipsForUI}
          availableOrgs={availableOrgs}
        />
      </section>

      <AdminResetPasswordForm userId={u.id} userEmail={u.email} />
    </main>
  )
}
