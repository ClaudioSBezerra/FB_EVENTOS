// FB_EVENTOS — Portal stub (placeholder until Plan 02-08).
//
// Plan 02-08 (vendor portal) ainda não foi executado, mas o signup-
// fornecedor antigo e o callbackURL de emails de verificação Better Auth
// gerados antes do fix apontam pra essa rota. Pra não 404'ar, redireciona
// pro marketplace (onde o vendor pode reservar lotes).

import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function PortalPlaceholderPage({ params }: PageProps) {
  const { slug } = await params
  redirect(`/${slug}/marketplace`)
}
