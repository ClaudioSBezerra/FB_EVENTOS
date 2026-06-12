// FB_EVENTOS — Verify-email landing page (Phase 0, Plan 04 — Task 2).
//
// Better Auth's `sendOnSignUp: true` emails a link of the form
// `${BETTER_AUTH_URL}/api/auth/verify-email?token=...`. After consumption,
// Better Auth redirects the browser here. We do not consume the token
// ourselves — Better Auth's handler at /api/auth/verify-email did that.

import Link from 'next/link'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Confirme seu email</CardTitle>
          <CardDescription>
            Enviamos um link de confirmação para o email que você cadastrou.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-700">
            Clique no link no email para ativar sua conta. Se já confirmou, prossiga para{' '}
            <Link href="/login" className="underline">
              entrar
            </Link>
            .
          </p>
          <p className="text-xs text-slate-500">
            Não recebeu? Verifique a pasta de spam, ou{' '}
            <Link href="/reset-password" className="underline">
              redefina sua senha
            </Link>{' '}
            para receber um novo email.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
