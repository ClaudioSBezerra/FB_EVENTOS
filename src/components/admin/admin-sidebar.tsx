// FB_EVENTOS — Admin sidebar (2026-06-17 admin-first rework).
//
// Rendered by /admin/layout.tsx. Pure client component — usePathname for
// active highlighting. Mirrors the tenant sidebar's visual language but
// uses a distinct slate-900 brand tab so super admins know they're in the
// system console, not a tenant dashboard.

'use client'

import { Building2, ChevronLeft, LayoutDashboard, LogOut, ShieldCheck, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTransition } from 'react'

import { signOut } from '@/auth/client'

interface NavItem {
  href: string
  label: string
  Icon: typeof LayoutDashboard
  match: (pathname: string) => boolean
}

const items: NavItem[] = [
  {
    href: '/admin',
    label: 'Visão geral',
    Icon: LayoutDashboard,
    match: (p) => p === '/admin',
  },
  {
    href: '/admin/organizadoras',
    label: 'Organizadoras',
    Icon: Building2,
    match: (p) => p === '/admin/organizadoras' || p.startsWith('/admin/organizadoras/'),
  },
  {
    href: '/admin/usuarios',
    label: 'Usuários',
    Icon: Users,
    match: (p) => p === '/admin/usuarios' || p.startsWith('/admin/usuarios/'),
  },
]

interface AdminSidebarProps {
  email: string
}

export function AdminSidebar({ email }: AdminSidebarProps) {
  const pathname = usePathname() ?? ''
  const [isSigningOut, startSignOut] = useTransition()

  function onSignOut() {
    startSignOut(async () => {
      try {
        await signOut()
      } finally {
        window.location.assign('/login')
      }
    })
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-100">
      <div className="border-b border-slate-700 px-5 py-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          Admin
        </p>
        <p className="mt-0.5 text-xs text-slate-400">FB_EVENTOS · Sistema</p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map(({ href, label, Icon, match }) => {
          const active = match(pathname)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-200 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-slate-700 px-3 py-3 space-y-1">
        <Link
          href="/select-org"
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          Acessar uma organizadora
        </Link>
        <p className="mt-2 truncate px-3 text-xs text-slate-400" title={email}>
          {email}
        </p>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          {isSigningOut ? 'Saindo…' : 'Sair'}
        </button>
      </div>
    </aside>
  )
}
