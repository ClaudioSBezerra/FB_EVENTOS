// FB_EVENTOS — "Acessar como organizadora" button (admin → tenant shell).
//
// Renderizado em /admin/organizadoras/[orgId]/page.tsx. Chama
// selectActiveOrg (que tem o super_admin bypass) e redireciona pra
// /{slug}/dashboard.

'use client'

import { LogIn } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { selectActiveOrg } from '@/lib/actions/select-org'

interface EnterAsOrgButtonProps {
  organizationId: string
}

export function EnterAsOrgButton({ organizationId }: EnterAsOrgButtonProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function enter() {
    setError(null)
    startTransition(async () => {
      const result = await selectActiveOrg({ organizationId })
      if (!result.ok) {
        setError(
          result.error === 'no_session'
            ? 'Sessão expirada. Faça login novamente.'
            : result.error === 'org_not_found'
              ? 'Organização não encontrada.'
              : result.error === 'switch_failed'
                ? 'Falha ao trocar de organização.'
                : 'Acesso negado.',
        )
        return
      }
      window.location.assign(`/${result.slug}/dashboard`)
    })
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={enter} disabled={pending}>
        <LogIn className="mr-1 h-4 w-4" />
        {pending ? 'Entrando…' : 'Acessar como organizadora'}
      </Button>
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
    </div>
  )
}
