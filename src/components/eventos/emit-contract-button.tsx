// FB_EVENTOS — Emit contract button (Phase 1, Plan 01-05 Task 2).
//
// Used on the lot assignment dialog (Plan 01-03) — once an organizadora
// has assigned a vendor to a lot, the next CTA is "Emitir contrato"
// which kicks off the pdf.generate-contract → zapsign.send-contract chain.

'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { emitContract } from '@/lib/actions/contracts'

interface EmitContractButtonProps {
  lotAssignmentId: string
  lotCode: string
}

export function EmitContractButton({ lotAssignmentId, lotCode }: EmitContractButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleEmit() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const res = await emitContract({ lotAssignmentId })
      if (res?.serverError) {
        setError(typeof res.serverError === 'string' ? res.serverError : 'Erro ao emitir contrato')
        return
      }
      setMessage(`Contrato emitido para lote ${lotCode} — PDF em geração`)
    })
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleEmit} disabled={isPending} variant="default" size="sm">
        {isPending ? 'Emitindo…' : 'Emitir contrato'}
      </Button>
      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
