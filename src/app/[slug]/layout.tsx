// FB_EVENTOS — Tenant shell layout (Phase 1 post-MVP, 2026-06-16).
//
// Applied to every route under /[slug]/*. Renders the global TenantSidebar
// alongside the page content. Performs only the cheapest checks (session
// exists, tenant exists) so the sidebar can show the tenant name; the
// activeOrganizationId === tenant.id check stays in each page so 403
// pages can render their own framing without being wrapped by the sidebar.
//
// Public route exceptions:
//   Rotas listadas em PUBLIC_TENANT_PATHS bypassam o session check porque o
//   visitante ainda não tem conta (ex: /paroquia/fornecedor/cadastro — vendor
//   signup self-service via convite). O pathname chega via x-pathname header
//   injetado pelo middleware.

import { headers as nextHeaders } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { auth } from '@/auth/server'
import { checkSuperAdmin } from '@/auth/super-admin'
import { TenantSidebar } from '@/components/tenant-shell/tenant-sidebar'
import { setActiveOrganizationForSession } from '@/lib/auth/set-active-org'
import { resolveTenantBySlug } from '@/lib/tenant'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

/**
 * Sub-paths (após /{slug}/) que são acessíveis sem session.
 * Exact suffix match contra o pathname.
 */
const PUBLIC_TENANT_SUBPATHS = ['/fornecedor/cadastro']

function isPublicTenantPath(slug: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return PUBLIC_TENANT_SUBPATHS.some((sub) => pathname === `/${slug}${sub}`)
}

export default async function TenantLayout({ children, params }: LayoutProps) {
  const { slug } = await params
  const h = await nextHeaders()
  const pathname = h.get('x-pathname')
  const isPublic = isPublicTenantPath(slug, pathname)

  // Public sub-paths render the children sem sidebar e sem session check.
  // O próprio page é responsável por resolveTenantBySlug + notFound se
  // tenant não existir.
  if (isPublic) {
    return <>{children}</>
  }

  const session = await auth.api.getSession({ headers: h })
  if (!session) {
    redirect('/login')
  }

  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) {
    notFound()
  }

  // Super-admin "acessar como organizadora" path — quando um super_admin
  // navega direto pra /{slug}/* sem ter passado por /select-org, o
  // session.active_organization_id está NULL (ou aponta pra outra org).
  // As pages tenant-scoped têm check `activeOrgId !== tenant.id` que 403a.
  // Aqui auto-flipamos a session pra essa org antes de renderizar, sem
  // precisar refatorar 14 pages. Regular users mantêm o gate normal.
  if (session.session.activeOrganizationId !== tenant.id) {
    const { isSuperAdmin } = await checkSuperAdmin()
    if (isSuperAdmin) {
      await setActiveOrganizationForSession(session.session.id, tenant.id).catch(() => null)
      // Hard redirect to re-trigger the server-side render with the new
      // session so the pages downstream see activeOrgId === tenant.id.
      redirect(`/${slug}/dashboard`)
    }
  }

  const userLabel = session.user.name ?? session.user.email ?? 'usuário'

  return (
    <div className="flex min-h-screen bg-slate-50">
      <TenantSidebar slug={slug} tenantName={tenant.name} userLabel={userLabel} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
