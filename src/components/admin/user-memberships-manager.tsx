// FB_EVENTOS — User memberships manager (admin, 2026-06-17 admin-first rework).
//
// Three controls:
//   - Toggle super_admin (Server Action setSuperAdmin)
//   - Attach to an org from a dropdown of available orgs
//   - Detach from an existing membership

'use client'

import { Plus, ShieldCheck, ShieldOff, X } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { attachUserToOrg, detachUserFromOrg, setSuperAdmin } from '@/lib/actions/admin/usuarios'

interface Membership {
  memberId: string
  organizationId: string
  orgName: string
  orgSlug: string
  role: string
}

interface AvailableOrg {
  id: string
  name: string
  slug: string
}

interface UserMembershipsManagerProps {
  userId: string
  userEmail: string
  isSuperAdmin: boolean
  memberships: Membership[]
  availableOrgs: AvailableOrg[]
}

export function UserMembershipsManager({
  userId,
  userEmail,
  isSuperAdmin,
  memberships,
  availableOrgs,
}: UserMembershipsManagerProps) {
  const [pending, startTransition] = useTransition()
  const [selectedOrg, setSelectedOrg] = useState<string>(availableOrgs[0]?.id ?? '')
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'member'>('member')
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  function clearMsgs() {
    setError(null)
    setSuccessMsg(null)
  }

  function onToggleSuper() {
    clearMsgs()
    startTransition(async () => {
      const result = await setSuperAdmin({ userId, isSuperAdmin: !isSuperAdmin })
      if (!result.ok) {
        setError(
          result.error === 'self_demote'
            ? 'Você não pode remover seu próprio acesso super-admin daqui.'
            : 'Falha ao atualizar flag super-admin.',
        )
        return
      }
      setSuccessMsg(isSuperAdmin ? 'Acesso super-admin removido.' : 'Acesso super-admin concedido.')
      // Refresh
      window.location.reload()
    })
  }

  function onAttach() {
    clearMsgs()
    if (!selectedOrg) return
    startTransition(async () => {
      const result = await attachUserToOrg({
        userId,
        organizationId: selectedOrg,
        role: selectedRole,
      })
      if (!result.ok) {
        setError(
          result.error === 'already_member'
            ? 'Esse usuário já é membro dessa organização.'
            : 'Falha ao vincular.',
        )
        return
      }
      setSuccessMsg('Vínculo criado.')
      window.location.reload()
    })
  }

  function onDetach(memberId: string, organizationId: string) {
    if (!confirm(`Remover vínculo de ${userEmail} desta organização?`)) return
    clearMsgs()
    startTransition(async () => {
      const result = await detachUserFromOrg({ memberId, organizationId })
      if (!result.ok) {
        setError('Falha ao remover vínculo.')
        return
      }
      setSuccessMsg('Vínculo removido.')
      window.location.reload()
    })
  }

  return (
    <div className="space-y-6">
      {/* Super admin toggle */}
      <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Super administrador</p>
            <p className="text-xs text-slate-600">
              {isSuperAdmin
                ? 'Este usuário pode acessar /admin (CRUD de orgs e usuários).'
                : 'Este usuário não tem acesso ao painel /admin.'}
            </p>
          </div>
          <Button
            type="button"
            variant={isSuperAdmin ? 'outline' : 'default'}
            size="sm"
            onClick={onToggleSuper}
            disabled={pending}
          >
            {isSuperAdmin ? (
              <>
                <ShieldOff className="mr-1 h-3 w-3" /> Remover
              </>
            ) : (
              <>
                <ShieldCheck className="mr-1 h-3 w-3" /> Conceder
              </>
            )}
          </Button>
        </div>
      </section>

      {/* Memberships */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Vínculos com organizações
        </h3>
        {memberships.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-600">
            Esse usuário não está vinculado a nenhuma organização ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {memberships.map((m) => (
              <li
                key={m.memberId}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">{m.orgName}</p>
                  <p className="text-xs text-slate-500">
                    /{m.orgSlug} · papel: {m.role}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onDetach(m.memberId, m.organizationId)}
                  disabled={pending}
                >
                  <X className="mr-1 h-3 w-3" /> Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Attach form */}
      <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Vincular a uma organização</h3>
        {availableOrgs.length === 0 ? (
          <p className="text-xs text-slate-600">
            Nenhuma organização adicional disponível — o usuário já é membro de todas.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-xs font-medium text-slate-700">
              Organização
              <select
                value={selectedOrg}
                onChange={(e) => setSelectedOrg(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm"
              >
                {availableOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} (/{o.slug})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Papel
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as 'owner' | 'admin' | 'member')}
                className="mt-1 block rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
            </label>
            <Button type="button" onClick={onAttach} disabled={pending} size="sm">
              <Plus className="mr-1 h-3 w-3" /> Vincular
            </Button>
          </div>
        )}
      </section>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      {successMsg && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
          {successMsg}
        </p>
      )}
    </div>
  )
}
