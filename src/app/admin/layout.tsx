// FB_EVENTOS — Admin shell layout (2026-06-17 admin-first rework).
//
// Applied to every /admin/* route. Gates on requireSuperAdmin — non-admins
// get notFound() (404), which intentionally hides the existence of the
// console from regular users.

import { requireSuperAdmin } from '@/auth/super-admin'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export const metadata = {
  title: 'Admin · FB_EVENTOS',
}

interface AdminLayoutProps {
  children: React.ReactNode
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const { email } = await requireSuperAdmin()

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar email={email} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
