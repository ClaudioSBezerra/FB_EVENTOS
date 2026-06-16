import type { Metadata } from 'next'
import { ConsentBanner } from '@/components/consent-banner'
import './globals.css'

export const metadata: Metadata = {
  title: 'FB_EVENTOS · Gestão de grandes eventos',
  description:
    'Venda de espaços com planta visual, checkout PIX integrado, contratos digitais e comissionamento. Sem WhatsApp, sem planilha.',
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
