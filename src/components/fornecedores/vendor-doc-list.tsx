// FB_EVENTOS — Vendor doc list (Phase 1, Plan 01-04 — Task 3).
//
// Client Component so the "Baixar" button can call mintVendorDocDownloadUrl
// (Server Action) and `window.open(url)` with the freshly-minted GET URL.
// Each click triggers a Server Action invocation → audit_log row is
// written for EVERY download (LGPD access trail).

'use client'

import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { deleteVendorDoc, mintVendorDocDownloadUrl } from '@/lib/actions/vendor-docs'
import type { PersistedVendorDoc } from '@/lib/actions/vendor-docs.shared'

export interface VendorDocListProps {
  tenantSlug: string
  vendorId: string
  docs: PersistedVendorDoc[]
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function VendorDocList({ docs }: VendorDocListProps) {
  const [, startTransition] = useTransition()

  if (docs.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-600">
        Nenhum documento enviado ainda.
      </p>
    )
  }

  function handleDownload(docId: string) {
    startTransition(async () => {
      const r = await mintVendorDocDownloadUrl({ docId })
      if (r?.data?.url) {
        window.open(r.data.url, '_blank', 'noopener,noreferrer')
      }
    })
  }

  function handleDelete(docId: string) {
    if (!window.confirm('Remover este documento?')) return
    startTransition(async () => {
      await deleteVendorDoc({ docId })
      window.location.reload()
    })
  }

  return (
    <ul className="space-y-2">
      {docs.map((d) => (
        <li
          key={d.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm"
        >
          <div>
            <p className="font-medium">{d.docType}</p>
            <p className="text-xs text-slate-600">
              {d.contentType ?? 'arquivo'} — {formatSize(d.sizeBytes)} —{' '}
              {dateFmt.format(d.uploadedAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleDownload(d.id)}>
              Baixar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(d.id)}>
              Remover
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
