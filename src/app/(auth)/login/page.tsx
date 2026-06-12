// FB_EVENTOS — Login page (Phase 0, Plan 04 — Task 2).

import Link from 'next/link'

import { LoginForm } from '@/components/auth/login-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Entrar no FB_EVENTOS</CardTitle>
          <CardDescription>Acesse sua organização.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
          <p className="mt-4 text-xs text-slate-500">
            Esqueceu sua senha?{' '}
            <Link href="/reset-password" className="underline">
              Redefinir
            </Link>
            . Não tem conta?{' '}
            <Link href="/signup" className="underline">
              Criar conta
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
