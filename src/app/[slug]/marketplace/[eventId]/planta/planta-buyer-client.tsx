// FB_EVENTOS — PlantaBuyerClient — client wrapper for buyer-mode planta
// (Phase 2, Plan 02-03).
//
// Holds `selectedLotId` state; passes `onLotClicked` to PlantaEditor and
// renders a CheckoutSidebar stub (real implementation in Plan 02-05).
//
// Split into a separate Client Component so the parent page.tsx stays a
// Server Component (Next.js App Router pattern).

'use client'

import { useState } from 'react'
import type { DashboardLotMeta } from '@/components/eventos/planta-editor'
import { PlantaEditorClient } from '@/components/eventos/planta-editor-client'
import type { PersistedLotRow } from '@/lib/actions/lots'

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
  slug: _slug,
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

      {/* Checkout sidebar stub — Plan 02-05 fills this in */}
      {selectedLotId && (
        <div
          className="w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          data-testid="checkout-sidebar"
        >
          <h2 className="text-lg font-semibold text-slate-900">Reservar lote</h2>
          {selectedLotMeta && (
            <div className="mt-2 space-y-2 text-sm text-slate-700">
              <p>
                <span className="text-slate-500">Lote selecionado:</span>{' '}
                <strong>{selectedLotId.slice(0, 8)}…</strong>
              </p>
              <p>
                <span className="text-slate-500">Categoria:</span> {selectedLotMeta.categoryName}
              </p>
              <p>
                <span className="text-slate-500">Preço:</span>{' '}
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                  selectedLotMeta.priceBRL,
                )}
              </p>
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500 italic">
            Lote {selectedLotId.slice(0, 8)} — checkout em breve (Plan 02-05)
          </p>
          <button
            type="button"
            className="mt-3 text-xs text-slate-400 underline"
            onClick={() => setSelectedLotId(null)}
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
