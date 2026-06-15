// FB_EVENTOS — Planta uploader client component (Phase 1, Plan 01-02 — Task 2).
//
// Browser-side flow:
//   1. User selects a file via <input type="file">.
//   2. Client-side validation: size ≤ 25 MB + extension in (pdf/png/jpg/jpeg).
//   3. Call `mintEventPlantaUploadUrl` Server Action → receive { url, key }.
//   4. fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type }})
//      — direct browser-to-MinIO upload; the server never sees the bytes.
//   5. On 200: call `confirmEventPlantaUpload({ eventId, key })`. The server
//      then statObjects the upload, verifies content-type + size, deletes
//      the object on mismatch, otherwise stamps events.planta_minio_key
//      and records the audit row.
//   6. Reload the page so the new planta thumbnail appears.

'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { confirmEventPlantaUpload, mintEventPlantaUploadUrl } from '@/lib/actions/minio-presign'
import { PLANTA_ALLOWED_CONTENT_TYPES, PLANTA_MAX_BYTES } from '@/lib/actions/minio-presign.shared'

interface PlantaUploaderProps {
  eventId: string
  tenantSlug: string
}

const ALLOWED_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg'])

type ContentType = (typeof PLANTA_ALLOWED_CONTENT_TYPES)[number]

function isAllowedContentType(ct: string): ct is ContentType {
  return (PLANTA_ALLOWED_CONTENT_TYPES as readonly string[]).includes(ct)
}

export function PlantaUploader({ eventId, tenantSlug }: PlantaUploaderProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setMessage(null)

    // 2. Client-side validation.
    if (file.size > PLANTA_MAX_BYTES) {
      setError(`Arquivo muito grande: ${(file.size / 1024 / 1024).toFixed(1)} MB (máx 25 MB).`)
      return
    }
    const ext = file.name.toLowerCase().split('.').pop() ?? ''
    if (!ALLOWED_EXT.has(ext)) {
      setError('Tipo de arquivo não permitido. Use PDF, PNG ou JPG.')
      return
    }
    if (!isAllowedContentType(file.type)) {
      setError(`Content-Type não permitido: ${file.type || '(vazio)'}.`)
      return
    }
    const contentType: ContentType = file.type

    startTransition(async () => {
      // 3. Mint pre-signed PUT URL via Server Action.
      const mintResult = await mintEventPlantaUploadUrl({
        eventId,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
      })
      if (mintResult?.serverError) {
        setError(
          typeof mintResult.serverError === 'string'
            ? mintResult.serverError
            : 'Falha ao preparar upload.',
        )
        return
      }
      const minted = mintResult?.data
      if (!minted) {
        setError('Resposta inválida do servidor ao preparar upload.')
        return
      }

      // 4. Direct browser → MinIO PUT.
      let putResponse: Response
      try {
        putResponse = await fetch(minted.url, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        })
      } catch (e) {
        setError(`Upload falhou: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      if (!putResponse.ok) {
        setError(`MinIO rejeitou upload (HTTP ${putResponse.status}).`)
        return
      }

      // 5. Confirm via Server Action (statObject + UPDATE + audit).
      const confirmResult = await confirmEventPlantaUpload({
        eventId,
        key: minted.key,
      })
      if (confirmResult?.serverError) {
        setError(
          typeof confirmResult.serverError === 'string'
            ? confirmResult.serverError
            : 'Falha ao confirmar upload.',
        )
        return
      }
      if (!confirmResult?.data) {
        setError('Resposta inválida do servidor ao confirmar upload.')
        return
      }

      setMessage(`Planta enviada com sucesso (${(file.size / 1024).toFixed(0)} KB).`)
      if (inputRef.current) inputRef.current.value = ''
      // 6. Refresh the page to show the new thumbnail.
      router.refresh()
    })
  }

  function onPick() {
    inputRef.current?.click()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  // Reference tenantSlug to silence the linter — kept in props for parity
  // with the event detail page redirect path; reserved for future plans.
  void tenantSlug

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        onChange={onFileChange}
        className="hidden"
      />
      <Button type="button" onClick={onPick} disabled={isPending}>
        {isPending ? 'Enviando…' : 'Enviar planta (PDF / PNG / JPG, máx 25 MB)'}
      </Button>
      {message && <p className="text-sm font-medium text-green-600">{message}</p>}
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
    </div>
  )
}
