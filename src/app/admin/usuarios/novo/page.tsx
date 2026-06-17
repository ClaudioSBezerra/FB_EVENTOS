// FB_EVENTOS — Novo usuário (admin, 2026-06-17).

import Link from 'next/link'

import { CreateUserForm } from '@/components/admin/create-user-form'
import { Button } from '@/components/ui/button'

export default function NovoUsuarioPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 lg:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Novo usuário</h1>
          <p className="text-sm text-slate-600">
            Cria um usuário. Vínculos com organizações são feitos depois na tela do usuário.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/usuarios">← Voltar</Link>
        </Button>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <CreateUserForm />
      </div>
    </main>
  )
}
