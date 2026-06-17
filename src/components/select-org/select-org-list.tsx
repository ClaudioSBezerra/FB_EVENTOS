// FB_EVENTOS — Org picker (client) — 2026-06-17 admin-first rework.
//
// One card per membership. Clicking submits the selectActiveOrg Server
// Action, which validates membership server-side and flips the session
// row's active_organization_id. On success we hard-navigate to the
// /{slug}/dashboard so the next request runs with the fresh session row
// (the in-flight server-render has stale state from before the UPDATE).

'use client'

import { Building2 } from 'lucide-react'
import { useState, useTransition } from 'react'

import { selectActiveOrg } from '@/lib/actions/select-org'

interface Membership {
  organizationId: string
  slug: string
  name: string
  role: string
}

interface SelectOrgListProps {
  memberships: Membership[]
}

export function SelectOrgList({ memberships }: SelectOrgListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function pick(orgId: string) {
    setError(null)
    setPendingId(orgId)
    startTransition(async () => {
      const result = await selectActiveOrg({ organizationId: orgId })
      if (!result.ok) {
        setPendingId(null)
        setError(
          result.error === 'not_member'
            ? 'Você não é membro desta organização.'
            : result.error === 'no_session'
              ? 'Sua sessão expirou. Faça login novamente.'
              : 'Falha ao trocar de organização. Tente novamente.',
        )
        return
      }
      // Hard navigate so server components re-render with new session.
      window.location.assign(`/${result.slug}/dashboard`)
    })
  }

  return (
    <div className="space-y-3">
      {memberships.map((m) => {
        const busy = isPending && pendingId === m.organizationId
        return (
          <button
            key={m.organizationId}
            type="button"
            onClick={() => pick(m.organizationId)}
            disabled={isPending}
            className="flex w-full items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-900">{m.name}</p>
              <p className="truncate text-xs text-slate-500">
                /{m.slug} · papel: {m.role}
              </p>
            </div>
            <span className="text-xs text-slate-400">{busy ? 'Entrando…' : 'Entrar →'}</span>
          </button>
        )
      })}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
