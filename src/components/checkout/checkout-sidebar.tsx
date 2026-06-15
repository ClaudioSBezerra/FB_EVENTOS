// FB_EVENTOS — CheckoutSidebar component (Phase 2, Plan 02-05, Task 3).
//
// Shown on the checkout page (src/app/[slug]/checkout/[cartId]/page.tsx).
//
// Layout:
//   ┌─────────────────────────────────────────┐
//   │  Cart Summary                           │
//   │  ─────────────────────────────────────  │
//   │  ✓ Lote A-01 (R$ 500,00)               │
//   │  ☐ Addon Energia (R$ 100,00)           │
//   │  ─────────────────────────────────────  │
//   │  Total: R$ 600,00                      │
//   │                                         │
//   │  Forma de Pagamento                     │
//   │  [ PIX ]  [ Cartão ]                   │
//   │                                         │
//   │  [PIX] <PixQr qrUrl copyPaste />       │
//   │  [Cartão] <InstallmentsTable /> +       │
//   │           card token input              │
//   │                                         │
//   │  [ Pagar Agora ]                       │
//   └─────────────────────────────────────────┘
//
// Add-on toggles call addAddonToCart / removeAddonFromCart Server Actions.
// "Pagar" calls startCheckout Server Action.
// On PIX success: renders <PixQr>.
// On credit_card success: renders confirmation (payment pending).

'use client'

import { useState, useTransition } from 'react'

import { PixQr } from '@/components/payments/pix-qr'
import { Button } from '@/components/ui/button'
import { addAddonToCart, removeAddonFromCart } from '@/lib/actions/cart'
import { startCheckout } from '@/lib/actions/checkout'

import { InstallmentsTable } from './installments-table'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface CartAddon {
  id: string
  addonId: string
  name: string
  priceBrlCents: number
  quantity: number
  /** cart_addon_lines.id if already in cart, else undefined */
  lineId?: string
}

export interface CheckoutSidebarProps {
  tenantSlug: string
  reservationId: string
  /** Lot name for display */
  lotName: string
  /** Lot price in centavos */
  lotPriceCents: number
  /** Available add-ons (pre-fetched on the server) */
  addons: CartAddon[]
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function CheckoutSidebar({
  reservationId,
  lotName,
  lotPriceCents,
  addons,
}: CheckoutSidebarProps) {
  const [method, setMethod] = useState<'pix' | 'credit_card'>('pix')
  const [installments, setInstallments] = useState(1)
  const [cardToken, setCardToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [pixResult, setPixResult] = useState<{
    qrUrl: string
    copyPaste: string
    expiresAt?: string | null
  } | null>(null)
  const [ccSuccess, setCcSuccess] = useState(false)
  const [activeAddonIds, setActiveAddonIds] = useState<Set<string>>(
    new Set(addons.filter((a) => !!a.lineId).map((a) => a.addonId)),
  )

  const addonTotal = addons
    .filter((a) => activeAddonIds.has(a.addonId))
    .reduce((sum, a) => sum + a.priceBrlCents * a.quantity, 0)
  const total = lotPriceCents + addonTotal

  function toggleAddon(addon: CartAddon) {
    setError(null)
    const isActive = activeAddonIds.has(addon.addonId)
    startTransition(async () => {
      if (isActive && addon.lineId) {
        const res = await removeAddonFromCart({
          reservationId,
          cartAddonLineId: addon.lineId,
        })
        if (res?.serverError) {
          setError(typeof res.serverError === 'string' ? res.serverError : 'Erro ao remover item')
          return
        }
        setActiveAddonIds((prev) => {
          const next = new Set(prev)
          next.delete(addon.addonId)
          return next
        })
      } else if (!isActive) {
        const res = await addAddonToCart({
          reservationId,
          addonId: addon.addonId,
          quantity: addon.quantity,
        })
        if (res?.serverError) {
          setError(typeof res.serverError === 'string' ? res.serverError : 'Erro ao adicionar item')
          return
        }
        setActiveAddonIds((prev) => new Set([...prev, addon.addonId]))
      }
    })
  }

  function handlePay() {
    setError(null)
    if (method === 'credit_card' && !cardToken.trim()) {
      setError('Token do cartão é obrigatório')
      return
    }
    startTransition(async () => {
      const res = await startCheckout({
        reservationId,
        method,
        ...(method === 'credit_card' ? { cardToken: cardToken.trim(), installments } : {}),
      })
      if (res?.serverError) {
        setError(
          typeof res.serverError === 'string' ? res.serverError : 'Erro ao processar pagamento',
        )
        return
      }
      const data = res?.data
      if (!data) {
        setError('Resposta vazia do servidor')
        return
      }
      if (method === 'pix' && data.pix_copy_paste && data.pix_qr_url) {
        setPixResult({
          qrUrl: data.pix_qr_url,
          copyPaste: data.pix_copy_paste,
          expiresAt: data.pix_expires_at,
        })
      } else if (method === 'credit_card') {
        setCcSuccess(true)
      }
    })
  }

  if (pixResult) {
    return (
      <div className="flex flex-col gap-4">
        <PixQr
          qrUrl={pixResult.qrUrl}
          copyPaste={pixResult.copyPaste}
          expiresAt={pixResult.expiresAt}
        />
      </div>
    )
  }

  if (ccSuccess) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <h3 className="text-lg font-semibold text-green-700">Pagamento em processamento</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Seu pagamento com cartão foi enviado para processamento. Aguarde a confirmação por e-mail.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 rounded-lg border bg-card p-6">
      {/* Cart Summary */}
      <div>
        <h3 className="mb-3 text-base font-semibold">Resumo do Carrinho</h3>
        <div className="space-y-2">
          {/* Lot (always included) */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{lotName}</span>
            <span className="text-sm tabular-nums">{formatBrl(lotPriceCents)}</span>
          </div>

          {/* Add-ons (toggleable) */}
          {addons.map((addon) => (
            <div key={addon.addonId} className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={activeAddonIds.has(addon.addonId)}
                  onChange={() => toggleAddon(addon)}
                  disabled={isPending}
                  className="cursor-pointer"
                  aria-label={addon.name}
                />
                {addon.name}
                {addon.quantity > 1 ? ` ×${addon.quantity}` : ''}
              </label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatBrl(addon.priceBrlCents * addon.quantity)}
              </span>
            </div>
          ))}

          <hr />
          <div className="flex items-center justify-between font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatBrl(total)}</span>
          </div>
        </div>
      </div>

      {/* Payment method tiles */}
      <div>
        <h3 className="mb-3 text-base font-semibold">Forma de Pagamento</h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMethod('pix')}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${method === 'pix' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
          >
            <div className="font-medium">PIX</div>
            <div className="text-xs text-muted-foreground">Pagamento instantâneo</div>
          </button>
          <button
            type="button"
            onClick={() => setMethod('credit_card')}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${method === 'credit_card' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
          >
            <div className="font-medium">Cartão</div>
            <div className="text-xs text-muted-foreground">Parcelar em até 12x</div>
          </button>
        </div>
      </div>

      {/* Credit card: installments + card token */}
      {method === 'credit_card' && (
        <div className="flex flex-col gap-4">
          <InstallmentsTable
            totalCents={total}
            selected={installments}
            onChange={setInstallments}
          />
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="card-token">
              Token do Cartão
            </label>
            <input
              id="card-token"
              type="text"
              placeholder="tok_..."
              value={cardToken}
              onChange={(e) => setCardToken(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Gerado pelo Pagar.me.js na etapa anterior.
            </p>
          </div>
        </div>
      )}

      {/* PIX: no extra inputs */}
      {method === 'pix' && (
        <p className="text-sm text-muted-foreground">
          Após clicar em Pagar, você receberá o QR Code PIX para escanear com o app do seu banco.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button onClick={handlePay} disabled={isPending} className="w-full">
        {isPending
          ? 'Processando...'
          : method === 'pix'
            ? 'Pagar com PIX'
            : `Pagar em ${installments}x`}
      </Button>
    </div>
  )
}
