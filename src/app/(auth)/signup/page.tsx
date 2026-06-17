// FB_EVENTOS — Signup page (2026-06-17 admin-first rework).
//
// Original: public signup that created a user + organização self-service.
// After the architecture switch — operator decision — org provisioning is
// admin-only via /admin/organizadoras. New users only exist if a super
// admin creates them. This page now hard-redirects to /login.
//
// The SignupForm component remains in the codebase and will be reused by
// the marketplace vendor-signup flow (Phase 2 plan 02-04 has dedicated
// vendor-only entry point /fornecedor/cadastro) — that one stays public.

import { redirect } from 'next/navigation'

export default function SignupPage() {
  redirect('/login')
}
