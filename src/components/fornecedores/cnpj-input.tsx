// FB_EVENTOS — CNPJ-aware input with live BrasilAPI lookup (Phase 1, Plan 01-04 — Task 2).
//
// Behavior (D-16 2-layer validation):
//   - Mask "XX.XXX.XXX/XXXX-XX" as the user types.
//   - On blur, run Layer 1 (validateCheckDigits) inline; show a red
//     "✗ CNPJ inválido" message if the mod-11 fails.
//   - If Layer 1 passes, fire the Layer 2 Server Action lookupCNPJ in a
//     React Transition. Show a status badge:
//       • verified=true   → "✓ Verificado: <razão social>"
//       • verified=false  → "✗ CNPJ inativo / não encontrado"
//       • verified=null   → "⚠ Não verificado (BrasilAPI indisponível —
//                            você pode prosseguir, será revalidado depois)"
//
// The component is form-agnostic — it exposes `value`, `onChange`,
// `onBlur`, and `name` so React Hook Form can bind via Controller / register.

'use client'

import { forwardRef, useId, useState, useTransition } from 'react'

import { Input } from '@/components/ui/input'
import { lookupCNPJ } from '@/lib/actions/brasilapi'
import { formatCNPJ, normalizeCNPJ, validateCheckDigits } from '@/lib/validators/cnpj'

type LookupBadge =
  | { kind: 'ok'; label: string }
  | { kind: 'inactive'; label: string }
  | { kind: 'degraded'; label: string }
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'invalid'; label: string }

export interface CnpjInputProps {
  /** Current value (string — formatted or raw; component renders formatted). */
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  /** Form field name (for native form submission integration). */
  name?: string
  disabled?: boolean
}

export const CnpjInput = forwardRef<HTMLInputElement, CnpjInputProps>(function CnpjInput(
  { value, onChange, onBlur, name, disabled },
  ref,
) {
  const id = useId()
  const [badge, setBadge] = useState<LookupBadge>({ kind: 'idle' })
  const [, startTransition] = useTransition()

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    // Re-format on every keystroke so the displayed value always tracks
    // the canonical mask. Strip non-digits and re-apply formatCNPJ.
    const digits = normalizeCNPJ(raw).slice(0, 14)
    onChange(digits.length === 14 ? formatCNPJ(digits) : digits)
    setBadge({ kind: 'idle' })
  }

  function handleBlur() {
    onBlur?.()
    const digits = normalizeCNPJ(value)
    if (digits.length === 0) {
      setBadge({ kind: 'idle' })
      return
    }
    if (!validateCheckDigits(digits)) {
      setBadge({ kind: 'invalid', label: 'CNPJ inválido — verifique os dígitos' })
      return
    }
    setBadge({ kind: 'pending' })
    startTransition(async () => {
      const result = await lookupCNPJ({ cnpj: digits })
      if (result?.data) {
        const r = result.data
        if (r.verified === true) {
          const name =
            r.data.razao_social ?? r.data.nome_fantasia ?? '(razão social não disponível)'
          setBadge({ kind: 'ok', label: `Verificado: ${name}` })
          return
        }
        if (r.verified === false) {
          const reason =
            r.reason === 'not_found' ? 'CNPJ não encontrado na Receita' : 'CNPJ inativo / baixado'
          setBadge({ kind: 'inactive', label: reason })
          return
        }
        setBadge({
          kind: 'degraded',
          label: 'BrasilAPI indisponível — registre mesmo assim, será revalidado depois.',
        })
        return
      }
      setBadge({ kind: 'degraded', label: 'Não foi possível verificar agora. Tente novamente.' })
    })
  }

  const badgeColor =
    badge.kind === 'ok'
      ? 'text-emerald-700'
      : badge.kind === 'inactive' || badge.kind === 'invalid'
        ? 'text-red-700'
        : badge.kind === 'degraded'
          ? 'text-amber-700'
          : 'text-slate-500'

  return (
    <div className="space-y-1">
      <Input
        id={id}
        ref={ref}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="XX.XXX.XXX/XXXX-XX"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        maxLength={18}
      />
      {badge.kind !== 'idle' && (
        <p className={`text-xs ${badgeColor}`}>
          {badge.kind === 'pending' && '⏳ Consultando BrasilAPI…'}
          {badge.kind === 'ok' && `✓ ${badge.label}`}
          {badge.kind === 'inactive' && `✗ ${badge.label}`}
          {badge.kind === 'degraded' && `⚠ ${badge.label}`}
          {badge.kind === 'invalid' && `✗ ${badge.label}`}
        </p>
      )}
    </div>
  )
})
