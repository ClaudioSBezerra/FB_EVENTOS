// FB_EVENTOS — Sentry server-side init (Phase 0, Plan 06 — FOUND-11).
//
// File name MUST be `sentry.server.config.ts` per RESEARCH Pitfall 5.
//
// DSN comes from SENTRY_DSN (NOT NEXT_PUBLIC_ prefix — server-only). If the
// DSN is empty/unset we no-op so CI runs without secrets still pass.
//
// Tenant tagging: feature plans should call Sentry.withScope(scope => {
// scope.setTag('tenant_id', tenantId); ... }) inside Server Actions. The
// per-event tagging is documented in RESEARCH Pattern 10.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? ''

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // Server-side requires no Replay (browser-only feature).
  })
}
