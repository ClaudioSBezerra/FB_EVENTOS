// FB_EVENTOS — Publish event button (Phase 1 post-MVP, 2026-06-17).
//
// Render no detail page do evento. Mostra status atual + botão pra
// transicionar draft → published. Quando published, o evento aparece no
// /[slug]/marketplace e os fornecedores podem reservar lotes.

'use client'

import { CheckCircle2, Eye, Send } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { publishEvent } from '@/lib/actions/eventos'

interface PublishEventButtonProps {
  eventId: string
  status: string
}

export function PublishEventButton({ eventId, status }: PublishEventButtonProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (status === 'published') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <span className="font-medium text-emerald-900">
          Evento publicado — visível no marketplace para fornecedores.
        </span>
      </div>
    )
  }

  if (status === 'archived') {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Evento arquivado.
      </div>
    )
  }

  function onPublish() {
    setError(null)
    startTransition(async () => {
      const result = await publishEvent({ eventId })
      if (result?.serverError) {
        setError(
          typeof result.serverError === 'string'
            ? result.serverError
            : 'Falha ao publicar o evento.',
        )
        return
      }
      setDone(true)
      setTimeout(() => window.location.reload(), 600)
    })
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <span className="font-medium text-emerald-900">Publicado. Recarregando…</span>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <Eye className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="text-sm text-amber-900">
          <p className="font-semibold">Evento em rascunho</p>
          <p className="mt-1 text-xs">
            Ainda não está visível no marketplace. Cadastre as categorias e os lotes antes de
            publicar — depois de publicado, fornecedores conseguem reservar.
          </p>
        </div>
      </div>
      <Button type="button" onClick={onPublish} disabled={pending}>
        <Send className="mr-1 h-4 w-4" />
        {pending ? 'Publicando…' : 'Publicar no marketplace'}
      </Button>
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
    </div>
  )
}
