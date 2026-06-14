// FB_EVENTOS — Vendor doc uploader (Phase 1, Plan 01-04 — Task 3).
//
// Browser uploads directly to MinIO via pre-signed PUT (D-05; bytes never
// pass through the Next.js server). Two-step flow:
//
//   1. POST mintVendorDocUploadUrl({vendorId, fileName, contentType, sizeBytes})
//      → server returns { url, key, bucket, expiresAt }.
//   2. PUT the bytes to `url` with the right Content-Type header.
//   3. POST confirmVendorDocUpload({vendorId, key, docType}) → server runs
//      statObject + INSERT + audit.
//
// Doc-type select offers the canonical Phase 1 categories (rg, contrato
// social, comprovante de endereço, cnpj card, outros). Free-form via
// "outros".

'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  confirmVendorDocUpload,
  mintVendorDocUploadUrl,
  VENDOR_DOC_ALLOWED_CONTENT_TYPES,
  VENDOR_DOC_MAX_BYTES,
} from '@/lib/actions/vendor-docs'

const DOC_TYPE_OPTIONS = [
  { value: 'rg', label: 'RG / CPF' },
  { value: 'contrato_social', label: 'Contrato social' },
  { value: 'comprovante_endereco', label: 'Comprovante de endereço' },
  { value: 'cnpj_card', label: 'Cartão CNPJ' },
  { value: 'outros', label: 'Outros' },
] as const

export interface VendorDocUploaderProps {
  tenantSlug: string
  vendorId: string
}

type AllowedContentType = (typeof VENDOR_DOC_ALLOWED_CONTENT_TYPES)[number]

function isAllowedContentType(s: string): s is AllowedContentType {
  return (VENDOR_DOC_ALLOWED_CONTENT_TYPES as readonly string[]).includes(s)
}

export function VendorDocUploader({ vendorId }: VendorDocUploaderProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [docType, setDocType] = useState<string>('outros')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleUpload(file: File) {
    setError(null)
    setSuccess(null)
    if (!isAllowedContentType(file.type)) {
      setError(`Tipo de arquivo não permitido: ${file.type}. Aceitos: PDF, PNG, JPG.`)
      return
    }
    if (file.size > VENDOR_DOC_MAX_BYTES) {
      setError(`Arquivo excede o limite de 25 MB.`)
      return
    }

    // Step 1 — mint pre-signed PUT URL.
    const mintResult = await mintVendorDocUploadUrl({
      vendorId,
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
    if (mintResult?.serverError) {
      setError(
        typeof mintResult.serverError === 'string'
          ? mintResult.serverError
          : 'Erro ao preparar upload.',
      )
      return
    }
    const minted = mintResult?.data
    if (!minted) {
      setError('Não foi possível obter URL de upload.')
      return
    }

    // Step 2 — PUT the bytes directly to MinIO.
    const putResp = await fetch(minted.url, {
      method: 'PUT',
      headers: { 'Content-Type': minted.contentType },
      body: file,
    })
    if (!putResp.ok) {
      setError(`Falha no upload: HTTP ${putResp.status}`)
      return
    }

    // Step 3 — confirm upload server-side (statObject + INSERT + audit).
    const confirmResult = await confirmVendorDocUpload({
      vendorId,
      key: minted.key,
      docType,
    })
    if (confirmResult?.serverError) {
      setError(
        typeof confirmResult.serverError === 'string'
          ? confirmResult.serverError
          : 'Erro ao confirmar upload.',
      )
      return
    }
    setSuccess(`Documento "${file.name}" enviado.`)
    if (fileInputRef.current) fileInputRef.current.value = ''
    router.refresh()
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    startTransition(() => handleUpload(file))
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="vendor-doc-type" className="text-xs font-medium text-slate-700">
            Tipo de documento
          </label>
          <select
            id="vendor-doc-type"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="h-9 rounded-md border border-slate-300 px-2 text-sm"
          >
            {DOC_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 space-y-1">
          <label htmlFor="vendor-doc-file" className="text-xs font-medium text-slate-700">
            Arquivo (PDF / PNG / JPG, máx. 25 MB)
          </label>
          <Input
            id="vendor-doc-file"
            ref={fileInputRef}
            type="file"
            accept={VENDOR_DOC_ALLOWED_CONTENT_TYPES.join(',')}
            onChange={onFileChange}
            disabled={isPending}
          />
        </div>
        <Button type="button" disabled={isPending} onClick={() => fileInputRef.current?.click()}>
          {isPending ? 'Enviando…' : 'Enviar'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-emerald-700">{success}</p>}
    </div>
  )
}
