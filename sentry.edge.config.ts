// FB_EVENTOS — Sentry edge-runtime init (Phase 0, Plan 06 — FOUND-11).
//
// File name MUST be `sentry.edge.config.ts` per RESEARCH Pitfall 5.
//
// The Edge runtime is used by src/middleware.ts. Sentry's Edge SDK is a
// trimmed subset of the Node SDK (no Node APIs like fs/process spawn). If
// the DSN is empty we no-op so dev/CI runs without secrets still pass.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN ?? ''

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  })
}
