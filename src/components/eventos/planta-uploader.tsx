// FB_EVENTOS — Planta uploader (Phase 1, Plan 01-02 — Task 1 stub).
//
// Task 1 ships a stub so the event detail page compiles; Task 2 replaces
// this implementation with a full pre-signed PUT → MinIO → statObject flow.

'use client'

interface PlantaUploaderProps {
  eventId: string
  tenantSlug: string
}

export function PlantaUploader(_props: PlantaUploaderProps) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
      Upload da planta — disponível em breve.
    </div>
  )
}
