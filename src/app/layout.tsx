import type { Metadata } from 'next'
import { ConsentBanner } from '@/components/consent-banner'
import './globals.css'

export const metadata: Metadata = {
  title: 'FB_EVENTOS',
  description:
    'Plataforma SaaS de gestão de grandes eventos — venda de espaços, ingressos e operação ponta-a-ponta.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        {children}
        {/* LGPD-02: cookie consent banner. Renders on first visit only —
            choice persisted to localStorage. See src/components/consent-banner.tsx. */}
        <ConsentBanner />
      </body>
    </html>
  )
}
