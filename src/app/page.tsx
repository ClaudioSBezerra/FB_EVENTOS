// FB_EVENTOS — Landing page (Phase 0 + post-demo polish 2026-06-16).
//
// Comportamento:
//   - Usuário logado → server-side redirect para /[slug]/dashboard da org ativa
//   - Visitante → landing comercial (hero + features + how it works + CTA + footer)
//
// Stack visual: Tailwind 4 + shadcn/ui (Button/Card). Sem dependências novas.

import { eq } from 'drizzle-orm'
import { CreditCard, LayoutGrid, ShieldCheck, Store } from 'lucide-react'
import { headers as nextHeaders } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { organization } from '@/db/schema/auth'
import { withTenant } from '@/db/with-tenant'

export default async function Home() {
  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })

  if (session) {
    const orgId = session.session.activeOrganizationId
    if (orgId) {
      const slug = await withTenant(orgId, async (scopedDb) => {
        const rows = await scopedDb
          .select({ slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, orgId))
          .limit(1)
        return rows[0]?.slug ?? null
      })
      if (slug) redirect(`/${slug}/dashboard`)
    }
    // Logged in but no active org → finish setup at /onboarding. This covers
    // both the legacy users created before the org-on-signup flow shipped
    // AND the post-verify-email landing during the new signup flow.
    redirect('/onboarding')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Top bar */}
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-end px-6 py-4">
          <nav className="flex items-center gap-3">
            <Button variant="outline" asChild>
              <Link href="/login">Entrar</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Criar conta</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-24 text-center">
        <p className="mb-4 inline-block rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          Plataforma SaaS · Multi-tenant · LGPD-ready
        </p>
        <h1 className="mx-auto max-w-3xl text-balance text-5xl font-semibold tracking-tight text-slate-900 sm:text-6xl">
          Gestão de grandes eventos.{' '}
          <span className="text-emerald-600">Sem WhatsApp, sem planilha.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-slate-600">
          Venda de espaços com planta visual, checkout PIX integrado, contratos digitais e
          comissionamento — tudo na mesma plataforma. Pensada para eventos religiosos de massa,
          feiras e festivais.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/signup">Comece grátis →</Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            asChild
            className="border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
          >
            <Link href="/login">Já tenho conta</Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feat) => (
            <Card key={feat.title} className="border-slate-200">
              <CardContent className="pt-6">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
                  {feat.icon}
                </div>
                <h3 className="mb-2 font-semibold text-slate-900">{feat.title}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{feat.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="mb-4 text-center text-3xl font-semibold tracking-tight text-slate-900">
            Como funciona
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-slate-600">
            Da organizadora ao fornecedor, do contrato à cobrança — um fluxo único.
          </p>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, idx) => (
              <div key={step.title} className="relative">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {idx + 1}
                </div>
                <h3 className="mb-2 font-semibold text-slate-900">{step.title}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
          Pronto para escalar seu evento?
        </h2>
        <p className="mt-4 text-slate-600">
          Cadastre sua organizadora e crie o primeiro evento em minutos.
        </p>
        <div className="mt-8">
          <Button size="lg" asChild>
            <Link href="/signup">Criar conta gratuita →</Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-500 md:flex-row">
          <p>© {new Date().getFullYear()} FB_EVENTOS · Operado por Fortes Bezerra</p>
          <nav className="flex gap-6">
            <Link href="/login" className="hover:text-slate-900">
              Entrar
            </Link>
            <Link href="/signup" className="hover:text-slate-900">
              Cadastrar
            </Link>
            <a
              href="https://github.com/ClaudioSBezerra/FB_EVENTOS"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-slate-900"
            >
              Open source
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}

const FEATURES = [
  {
    title: 'Planta 2D interativa',
    description:
      'Upload de PDF, JPG ou PNG da planta. Desenhe lotes como polígonos clicáveis no editor Konva — fornecedores reservam direto pelo mapa.',
    icon: <LayoutGrid className="h-5 w-5" />,
  },
  {
    title: 'Marketplace self-service',
    description:
      'Fornecedores se cadastram, visualizam eventos abertos da organizadora e reservam lotes com TTL de 15 min — sem fricção.',
    icon: <Store className="h-5 w-5" />,
  },
  {
    title: 'PIX + cartão integrados',
    description:
      'Checkout Pagar.me com PIX (QR + copia-cola) e cartão parcelado. Webhooks idempotentes, FSM resiliente, recibos automáticos.',
    icon: <CreditCard className="h-5 w-5" />,
  },
  {
    title: 'LGPD por construção',
    description:
      'Multi-tenant via Postgres RLS forçado, consentimento versionado, audit log append-only, soft-delete + anonimização agendada.',
    icon: <ShieldCheck className="h-5 w-5" />,
  },
]

const STEPS = [
  {
    title: 'Organizadora cria o evento',
    description:
      'Cadastra evento, sobe planta, define categorias de lote e preços por m². Tudo em uma sessão.',
  },
  {
    title: 'Fornecedor reserva e paga',
    description:
      'Self-service: cria conta no marketplace, escolhe lote no mapa, paga via PIX. Contrato é gerado e assinado digitalmente.',
  },
  {
    title: 'Operação ponta-a-ponta',
    description:
      'Dashboards de ocupação e financeiro em tempo real. Comissionamento, refunds e LGPD compliance automatizados.',
  },
]
