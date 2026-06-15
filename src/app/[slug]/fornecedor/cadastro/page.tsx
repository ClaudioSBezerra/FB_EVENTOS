// FB_EVENTOS — Fornecedor self-service signup page (Phase 2, Plan 02-02 Task 1).
//
// Public route — no session check (Pattern S2 caveat: the fornecedor has no
// org membership yet when they land here). A visitor arrives via a direct
// invitation link from the organizadora:
//   https://{tenant}.eventos.fbtax.cloud/{slug}/fornecedor/cadastro
//
// The page:
//   1. Resolves the tenant by slug → 404 if unknown.
//   2. Renders SignupFornecedorForm with tenant.name in the header.
//   3. After successful signup, the action redirects to /{slug}/portal.
//
// REFERENCES:
//   - 02-CONTEXT.md D-21 D-22 D-23 D-24
//   - 02-02-PLAN.md Task 1
//   - src/components/fornecedor/signup-form.tsx (form component)
//   - src/lib/actions/signup-fornecedor.ts (Server Action)

import { notFound } from 'next/navigation'

import { SignupFornecedorForm } from '@/components/fornecedor/signup-form'
import { resolveTenantBySlug } from '@/lib/tenant'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function FornecedorCadastroPage({ params }: PageProps) {
  const { slug } = await params

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) {
    notFound()
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Cadastro de Fornecedor
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Você está se cadastrando como fornecedor de <strong>{tenant.name}</strong>.
          </p>
        </div>

        <SignupFornecedorForm slug={slug} />

        <p className="mt-4 text-center text-xs text-slate-500">
          Já tem uma conta?{' '}
          <a href={`/${slug}/login`} className="underline hover:text-slate-700">
            Entrar
          </a>
        </p>
      </div>
    </main>
  )
}
