// FB_EVENTOS — Checkout simulator panel (piloto pré-credencial, 2026-06-17).
//
// Renderizado quando o pagamento tem gatewayOrderId começando com SIM_
// (criado pelo createSimulatedOrder). Mostra um banner vermelho indicando
// o modo simulação e dois botões: Aprovar / Recusar. Cliques disparam as
// Server Actions que emitem o outbox event correspondente.

'use client'

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { simulatePaymentFailed, simulatePaymentPaid } from '@/lib/actions/payment-simulator'

interface PaymentSimulatorPanelProps {
  paymentId: string
  tenantId: string
}

export function PaymentSimulatorPanel({ paymentId, tenantId }: PaymentSimulatorPanelProps) {
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState<'paid' | 'failed' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function fire(kind: 'paid' | 'failed') {
    setError(null)
    startTransition(async () => {
      const action = kind === 'paid' ? simulatePaymentPaid : simulatePaymentFailed
      const result = await action({ paymentId, tenantId })
      if (!result.ok) {
        setError(
          result.error === 'simulator_disabled'
            ? 'Simulador desligado no servidor.'
            : result.error === 'not_simulated'
              ? 'Esse pagamento NÃO é simulado.'
              : result.error === 'wrong_status'
                ? 'Pagamento não está em status pendente.'
                : result.error === 'payment_not_found'
                  ? 'Pagamento não encontrado.'
                  : 'Falha ao simular. Tente novamente.',
        )
        return
      }
      setDone(kind)
      // Reload page so the new status shows up; outbox-drain will pick up
      // the rest within ~60s for lot status etc.
      setTimeout(() => window.location.reload(), 800)
    })
  }

  if (done) {
    return (
      <div
        className={`rounded-md border p-4 ${
          done === 'paid'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        <p className="font-medium">
          {done === 'paid'
            ? 'Pagamento simulado como APROVADO.'
            : 'Pagamento simulado como RECUSADO.'}
        </p>
        <p className="mt-1 text-xs">
          Recarregando… o outbox processará o resto em até 60s (marcar lote, enviar e-mail, etc.).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div>
          <p className="font-semibold text-red-900">Modo simulação ativo</p>
          <p className="mt-1 text-xs text-red-800">
            As credenciais reais do Pagar.me ainda não estão configuradas. Use os botões abaixo para
            simular o resultado do pagamento. Em produção real, esse painel não aparece.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => fire('paid')}
          disabled={pending}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          {pending ? 'Processando…' : 'Simular pagamento aprovado'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => fire('failed')}
          disabled={pending}
          className="border-red-300 text-red-700 hover:bg-red-100"
        >
          <XCircle className="mr-1 h-4 w-4" />
          {pending ? 'Processando…' : 'Simular pagamento recusado'}
        </Button>
      </div>

      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
    </div>
  )
}
