// FB_EVENTOS — Login page (split-screen 2026-06-17).
//
// Layout: painel esquerdo escuro com a logo da GRU (cofundadora) +
// tagline; form de login na metade direita sobre fundo claro. Em
// mobile o painel esquerdo some — login fica em tela cheia centrada.

import Image from 'next/image'
import Link from 'next/link'

import { LoginForm } from '@/components/auth/login-form'

export const metadata = {
  title: 'Entrar · FB_EVENTOS',
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen">
      {/* Painel esquerdo — marca + cofundadora (escondido em mobile) */}
      <aside className="relative hidden w-1/2 flex-col justify-between bg-slate-900 p-12 text-slate-100 md:flex">
        {/* Topo: brand FB_EVENTOS */}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            FB<span className="text-emerald-400">_</span>EVENTOS
          </h1>
          <p className="mt-1 text-sm text-slate-400">Plataforma de gestão de grandes eventos.</p>
        </div>

        {/* Centro: logo da cofundadora + tagline */}
        <div className="flex flex-col items-center">
          <div className="relative h-32 w-64">
            <Image
              src="/partners/gru-logo.png"
              alt="GRU — Gerando Resultados, Conectando Oportunidades"
              fill
              priority
              sizes="(min-width: 768px) 256px, 0px"
              className="object-contain"
            />
          </div>
          <p className="mt-6 text-center text-sm uppercase tracking-widest text-slate-400">
            Cofundadora
          </p>
        </div>

        {/* Rodapé */}
        <p className="text-xs text-slate-500">
          © {new Date().getFullYear()} FB_EVENTOS · Operado por Fortes Bezerra em parceria com GRU
        </p>
      </aside>

      {/* Painel direito — login form */}
      <section className="flex w-full flex-col justify-center bg-slate-50 p-6 md:w-1/2 md:p-12">
        <div className="mx-auto w-full max-w-md">
          {/* Brand em mobile (some no desktop pq o painel esquerdo já tem) */}
          <h1 className="mb-8 text-xl font-semibold tracking-tight text-slate-900 md:hidden">
            FB<span className="text-emerald-600">_</span>EVENTOS
          </h1>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Entrar na sua conta
          </h2>
          <p className="mt-2 text-sm text-slate-600">Acesse o painel da sua organização.</p>

          <div className="mt-8">
            <LoginForm />
          </div>

          <p className="mt-6 text-xs text-slate-500">
            Esqueceu sua senha?{' '}
            <Link href="/reset-password" className="font-medium text-emerald-700 underline">
              Redefinir
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  )
}
