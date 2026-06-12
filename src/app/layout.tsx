import type { Metadata } from 'next'
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
      <body className="antialiased">{children}</body>
    </html>
  )
}
