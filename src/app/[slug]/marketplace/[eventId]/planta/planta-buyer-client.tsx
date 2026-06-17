// FB_EVENTOS — PlantaBuyerClient — client wrapper for buyer-mode planta
// (Phase 2, Plan 02-03).
//
// Holds `selectedLotId` state; passes `onLotClicked` to PlantaEditor and
// renders a CheckoutSidebar stub (real implementation in Plan 02-05).
//
// Split into a separate Client Component so the parent page.tsx stays a
// Server Component (Next.js App Router pattern).

'use client'

import { useState, useTransition } from 'react'
import type { DashboardLotMeta } from '@/components/eventos/planta-editor'
import { PlantaEditorClient } from '@/components/eventos/planta-editor-client'
import { Button } from '@/components/ui/button'
import type { PersistedLotRow } from '@/lib/actions/lots'
import { reserveLotForCurrentVendor } from '@/lib/actions/reservations'

interface DashboardLotItem {
  id: string
  status: string
  priceBRL: number
  categoryName: string
  vendorLegalName: string | null
  colorFill: string
  colorStroke: string
  code: string
  geometry: unknown
  categoryId: string
  areaM2: number
  vendorId: string | null
}

interface PlantaBuyerClientProps {
  eventId: string
  slug: string
  plantaUrl: string | null
  lots: DashboardLotItem[]
  lotStatusMap: Record<string, DashboardLotMeta>
  categories: Array<{ id: string; name: string; color: string | null }>
}

/**
 * Buyer-mode planta + checkout sidebar stub.
 * Plan 02-05 replaces the stub with the real CheckoutSidebar.
 */
export function PlantaBuyerClient({
  eventId,
  slug,
  plantaUrl,
  lots,
  lotStatusMap,
  categories,
}: PlantaBuyerClientProps) {
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null)
  const selectedLotMeta = selectedLotId ? lotStatusMap[selectedLotId] : null

  // Convert DashboardLotItem[] to PersistedLotRow[] for PlantaEditor
  const initialLots: PersistedLotRow[] = lots.map((l) => ({
    id: l.id,
    code: l.code,
    categoryId: l.categoryId,
    // biome-ignore lint/suspicious/noExplicitAny: geometry is jsonb from DB
    geometry: l.geometry as any,
    status: l.status,
    areaM2: l.areaM2,
    eventId,
    tenantId: '',
    updatedAt: new Date(),
    createdAt: new Date(),
  }))

  return (
    <div className="flex gap-6">
      {/* Planta canvas */}
      <div className="flex-1">
        <PlantaEditorClient
          eventId={eventId}
          plantaUrl={plantaUrl}
          plantaContentType={null}
          initialLots={initialLots}
          categories={categories}
          mode="buyer"
          dashboardLots={lotStatusMap}
          onLotClicked={(lotId) => setSelectedLotId(lotId)}
        />
      </div>

      {/* Checkout sidebar — chama reserveLotForCurrentVendor e redireciona
          para /checkout/[reservationId] onde o CheckoutSidebar real
          (Plan 02-05) renderiza PIX/cartão + chama startCheckout. */}
      {selectedLotId && (
        <ReserveLotSidebar
          eventId={eventId}
          slug={slug}
          lotId={selectedLotId}
          lotMeta={selectedLotMeta ?? null}
          onCancel={() => setSelectedLotId(null)}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// ReserveLotSidebar — chama a action e redireciona pro checkout
// ────────────────────────────────────────────────────────────────────────

interface ReserveLotSidebarProps {
  eventId: string
  slug: string
  lotId: string
  lotMeta: DashboardLotMeta | null
  onCancel: () => void
}

function ReserveLotSidebar({ eventId, slug, lotId, lotMeta, onCancel }: ReserveLotSidebarProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    setError(null)
    startTransition(async () => {
      const result = await reserveLotForCurrentVendor({ eventId, lotId })
      if (result?.serverError) {
        setError(
          typeof result.serverError === 'string'
            ? result.serverError
            : 'Falha ao reservar o lote. Tente novamente.',
        )
        return
      }
      const reservationId = result?.data?.reservation_id
      if (!reservationId) {
        setError('Resposta inválida do servidor.')
        return
      }
      // Hard navigate pro checkout — o page do checkout monta o cart +
      // CheckoutSidebar real.
      window.location.assign(`/${slug}/checkout/${reservationId}`)
    })
  }

  return (
    <div
      className="w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="checkout-sidebar"
    >
      <h2 className="text-lg font-semibold text-slate-900">Reservar lote</h2>
      {lotMeta && (
        <div className="mt-2 space-y-2 text-sm text-slate-700">
          <p>
            <span className="text-slate-500">Lote selecionado:</span>{' '}
            <strong>{lotId.slice(0, 8)}…</strong>
          </p>
          <p>
            <span className="text-slate-500">Categoria:</span> {lotMeta.categoryName}
          </p>
          <p>
            <span className="text-slate-500">Preço:</span>{' '}
            {new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(lotMeta.priceBRL)}
          </p>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        A reserva fica válida por 15 minutos. Depois disso o lote volta a ficar disponível para
        outros fornecedores.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <Button type="button" onClick={confirm} disabled={pending} className="w-full">
          {pending ? 'Reservando…' : 'Confirmar reserva e ir para o checkout'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={pending}
          className="w-full"
        >
          Cancelar
        </Button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
