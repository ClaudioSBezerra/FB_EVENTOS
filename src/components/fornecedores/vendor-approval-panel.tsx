// FB_EVENTOS — Vendor approval panel (Phase 1, Plan 01-04 — Task 2).
//
// Client component with Approve / Reject buttons. Reject opens an inline
// reason field — a full Dialog primitive is not yet in the shadcn shell
// (added later); for Phase 1 piloto the inline reason is sufficient UX.

'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { approveVendor, rejectVendor } from '@/lib/actions/fornecedores'

export interface VendorApprovalPanelProps {
  vendorId: string
  status: string
}

export function VendorApprovalPanel({ vendorId, status }: VendorApprovalPanelProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (status !== 'pending') {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
        <p className="font-medium">Aprovação concluída.</p>
        <p className="text-slate-600">
          Status atual: <strong>{status}</strong>. A transição é terminal — não há ação adicional
          disponível.
        </p>
      </div>
    )
  }

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const result = await approveVendor({ vendorId, action: 'approve' })
      if (result?.serverError) {
        setError(typeof result.serverError === 'string' ? result.serverError : 'Erro de servidor.')
        return
      }
      router.refresh()
    })
  }

  function handleReject() {
    setError(null)
    if (!showRejectForm) {
      setShowRejectForm(true)
      return
    }
    if (reason.trim().length < 3) {
      setError('Motivo precisa de pelo menos 3 caracteres.')
      return
    }
    startTransition(async () => {
      const result = await rejectVendor({ vendorId, action: 'reject', reason: reason.trim() })
      if (result?.serverError) {
        setError(typeof result.serverError === 'string' ? result.serverError : 'Erro de servidor.')
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4">
      <p className="text-sm font-medium">Aprovação do fornecedor</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleApprove} disabled={isPending}>
          {isPending ? 'Processando…' : 'Aprovar'}
        </Button>
        <Button variant="outline" onClick={handleReject} disabled={isPending}>
          {showRejectForm ? 'Confirmar rejeição' : 'Rejeitar'}
        </Button>
        {showRejectForm && (
          <Button
            variant="ghost"
            onClick={() => {
              setShowRejectForm(false)
              setReason('')
              setError(null)
            }}
          >
            Cancelar
          </Button>
        )}
      </div>
      {showRejectForm && (
        <div className="space-y-1">
          <Input
            type="text"
            placeholder="Motivo da rejeição (obrigatório)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <p className="text-xs text-slate-500">
            O fornecedor receberá o motivo por email (LGPD — comunicação de status).
          </p>
        </div>
      )}
      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
    </div>
  )
}
