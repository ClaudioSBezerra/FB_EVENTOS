// FB_EVENTOS — Onboarding page (2026-06-17 admin-first rework).
//
// Original: self-service flow where a freshly verified user could create
// their own organization via bootstrapOrganization. After the architecture
// switch — operator decision — org provisioning is admin-only via
// /admin/organizadoras. This page now just redirects to the root state
// router which will land the user in the right place (login, dashboard,
// select-org, or no-access).
//
// The bootstrapOrganization Server Action remains intact (in src/lib/
// actions/onboarding.ts) — it's used by /admin/organizadoras as the
// underlying primitive for the admin-driven wizard. Only the user-facing
// page goes away.

import { redirect } from 'next/navigation'

export default function OnboardingPage() {
  redirect('/')
}
