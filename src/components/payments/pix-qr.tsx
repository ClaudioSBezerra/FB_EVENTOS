// FB_EVENTOS — PIX QR display + copia-cola button (Phase 1, Plan 01-06 Task 2).
//
// Pagar.me v5 returns BOTH the QR-code image URL (PNG) AND the EMV-encoded
// copia-cola string. Phase 1 renders the image directly (no QR library
// dependency) and provides a button to copy the EMV string. Fornecedor
// can scan with bank app OR paste into the bank app.

'use client'

import { useState } from 'react'

interface PixQrProps {
  /** PIX QR code image URL (Pagar.me-hosted PNG). */
  qrUrl: string
  /** EMV-encoded PIX string ("copia-cola"). */
  copyPaste: string
  /** Optional expiry timestamp in ISO format. */
  expiresAt?: string | null
}

export function PixQr({ qrUrl, copyPaste, expiresAt }: PixQrProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(copyPaste)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard API can fail (insecure context, permissions). Surface a
      // fallback by selecting the text in the textarea.
      const ta = document.getElementById('pix-copy-paste') as HTMLTextAreaElement | null
      if (ta) {
        ta.select()
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      }
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border bg-card p-6">
      <h3 className="text-lg font-semibold">Pague com PIX</h3>
      {/* biome-ignore lint/performance/noImgElement: external Pagar.me URL, not next/image-able */}
      <img src={qrUrl} alt="QR Code PIX" width={256} height={256} className="rounded border" />
      <p className="text-sm text-muted-foreground">
        Escaneie com o app do seu banco ou copie o código abaixo:
      </p>
      <textarea
        id="pix-copy-paste"
        readOnly
        value={copyPaste}
        className="w-full max-w-md resize-none rounded border bg-muted p-2 font-mono text-xs"
        rows={3}
      />
      <button
        type="button"
        onClick={handleCopy}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {copied ? 'Copiado!' : 'Copiar código PIX'}
      </button>
      {expiresAt ? (
        <p className="text-xs text-muted-foreground">
          Expira em: {new Date(expiresAt).toLocaleString('pt-BR')}
        </p>
      ) : null}
    </div>
  )
}
