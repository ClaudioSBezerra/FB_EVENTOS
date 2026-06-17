// FB_EVENTOS — Admin reset password panel (2026-06-17 emergency).
//
// Renderizado no detail page do user (/admin/usuarios/[userId]). Permite
// que o super_admin defina uma nova senha pro user E marca email_verified
// = true. Usa scrypt do better-auth/crypto pra hash compatível.

'use client'

import { KeyRound } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminResetUserPassword } from '@/lib/actions/admin/usuarios'

interface ResetPasswordFormProps {
  userId: string
  userEmail: string
}

export function AdminResetPasswordForm({ userId, userEmail }: ResetPasswordFormProps) {
  const [newPassword, setNewPassword] = useState('')
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    setDone(false)
    if (newPassword.length < 10) {
      setError('Senha deve ter ao menos 10 caracteres.')
      return
    }
    startTransition(async () => {
      const result = await adminResetUserPassword({ userId, newPassword })
      if (!result.ok) {
        setError(
          result.error === 'no_credential_account'
            ? 'Usuário não tem conta de senha (provavelmente OAuth).'
            : result.error === 'user_not_found'
              ? 'Usuário não encontrado.'
              : 'Falha ao redefinir senha.',
        )
        return
      }
      setDone(true)
      setNewPassword('')
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div>
        <p className="flex items-center gap-1.5 font-semibold text-amber-900">
          <KeyRound className="h-4 w-4" aria-hidden="true" /> Redefinir senha (admin)
        </p>
        <p className="mt-1 text-xs text-amber-800">
          Define uma nova senha pro usuário <strong>{userEmail}</strong> + marca email como
          verificado + invalida sessões ativas. Passe a senha por canal externo (não enviada por
          email pelo sistema).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor="reset-pwd-input" className="block text-xs font-medium text-amber-900">
            Nova senha (mín. 10)
          </label>
          <Input
            id="reset-pwd-input"
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mínimo 10 caracteres"
            className="mt-1"
            disabled={pending || done}
          />
        </div>
        <Button
          type="button"
          onClick={submit}
          disabled={pending || done || newPassword.length < 10}
        >
          {pending ? 'Salvando…' : done ? 'Pronto' : 'Redefinir'}
        </Button>
      </div>

      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
      {done && (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs font-medium text-emerald-900">
          Senha redefinida com sucesso. O usuário precisa fazer login novamente com a nova senha.
        </p>
      )}
    </div>
  )
}
