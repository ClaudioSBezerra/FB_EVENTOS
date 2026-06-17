// FB_EVENTOS — Tenant shell sidebar (Phase 1 post-MVP, 2026-06-16).
//
// Rendered by [slug]/layout.tsx. Lists the main org-scoped routes and
// highlights the active one using usePathname. Pure client component —
// no DB calls, just routing.

'use client'

import {
  Building2,
  CalendarDays,
  FileText,
  LayoutDashboard,
  LogOut,
  Receipt,
  Store,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTransition } from 'react'

import { signOut } from '@/auth/client'

interface NavItem {
  href: string
  label: string
  Icon: typeof LayoutDashboard
  match: (pathname: string, base: string) => boolean
}

function buildItems(slug: string): NavItem[] {
  const base = `/${slug}`
  const exact = (href: string) => (pathname: string) => pathname === href
  const prefix = (href: string) => (pathname: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  return [
    {
      href: `${base}/dashboard`,
      label: 'Dashboard',
      Icon: LayoutDashboard,
      match: exact(`${base}/dashboard`),
    },
    {
      href: `${base}/eventos`,
      label: 'Eventos',
      Icon: CalendarDays,
      match: prefix(`${base}/eventos`),
    },
    {
      href: `${base}/fornecedores`,
      label: 'Fornecedores',
      Icon: Users,
      match: prefix(`${base}/fornecedores`),
    },
    {
      href: `${base}/marketplace`,
      label: 'Marketplace',
      Icon: Store,
      match: prefix(`${base}/marketplace`),
    },
    {
      href: `${base}/cobrancas`,
      label: 'Cobranças',
      Icon: Receipt,
      match: prefix(`${base}/cobrancas`),
    },
    {
      href: `${base}/contratos`,
      label: 'Contratos',
      Icon: FileText,
      match: prefix(`${base}/contratos`),
    },
  ]
}

interface TenantSidebarProps {
  slug: string
  tenantName: string
  userLabel: string
}

export function TenantSidebar({ slug, tenantName, userLabel }: TenantSidebarProps) {
  const pathname = usePathname() ?? ''
  const [isSigningOut, startSignOut] = useTransition()
  const items = buildItems(slug)

  function onSignOut() {
    startSignOut(async () => {
      try {
        await signOut()
      } finally {
        // Hard redirect so server-side getSession runs cleanly on next nav.
        window.location.assign('/login')
      }
    })
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Brand + tenant */}
      <div className="border-b border-slate-200 px-5 py-4">
        <Link href={`/${slug}/dashboard`} className="block">
          <p className="text-sm font-semibold tracking-tight">
            FB<span className="text-emerald-600">_</span>EVENTOS
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500" title={tenantName}>
            <Building2 className="-mt-0.5 mr-1 inline h-3 w-3" />
            {tenantName}
          </p>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map(({ href, label, Icon, match }) => {
          const active = match(pathname, `/${slug}`)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* User + logout */}
      <div className="border-t border-slate-200 px-3 py-3">
        <p className="mb-2 truncate px-3 text-xs text-slate-500" title={userLabel}>
          {userLabel}
        </p>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          {isSigningOut ? 'Saindo…' : 'Sair'}
        </button>
      </div>
    </aside>
  )
}
