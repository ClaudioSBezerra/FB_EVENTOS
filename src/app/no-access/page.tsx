// FB_EVENTOS — No-access landing.
//
// Reached when a logged-in user has zero org memberships AND is not a
// super admin. After 2026-06-17 admin-first rework, signup no longer
// auto-creates an org; new accounts only become useful once a super admin
// (Claudio) links them to a tenant via /admin/usuarios.

import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { Button } from '@/components/ui/button'

export const metadata = {
  title: 'Sem acesso · FB_EVENTOS',
}

export default async function NoAccessPage() {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) redirect('/login')

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sem acesso ainda</h1>
        <p className="mt-3 text-sm text-slate-600">
          Seu cadastro está ativo (<strong>{session.user.email}</strong>), mas você não foi
          vinculado a nenhuma organização ainda.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Peça ao administrador para incluir você em uma organizadora. Após o vínculo, basta
          recarregar esta página.
        </p>
        <div className="mt-6 flex gap-2">
          <Button asChild variant="outline">
            <Link href="/login">Trocar de conta</Link>
          </Button>
          <Button asChild>
            <Link href="/">Recarregar</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
