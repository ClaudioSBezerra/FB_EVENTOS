// FB_EVENTOS — Wizard "Nova organizadora" (2026-06-17).

import Link from 'next/link'

import { CreateOrganizadoraForm } from '@/components/admin/create-organizadora-form'
import { Button } from '@/components/ui/button'

export default function NovaOrganizadoraPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 lg:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Nova organizadora
          </h1>
          <p className="text-sm text-slate-600">
            Cria a organizadora e o usuário administrador inicial.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/organizadoras">← Voltar</Link>
        </Button>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <CreateOrganizadoraForm />
      </div>
    </main>
  )
}
