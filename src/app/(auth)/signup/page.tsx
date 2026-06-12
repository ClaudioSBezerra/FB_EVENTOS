// FB_EVENTOS — Signup page (Phase 0, Plan 04 — Task 2).
//
// Renders the LGPD-consent-aware signup form. The Card wrapper carries a
// link to docs/LGPD.md (Plan 05 will write the file; for now the link is a
// placeholder that resolves once Plan 05 lands).

import Link from 'next/link'

import { SignupForm } from '@/components/auth/signup-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Criar conta FB_EVENTOS</CardTitle>
          <CardDescription>
            Cadastre sua organização e comece a vender espaços para fornecedores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
          <p className="mt-4 text-xs text-slate-500">
            Ao criar a conta você aceita os{' '}
            <Link href="/docs/lgpd" className="underline">
              Termos LGPD e Política de Privacidade
            </Link>
            . Já tem conta?{' '}
            <Link href="/login" className="underline">
              Entrar
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
