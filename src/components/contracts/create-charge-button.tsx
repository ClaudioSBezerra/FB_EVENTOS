// FB_EVENTOS — Create charge button (Phase 1, Plan 01-06 Task 2).
//
// Shown on the contract-detail page when contracts.status='signed'.
// Phase 1 simple flow: pick method (PIX or cartão), enter amount in BRL,
// click "Criar cobrança" → Server Action returns PIX QR or charge id.
// Credit card path Phase 1 accepts a pre-tokenized card_token (the
// transparent-checkout JS that tokenizes raw card data lives in Phase 2).

'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { createCharge } from '@/lib/actions/payments'

interface CreateChargeButtonProps {
  contractId: string
  /** Default amount (e.g. computed from lot price). */
  defaultAmountBrl: number
}

export function CreateChargeButton({ contractId, defaultAmountBrl }: CreateChargeButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [method, setMethod] = useState<'pix' | 'credit_card'>('pix')
  const [amountBrl, setAmountBrl] = useState<string>(defaultAmountBrl.toFixed(2))
  const [cardToken, setCardToken] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{
    paymentId: string
    pixQrUrl: string | null
    pixCopyPaste: string | null
  } | null>(null)

  function handleCreate() {
    setError(null)
    setSuccess(null)
    const cents = Math.round(Number(amountBrl) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Valor inválido')
      return
    }
    if (method === 'credit_card' && !cardToken.trim()) {
      setError('Token do cartão é obrigatório para pagamento com cartão')
      return
    }
    startTransition(async () => {
      const res = await createCharge({
        contractId,
        method,
        amount_brl_cents: cents,
        ...(method === 'credit_card' ? { card_token: cardToken } : {}),
      })
      if (res?.serverError) {
        setError(typeof res.serverError === 'string' ? res.serverError : 'Erro ao criar cobrança')
        return
      }
      const data = res?.data
      if (!data) {
        setError('Resposta vazia do servidor')
        return
      }
      setSuccess({
        paymentId: data.payment.id,
        pixQrUrl: data.pix_qr_url,
        pixCopyPaste: data.pix_copy_paste,
      })
    })
  }

  if (success) {
    return (
      <div className="space-y-2 rounded border bg-green-50 p-4">
        <p className="text-sm text-green-700">Cobrança criada com sucesso.</p>
        <a
          href={`./cobrancas/${success.paymentId}`}
          className="text-sm font-medium text-primary underline"
        >
          Ver detalhes da cobrança
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded border p-4">
      <h3 className="text-base font-semibold">Criar cobrança</h3>
      <fieldset className="space-y-2">
        <legend className="sr-only">Método de pagamento</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="method"
            value="pix"
            checked={method === 'pix'}
            onChange={() => setMethod('pix')}
          />
          PIX (QR Code + copia-cola)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="method"
            value="credit_card"
            checked={method === 'credit_card'}
            onChange={() => setMethod('credit_card')}
          />
          Cartão de crédito
        </label>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span>Valor (R$)</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amountBrl}
          onChange={(e) => setAmountBrl(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </label>
      {method === 'credit_card' && (
        <label className="flex flex-col gap-1 text-sm">
          <span>Token do cartão (Pagar.me)</span>
          <input
            type="text"
            value={cardToken}
            onChange={(e) => setCardToken(e.target.value)}
            placeholder="card_token_…"
            className="rounded border px-2 py-1 font-mono text-xs"
          />
        </label>
      )}
      <Button onClick={handleCreate} disabled={isPending} variant="default" size="sm">
        {isPending ? 'Criando…' : 'Criar cobrança'}
      </Button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
