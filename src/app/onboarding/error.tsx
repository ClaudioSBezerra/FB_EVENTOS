// FB_EVENTOS — /onboarding error boundary.
//
// Captures uncaught exceptions thrown by the /onboarding Server Component
// or its Server Actions and renders a recoverable UI instead of the
// generic Next.js 500 page. The `digest` field is the production-safe
// correlation id Next.js attaches to redacted error messages — operators
// grep it against Coolify logs to find the original stack trace.

'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function OnboardingError({ error, reset }: Props) {
  // Echo to the browser console so anyone with devtools can read the
  // digest without digging through Coolify. Server-side this same digest
  // is what Pino prints alongside the redacted stack.
  // biome-ignore lint/correctness/useExhaustiveDependencies: log once per error instance
  useEffect(() => {
    console.error('[onboarding] server component error', {
      message: error.message,
      digest: error.digest,
      name: error.name,
    })
  }, [error])

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-xl px-6 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h1 className="text-xl font-semibold text-red-800">
            Erro ao carregar a configuração de organização
          </h1>
          <p className="mt-2 text-sm text-red-700">
            O servidor encontrou um problema ao renderizar esta página. Tente novamente em alguns
            segundos.
          </p>
          {error.digest && (
            <p className="mt-4 text-xs text-red-600">
              Código de correlação:{' '}
              <code className="rounded bg-red-100 px-1 py-0.5 font-mono">{error.digest}</code>
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <Button onClick={reset} variant="default">
              Tentar novamente
            </Button>
            <Button asChild variant="outline">
              <a href="/login">Voltar para login</a>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
