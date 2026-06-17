// FB_EVENTOS — Contract simulator panel (piloto pré-credencial ZapSign,
// 2026-06-17). Pareado com PaymentSimulatorPanel.

'use client'

import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { simulateContractSigned } from '@/lib/actions/zapsign-simulator'

interface ContractSimulatorPanelProps {
  contractId: string
  tenantId: string
}

export function ContractSimulatorPanel({ contractId, tenantId }: ContractSimulatorPanelProps) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function fire() {
    setError(null)
    startTransition(async () => {
      const result = await simulateContractSigned({ contractId, tenantId })
      if (!result.ok) {
        setError(
          result.error === 'simulator_disabled'
            ? 'Simulador desligado no servidor.'
            : result.error === 'not_simulated'
              ? 'Esse contrato NÃO é simulado.'
              : result.error === 'wrong_status'
                ? 'Contrato em status incompatível com simulação.'
                : result.error === 'contract_not_found'
                  ? 'Contrato não encontrado.'
                  : 'Falha ao simular. Tente novamente.',
        )
        return
      }
      setDone(true)
      setTimeout(() => window.location.reload(), 800)
    })
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        <p className="font-medium">Contrato simulado como ASSINADO.</p>
        <p className="mt-1 text-xs">Recarregando…</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div>
          <p className="font-semibold text-amber-900">Modo simulação (ZapSign)</p>
          <p className="mt-1 text-xs text-amber-800">
            A integração com ZapSign ainda não tem credenciais reais. Clique para simular a
            assinatura do contrato — não há PDF assinado de verdade, mas o fluxo segue (email de
            contrato_assinado é enfileirado).
          </p>
        </div>
      </div>

      <Button
        type="button"
        onClick={fire}
        disabled={pending}
        className="bg-emerald-600 hover:bg-emerald-700"
      >
        <CheckCircle2 className="mr-1 h-4 w-4" />
        {pending ? 'Processando…' : 'Simular assinatura do contrato'}
      </Button>

      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
    </div>
  )
}
