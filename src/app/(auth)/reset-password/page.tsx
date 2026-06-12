// FB_EVENTOS — Reset password page (Phase 0, Plan 04 — Task 2).
//
// Two modes detected by ?token=... in the URL:
//   - no token  → "request reset" — user submits email; uniform response.
//   - with token → "consume reset" — user picks a new password.

import { Suspense } from 'react'

import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Redefinir senha</CardTitle>
          <CardDescription>Informe seu email para receber um link de redefinição.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  )
}
