// FB_EVENTOS — Konva planta editor client component
// (Phase 1, Plan 01-03 — Task 2).
//
// Tenant-scoped editor at /[slug]/eventos/[eventId]/planta:
//   - Renders the planta image (PDF page 1 rendered to canvas via pdf.js OR
//     raw PNG/JPG) as the Konva background layer.
//   - Renders existing lots as Konva.Line(closed) polygons, click to select.
//   - Toolbar:
//       - "Selecionar": click an existing polygon to edit (Transformer).
//       - "Novo polígono": click vertices on the canvas; double-click to
//         close → POST createLot.
//       - "Excluir": deletes the selected polygon.
//   - Auto-save: per-lot, debounce 1000ms (D-11). Drag-end / transform-end
//     bake the offset/scale into the points array (RESEARCH §A5 pitfall 4).
//   - Save indicator: idle / saving / saved / error.
//
// PDF.js worker registration: pdfjs-dist ships pdf.worker.min.mjs in
// node_modules/pdfjs-dist/build/. We register the worker at module init.
// In dev/Coolify production, the worker is bundled via Next.js' default
// chunk emission (dynamic import). If that ever fails, copy the worker to
// /public/pdf.worker.min.mjs and point GlobalWorkerOptions.workerSrc to it.

'use client'

import type { KonvaEventObject } from 'konva/lib/Node'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { createLot, deleteLot, type PersistedLotRow, updateLotGeometry } from '@/lib/actions/lots'
import type { Geometry, Polygon2DGeometry } from '@/lib/validators/geometry'

// react-konva touches `window.Konva` on import → dynamic import to keep it
// out of the SSR bundle.
// IMPORTANTE: Next.js 15 dynamic() exige que o factory retorne um objeto
// com `.default` apontando pro componente. react-konva exporta os
// componentes como named exports (m.Stage, m.Layer, …) — passar
// `(m) => m.Layer` direto faz o Next.js bater no `Cannot use 'in' operator
// to search for 'default' in Layer` quando hidrata o componente.
// Envolver em `{ default: m.X }` é a forma canônica.
const Stage = dynamic(() => import('react-konva').then((m) => ({ default: m.Stage })), {
  ssr: false,
})
const Layer = dynamic(() => import('react-konva').then((m) => ({ default: m.Layer })), {
  ssr: false,
})
const KImage = dynamic(() => import('react-konva').then((m) => ({ default: m.Image })), {
  ssr: false,
})
const Line = dynamic(() => import('react-konva').then((m) => ({ default: m.Line })), {
  ssr: false,
})
const Transformer = dynamic(() => import('react-konva').then((m) => ({ default: m.Transformer })), {
  ssr: false,
})

const STAGE_WIDTH = 1200
const STAGE_HEIGHT = 800
const DEBOUNCE_MS = 1000
const DEFAULT_FILL = '#22c55e'
const DEFAULT_STROKE = '#15803d'

type EditorMode = 'select' | 'draw'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Display mode for the planta canvas.
 *   - 'editor'    — full Konva editor with Transformer, draw/select toolbar,
 *                   auto-save (Plan 01-03).
 *   - 'dashboard' — read-only render with lots colored by status, click opens
 *                   a popover with lot details. No toolbar, no transformer,
 *                   no drag. (Plan 01-07.)
 *   - 'buyer'     — marketplace view: same color scheme but click only fires
 *                   onLotClicked for available lots; sold/reserved lots have
 *                   cursor:not-allowed and block interaction. SSE subscription
 *                   updates lot colors in real time (Plan 02-03/02-04).
 */
export type PlantaEditorMode = 'editor' | 'dashboard' | 'buyer'

/**
 * Dashboard-mode lot meta consumed by the popover. The fill/stroke hex
 * comes from src/lib/actions/dashboard.ts getLotColorForStatus().
 */
export interface DashboardLotMeta {
  id: string
  status: string
  priceBRL: number
  categoryName: string
  vendorLegalName: string | null
  colorFill: string
  colorStroke: string
}

interface LotState {
  id: string
  code: string
  categoryId: string
  geometry: Polygon2DGeometry
  /** Optional category color (passed in from server). */
  color?: string | null
}

interface CategoryOption {
  id: string
  name: string
  color: string | null
}

interface PlantaEditorProps {
  eventId: string
  plantaUrl: string | null
  plantaContentType: string | null
  initialLots: PersistedLotRow[]
  categories: CategoryOption[]
  /** Defaults to 'editor'. Set to 'dashboard' for the read-only occupancy view. */
  mode?: PlantaEditorMode
  /**
   * Required when `mode='dashboard'` or `mode='buyer'`. Indexed by lot id; the
   * dashboard/buyer render fills/strokes lots using these colors and the popover
   * reads vendor + price from this map.
   */
  dashboardLots?: Record<string, DashboardLotMeta>
  /**
   * Buyer-mode callback. Called when a fornecedor clicks an *available* lot.
   * Not called for sold or reserved lots (cursor:not-allowed intercepts).
   */
  onLotClicked?: (lotId: string) => void
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function polygonFromRow(row: PersistedLotRow): LotState {
  const g = row.geometry as Geometry
  if (g.type !== 'polygon2d') {
    throw new Error(`Editor only supports polygon2d (got ${g.type})`)
  }
  return {
    id: row.id,
    code: row.code,
    categoryId: row.categoryId,
    geometry: g,
  }
}

function flattenPoints(points: Array<[number, number]>): number[] {
  const out: number[] = []
  for (const [x, y] of points) {
    out.push(x, y)
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// pdf.js → canvas → background image helper
// ────────────────────────────────────────────────────────────────────────────

async function pdfToCanvas(pdfUrl: string): Promise<HTMLCanvasElement> {
  // Dynamic-import pdfjs-dist client-side only. The package ships ESM.
  const pdfjsLib = await import('pdfjs-dist')
  // Register the worker. We point to /pdf.worker.min.mjs under /public so
  // the same path resolves in dev + Next.js standalone production builds.
  // (See RESEARCH §pdf.js worker path; node_modules/pdfjs-dist/build/
  // ships the file that the build step can copy to /public if needed.)
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  }

  const loadingTask = pdfjsLib.getDocument(pdfUrl)
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Cannot acquire 2D canvas context for PDF render')
  // pdf.js v4: render() now takes the canvas directly via the API surface
  // that accepts a CanvasRenderingContext2D under `canvasContext`.
  // biome-ignore lint/suspicious/noExplicitAny: pdfjs render params differ across minor versions
  await (page.render({ canvasContext: ctx, viewport } as any).promise as Promise<void>)
  return canvas
}

// ────────────────────────────────────────────────────────────────────────────
// Editor component
// ────────────────────────────────────────────────────────────────────────────

/**
 * Buyer-mode lot colors (plan 02-03).
 * available → green, reserved → grey, sold → red.
 */
function getBuyerLotColor(status: string): { fill: string; stroke: string } {
  switch (status) {
    case 'available':
      return { fill: '#10b981', stroke: '#059669' } // emerald
    case 'reserved':
      return { fill: '#9ca3af', stroke: '#6b7280' } // grey
    case 'sold':
      return { fill: '#ef4444', stroke: '#dc2626' } // red
    default:
      return { fill: '#9ca3af', stroke: '#6b7280' }
  }
}

export function PlantaEditor({
  eventId,
  plantaUrl,
  plantaContentType,
  initialLots,
  categories,
  mode: displayMode = 'editor',
  dashboardLots,
  onLotClicked,
}: PlantaEditorProps) {
  const isDashboard = displayMode === 'dashboard'
  const isBuyer = displayMode === 'buyer'
  const [lots, setLots] = useState<LotState[]>(() => initialLots.map(polygonFromRow))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<EditorMode>('select')
  const [drawPoints, setDrawPoints] = useState<Array<[number, number]>>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string>(categories[0]?.id ?? '')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [backgroundImage, setBackgroundImage] = useState<
    HTMLImageElement | HTMLCanvasElement | null
  >(null)
  // Dashboard-mode popover: tracks the clicked lot + screen-space position.
  const [popover, setPopover] = useState<{
    lotId: string
    x: number
    y: number
  } | null>(null)

  // Buyer-mode: live lot status overrides from SSE (plan 02-04 wires the handler).
  // Indexed by lot_id → status string. Starts empty; SSE messages update it.
  const [buyerLotStatuses, setBuyerLotStatuses] = useState<Record<string, string>>(() => {
    // Pre-populate from dashboardLots so the initial render shows correct colors
    if (!dashboardLots) return {}
    const m: Record<string, string> = {}
    for (const [id, meta] of Object.entries(dashboardLots)) {
      m[id] = meta.status
    }
    return m
  })

  // Refs the Transformer uses.
  // biome-ignore lint/suspicious/noExplicitAny: Konva node typing is internal
  const transformerRef = useRef<any>(null)
  // biome-ignore lint/suspicious/noExplicitAny: Konva node typing is internal
  const lotNodesRef = useRef<Record<string, any>>({})

  // Per-lot debounce timers. Map<lotId, timeoutId>.
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // ──────────────────────────────────────────────────────────────────────
  // Background load (PDF → canvas | image)
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!plantaUrl) {
      setBackgroundImage(null)
      return
    }
    async function load() {
      try {
        if (plantaContentType === 'application/pdf') {
          if (!plantaUrl) return
          const canvas = await pdfToCanvas(plantaUrl)
          if (!cancelled) setBackgroundImage(canvas)
        } else {
          if (!plantaUrl) return
          const img = new window.Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => {
            if (!cancelled) setBackgroundImage(img)
          }
          img.src = plantaUrl
        }
      } catch (err) {
        console.error('Failed to load planta background:', err)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [plantaUrl, plantaContentType])

  // ──────────────────────────────────────────────────────────────────────
  // SSE subscription — buyer mode only (Plan 02-03 producer side)
  // The SSE Route Handler is implemented in Plan 02-04. This useEffect
  // only establishes the EventSource connection; the handler validates
  // the session before opening the stream.
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isBuyer) return
    const url = `/api/sse/events/${eventId}/lots`
    const es = new EventSource(url)
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { lot_id: string; new_status: string }
        if (data.lot_id && data.new_status) {
          setBuyerLotStatuses((prev) => ({ ...prev, [data.lot_id]: data.new_status }))
        }
      } catch {
        // Malformed SSE payload — ignore
      }
    }
    return () => {
      es.close()
    }
  }, [eventId, isBuyer])

  // ──────────────────────────────────────────────────────────────────────
  // Transformer attach to selected
  // ──────────────────────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: `lots` is intentional — when the lots list mutates (new polygon created), the Transformer must re-attach to the ref that was just registered.
  useEffect(() => {
    if (isDashboard) return // No Transformer in read-only dashboard mode.
    const transformer = transformerRef.current
    if (!transformer) return
    if (mode === 'select' && selectedId && lotNodesRef.current[selectedId]) {
      transformer.nodes([lotNodesRef.current[selectedId]])
      transformer.getLayer()?.batchDraw()
    } else {
      transformer.nodes([])
      transformer.getLayer()?.batchDraw()
    }
  }, [selectedId, mode, lots, isDashboard])

  // ──────────────────────────────────────────────────────────────────────
  // Auto-save (per-lot debounce 1000ms)
  // ──────────────────────────────────────────────────────────────────────
  const scheduleSave = useCallback((lotId: string, geometry: Polygon2DGeometry) => {
    const existing = debounceTimers.current.get(lotId)
    if (existing) clearTimeout(existing)
    setSaveStatus('saving')
    const timer = setTimeout(async () => {
      try {
        const result = await updateLotGeometry({ lotId, geometry })
        if (result?.serverError) {
          setSaveStatus('error')
          return
        }
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, DEBOUNCE_MS)
    debounceTimers.current.set(lotId, timer)
  }, [])

  // Cleanup on unmount.
  useEffect(() => {
    const map = debounceTimers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  // ──────────────────────────────────────────────────────────────────────
  // Polygon mutation handlers
  // ──────────────────────────────────────────────────────────────────────

  const onPolygonDragEnd = useCallback(
    (lotId: string, e: KonvaEventObject<DragEvent>) => {
      // biome-ignore lint/suspicious/noExplicitAny: Konva node typing internal
      const node = e.target as any
      const dx = node.x()
      const dy = node.y()
      setLots((prev) =>
        prev.map((l) => {
          if (l.id !== lotId) return l
          const newPoints = l.geometry.points.map(([x, y]) => [x + dx, y + dy] as [number, number])
          const nextGeom: Polygon2DGeometry = { ...l.geometry, points: newPoints }
          // Bake offset into points, reset node position so next drag delta is zero.
          node.x(0)
          node.y(0)
          node.points(flattenPoints(newPoints))
          scheduleSave(lotId, nextGeom)
          return { ...l, geometry: nextGeom }
        }),
      )
    },
    [scheduleSave],
  )

  const onPolygonTransformEnd = useCallback(
    (lotId: string, e: KonvaEventObject<Event>) => {
      // biome-ignore lint/suspicious/noExplicitAny: Konva node typing internal
      const node = e.target as any
      const sx = node.scaleX()
      const sy = node.scaleY()
      const dx = node.x()
      const dy = node.y()
      setLots((prev) =>
        prev.map((l) => {
          if (l.id !== lotId) return l
          // CRITICAL (RESEARCH §A5 pitfall 4): Transformer mutates
          // scaleX/scaleY, NOT the points array. Bake the scale + position
          // into points, then reset both to identity so future transforms
          // don't compound.
          const newPoints = l.geometry.points.map(
            ([x, y]) => [x * sx + dx, y * sy + dy] as [number, number],
          )
          const nextGeom: Polygon2DGeometry = { ...l.geometry, points: newPoints }
          node.scaleX(1)
          node.scaleY(1)
          node.x(0)
          node.y(0)
          node.points(flattenPoints(newPoints))
          scheduleSave(lotId, nextGeom)
          return { ...l, geometry: nextGeom }
        }),
      )
    },
    [scheduleSave],
  )

  // ──────────────────────────────────────────────────────────────────────
  // Draw mode: collect points + close on double-click
  // ──────────────────────────────────────────────────────────────────────

  const onStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (mode !== 'draw') return
      // biome-ignore lint/suspicious/noExplicitAny: Konva stage typing
      const stage = e.target.getStage?.() as any
      const pos = stage?.getPointerPosition?.()
      if (!pos) return
      setDrawPoints((prev) => [...prev, [pos.x, pos.y]])
    },
    [mode],
  )

  const finalizePolygon = useCallback(async () => {
    if (drawPoints.length < 3) {
      setDrawPoints([])
      setMode('select')
      return
    }
    if (!activeCategoryId) {
      setSaveStatus('error')
      setDrawPoints([])
      return
    }
    const newGeom: Polygon2DGeometry = {
      version: 1,
      type: 'polygon2d',
      points: drawPoints,
      z_index: 0,
    }
    const nextCode = `L-${lots.length + 1}`
    setSaveStatus('saving')
    try {
      const res = await createLot({
        eventId,
        categoryId: activeCategoryId,
        code: nextCode,
        geometry: newGeom,
      })
      if (res?.serverError) {
        setSaveStatus('error')
        return
      }
      if (res?.data) {
        setLots((prev) => [
          ...prev,
          {
            id: res.data.id,
            code: res.data.code,
            categoryId: res.data.categoryId,
            geometry: res.data.geometry as Polygon2DGeometry,
          },
        ])
        setSaveStatus('saved')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setDrawPoints([])
      setMode('select')
    }
  }, [drawPoints, activeCategoryId, eventId, lots.length])

  const onStageDblClick = useCallback(() => {
    if (mode === 'draw') {
      void finalizePolygon()
    }
  }, [mode, finalizePolygon])

  // ──────────────────────────────────────────────────────────────────────
  // Delete selected
  // ──────────────────────────────────────────────────────────────────────

  const onDeleteSelected = useCallback(async () => {
    if (!selectedId) return
    setSaveStatus('saving')
    try {
      const res = await deleteLot({ lotId: selectedId })
      if (res?.serverError) {
        setSaveStatus('error')
        return
      }
      setLots((prev) => prev.filter((l) => l.id !== selectedId))
      setSelectedId(null)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [selectedId])

  // ──────────────────────────────────────────────────────────────────────
  // Status indicator label
  // ──────────────────────────────────────────────────────────────────────

  const statusLabel = useMemo(() => {
    switch (saveStatus) {
      case 'idle':
        return 'Pronto'
      case 'saving':
        return 'Salvando…'
      case 'saved':
        return 'Salvo'
      case 'error':
        return 'Erro ao salvar'
    }
  }, [saveStatus])

  const categoryById = useMemo(() => {
    const m = new Map<string, CategoryOption>()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  // ──────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3" data-testid="planta-editor" data-mode={displayMode}>
      {/* Toolbar — editor mode only. Dashboard/buyer mode renders a small legend. */}
      {isDashboard || isBuyer ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border bg-slate-50 px-3 py-2 text-xs"
          data-testid="planta-legend"
        >
          <span className="font-medium text-slate-700">Legenda:</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500" /> Disponível
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-amber-500" /> Reservado
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-500" /> Vendido
          </span>
          <span className="ml-auto text-slate-500">
            {isBuyer
              ? 'Clique em um lote disponível para reservar.'
              : 'Clique em um lote para detalhes.'}
          </span>
        </div>
      ) : (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border bg-slate-50 p-2"
          data-testid="planta-toolbar"
        >
          <Button
            type="button"
            variant={mode === 'select' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setMode('select')
              setDrawPoints([])
            }}
          >
            Selecionar
          </Button>
          <Button
            type="button"
            variant={mode === 'draw' ? 'default' : 'outline'}
            size="sm"
            disabled={!activeCategoryId}
            onClick={() => {
              setMode('draw')
              setSelectedId(null)
            }}
          >
            Novo polígono
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selectedId}
            onClick={() => {
              void onDeleteSelected()
            }}
          >
            Excluir
          </Button>

          {categories.length > 0 && (
            <label className="ml-2 flex items-center gap-2 text-sm">
              Categoria:
              <select
                className="rounded border px-2 py-1 text-sm"
                value={activeCategoryId}
                onChange={(e) => setActiveCategoryId(e.target.value)}
                data-testid="planta-category-select"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <span
            className="ml-auto rounded bg-white px-2 py-1 text-xs text-slate-600"
            data-testid="planta-save-status"
            data-status={saveStatus}
          >
            {statusLabel}
          </span>
        </div>
      )}

      {/* Canvas */}
      <div
        className="relative overflow-hidden rounded-md border bg-slate-100"
        data-testid="planta-canvas"
      >
        <Stage
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          onClick={isDashboard || isBuyer ? undefined : onStageClick}
          onDblClick={isDashboard || isBuyer ? undefined : onStageDblClick}
        >
          <Layer>
            {backgroundImage && (
              <KImage
                image={backgroundImage}
                listening={false}
                width={STAGE_WIDTH}
                height={STAGE_HEIGHT}
              />
            )}
            {lots.map((lot) => {
              // Dashboard/buyer mode: status colors from dashboardLots map.
              // Buyer mode: live overrides from buyerLotStatuses (SSE updates).
              // Editor mode: category color (Plan 01-03 behavior, unchanged).
              let fill: string
              let stroke: string

              if (isBuyer) {
                // Buyer mode: use live status (SSE override) or dashboardLots fallback
                const liveStatus =
                  buyerLotStatuses[lot.id] ?? dashboardLots?.[lot.id]?.status ?? 'available'
                const colors = getBuyerLotColor(liveStatus)
                fill = `${colors.fill}66` // 40% opacity
                stroke = colors.stroke
              } else if (isDashboard && dashboardLots?.[lot.id]) {
                const meta = dashboardLots[lot.id]
                if (meta) {
                  fill = `${meta.colorFill}40`
                  stroke = meta.colorStroke
                } else {
                  fill = `${DEFAULT_FILL}40`
                  stroke = DEFAULT_STROKE
                }
              } else {
                const cat = categoryById.get(lot.categoryId)
                fill = `${cat?.color ?? lot.geometry.fill ?? DEFAULT_FILL}40`
                stroke = lot.geometry.stroke ?? DEFAULT_STROKE
              }

              // Buyer mode: determine if the lot is clickable
              const liveStatus = isBuyer
                ? (buyerLotStatuses[lot.id] ?? dashboardLots?.[lot.id]?.status ?? 'available')
                : null
              const buyerClickable = isBuyer && liveStatus === 'available'

              return (
                <Line
                  key={lot.id}
                  ref={(node: unknown) => {
                    if (node) lotNodesRef.current[lot.id] = node
                  }}
                  points={flattenPoints(lot.geometry.points)}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={lot.geometry.stroke_width ?? 2}
                  closed
                  // Buyer mode: non-available lots block interaction (listening=false)
                  listening={isBuyer ? buyerClickable : true}
                  draggable={!isDashboard && !isBuyer && mode === 'select'}
                  onClick={(e: KonvaEventObject<MouseEvent>) => {
                    if (isBuyer) {
                      // Only available lots reach here (listening=false for others)
                      onLotClicked?.(lot.id)
                      return
                    }
                    if (isDashboard) {
                      // Open the dashboard popover near the click point.
                      // biome-ignore lint/suspicious/noExplicitAny: Konva stage typing
                      const stage = e.target.getStage?.() as any
                      const pos = stage?.getPointerPosition?.()
                      if (pos) setPopover({ lotId: lot.id, x: pos.x, y: pos.y })
                      return
                    }
                    if (mode === 'select') setSelectedId(lot.id)
                  }}
                  onDragEnd={
                    isDashboard
                      ? undefined
                      : (e: KonvaEventObject<DragEvent>) => onPolygonDragEnd(lot.id, e)
                  }
                  onTransformEnd={
                    isDashboard
                      ? undefined
                      : (e: KonvaEventObject<Event>) => onPolygonTransformEnd(lot.id, e)
                  }
                  data-lot-id={lot.id}
                />
              )
            })}
            {/* In-progress polygon while in draw mode (editor only) */}
            {!isDashboard && !isBuyer && mode === 'draw' && drawPoints.length > 0 && (
              <Line
                points={flattenPoints(drawPoints)}
                stroke={DEFAULT_STROKE}
                strokeWidth={2}
                dash={[6, 4]}
                closed={false}
                listening={false}
              />
            )}
            {!isDashboard && !isBuyer && mode === 'select' && (
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                anchorSize={10}
                // Prevent zero-size polygons after extreme down-scale.
                // biome-ignore lint/suspicious/noExplicitAny: Konva Box type lives in konva/lib/Shape and is internal
                boundBoxFunc={(oldBox: any, newBox: any) =>
                  newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
                }
              />
            )}
          </Layer>
        </Stage>

        {/* Dashboard popover (absolute over the canvas). Click outside to close. */}
        {isDashboard && !isBuyer && popover && dashboardLots?.[popover.lotId] ? (
          <DashboardLotPopover
            anchorX={popover.x}
            anchorY={popover.y}
            lotCode={lots.find((l) => l.id === popover.lotId)?.code ?? '—'}
            // biome-ignore lint/style/noNonNullAssertion: guarded by the outer ternary condition
            meta={dashboardLots[popover.lotId]!}
            onClose={() => setPopover(null)}
          />
        ) : null}
      </div>

      {/* Selected lot meta (editor mode only) */}
      {!isDashboard && !isBuyer && selectedId && (
        <p className="text-xs text-slate-600" data-testid="planta-selected-meta">
          Selecionado: <strong>{lots.find((l) => l.id === selectedId)?.code ?? '—'}</strong>
        </p>
      )}
      {!isDashboard && !isBuyer && mode === 'draw' && (
        <p className="text-xs text-slate-600">
          Clique para adicionar vértices ({drawPoints.length} ponto
          {drawPoints.length === 1 ? '' : 's'}); duplo-clique fecha o polígono (mínimo 3).
        </p>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard popover — simple absolute-positioned card over the canvas
// (Plan 01-07: avoids adding @radix-ui/react-popover; matches the project's
// "minimal-shadcn" style of inline divs.)
// ────────────────────────────────────────────────────────────────────────────

interface DashboardLotPopoverProps {
  anchorX: number
  anchorY: number
  lotCode: string
  meta: DashboardLotMeta
  onClose: () => void
}

const STATUS_LABEL_PTBR: Record<string, string> = {
  available: 'Disponível',
  reserved: 'Reservado',
  sold: 'Vendido',
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function DashboardLotPopover({
  anchorX,
  anchorY,
  lotCode,
  meta,
  onClose,
}: DashboardLotPopoverProps) {
  // Clamp the popover so it doesn't escape the canvas. Stage width/height are
  // the constants from above (1200×800). A 240×140 popover with a 12px gap.
  const POPOVER_W = 240
  const POPOVER_H = 140
  const left = Math.min(Math.max(anchorX + 12, 0), STAGE_WIDTH - POPOVER_W)
  const top = Math.min(Math.max(anchorY + 12, 0), STAGE_HEIGHT - POPOVER_H)
  const statusLabel = STATUS_LABEL_PTBR[meta.status] ?? meta.status
  return (
    <div
      className="absolute z-10 w-60 rounded-md border border-slate-200 bg-white p-3 shadow-lg"
      style={{ left, top }}
      data-testid="planta-dashboard-popover"
      data-lot-id={meta.id}
    >
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Lote {lotCode}</p>
          <p className="text-xs text-slate-500">{meta.categoryName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded text-slate-400 hover:text-slate-700"
          aria-label="Fechar"
        >
          ×
        </button>
      </div>
      <dl className="space-y-1 text-xs text-slate-700">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Status:</dt>
          <dd className="font-medium" style={{ color: meta.colorStroke }}>
            {statusLabel}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Preço:</dt>
          <dd className="font-medium">{formatBRL(meta.priceBRL)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Fornecedor:</dt>
          <dd className="font-medium text-right">{meta.vendorLegalName ?? '—'}</dd>
        </div>
      </dl>
    </div>
  )
}
