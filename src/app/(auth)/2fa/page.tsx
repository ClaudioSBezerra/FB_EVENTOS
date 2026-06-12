// FB_EVENTOS — 2FA TOTP enrollment page (Phase 0, Plan 04 — Task 2).
//
// AUTH-05. Lets an owner-role account enroll TOTP and view recovery codes.
// The actual enrollment flow uses better-auth's twoFactor.enable client
// method; this page exposes the entry point. Full QR-code UX lands in
// Phase 1+ as the user-management story matures.

'use client'

import { useState } from 'react'

import { authClient } from '@/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function TwoFactorPage() {
  const [secret, setSecret] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)

  async function onEnable() {
    setErr(null)
    try {
      const res = await authClient.twoFactor.enable({ password: '' }).catch(() => null)
      // The actual surface returns a totpURI/secret + backup codes; we render
      // whatever Better Auth provides.
      // biome-ignore lint/suspicious/noExplicitAny: better-auth twoFactor return shape evolves
      const data = (res?.data ?? null) as any
      if (data?.totpURI) setSecret(data.totpURI as string)
      if (Array.isArray(data?.backupCodes)) setBackupCodes(data.backupCodes as string[])
      if (!data) setErr('Não foi possível ativar 2FA. Refaça o login e tente novamente.')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Autenticação em dois fatores (2FA)</CardTitle>
          <CardDescription>
            Aumente a segurança da sua conta habilitando TOTP (Google Authenticator, Authy,
            1Password).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!secret && (
            <Button onClick={onEnable} className="w-full">
              Ativar 2FA
            </Button>
          )}
          {secret && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Escaneie o QR-code no seu app TOTP:</p>
              <code className="block break-all rounded border p-2 text-xs">{secret}</code>
              {backupCodes.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-medium">Códigos de recuperação:</p>
                  <ul className="list-inside list-disc text-xs">
                    {backupCodes.map((c) => (
                      <li key={c}>
                        <code>{c}</code>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-red-500">
                    Guarde os códigos em local seguro — não serão exibidos novamente.
                  </p>
                </>
              )}
            </div>
          )}
          {err && <p className="text-sm font-medium text-red-500">{err}</p>}
        </CardContent>
      </Card>
    </main>
  )
}
