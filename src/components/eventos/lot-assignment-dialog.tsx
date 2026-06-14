// FB_EVENTOS — Lot assignment dialog (Phase 1, Plan 01-03 — Task 3).
//
// Simple inline picker (no Radix Dialog yet — shadcn dialog component is
// added in 01-04). Renders a `<select>` of approved vendors and calls
// assignLotToVendor on submit.
//
// In Plan 01-04 (fornecedores) this becomes a Radix dialog with a search
// combobox; for the pilot the inline picker is enough.

'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { assignLotToVendor, unassignLot } from '@/lib/actions/lot-assignments'

interface VendorOption {
  id: string
  legalName: string
  status: string
}

interface LotAssignmentDialogProps {
  lotId: string
  lotCode: string
  currentAssignment: { vendorId: string; vendorLegalName: string } | null
  approvedVendors: VendorOption[]
}

export function LotAssignmentDialog({
  lotId,
  lotCode,
  currentAssignment,
  approvedVendors,
}: LotAssignmentDialogProps) {
  const [isPending, startTransition] = useTransition()
  const [selectedVendor, setSelectedVendor] = useState<string>(approvedVendors[0]?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleAssign() {
    if (!selectedVendor) {
      setError('Selecione um fornecedor aprovado')
      return
    }
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const res = await assignLotToVendor({ lotId, vendorId: selectedVendor })
      if (res?.serverError) {
        setError(typeof res.serverError === 'string' ? res.serverError : 'Erro ao atribuir')
        return
      }
      setMessage(`Lote ${lotCode} atribuído com sucesso`)
    })
  }

  function handleUnassign() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const res = await unassignLot({ lotId })
      if (res?.serverError) {
        setError(typeof res.serverError === 'string' ? res.serverError : 'Erro ao desatribuir')
        return
      }
      setMessage(`Atribuição do lote ${lotCode} removida`)
    })
  }

  return (
    <div className="space-y-3 rounded-md border bg-slate-50 p-3" data-testid="lot-assignment">
      <p className="text-sm font-medium">
        Lote {lotCode} — atribuição{' '}
        {currentAssignment ? (
          <>
            atual: <strong>{currentAssignment.vendorLegalName}</strong>
          </>
        ) : (
          'pendente'
        )}
      </p>

      {currentAssignment ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleUnassign}
        >
          {isPending ? 'Removendo…' : 'Remover atribuição'}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <select
            className="rounded border px-2 py-1 text-sm"
            value={selectedVendor}
            onChange={(e) => setSelectedVendor(e.target.value)}
            disabled={isPending || approvedVendors.length === 0}
            data-testid="lot-assignment-vendor-select"
          >
            {approvedVendors.length === 0 ? (
              <option value="">Nenhum fornecedor aprovado disponível</option>
            ) : (
              approvedVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.legalName}
                </option>
              ))
            )}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={isPending || approvedVendors.length === 0}
            onClick={handleAssign}
          >
            {isPending ? 'Atribuindo…' : 'Atribuir'}
          </Button>
        </div>
      )}

      {message && <p className="text-xs text-green-700">{message}</p>}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
