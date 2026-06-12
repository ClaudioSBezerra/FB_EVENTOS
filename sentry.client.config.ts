// FB_EVENTOS — Sentry client-side init (Phase 0, Plan 06 — FOUND-11).
//
// File name MUST be `sentry.client.config.ts` per RESEARCH Pitfall 5 — the
// `@sentry/wizard` may produce `instrumentation-client.ts` (Next.js 16
// convention), which Next.js 15 does NOT auto-pick-up. We pin Next.js 15
// (see CLAUDE.md Version Compatibility), so this file name is correct.
//
// DSN comes from NEXT_PUBLIC_SENTRY_DSN — exposed to the browser bundle by
// design (Sentry's client SDK needs to know where to POST events). If the
// DSN is empty/unset we no-op: Sentry.init({dsn: ''}) effectively disables
// reporting, so dev/CI runs without Sentry credentials still pass.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''

if (dsn) {
  Sentry.init({
    dsn,
    // Conservative sampling in Phase 0 — bumped per-route once the app has
    // production load and we know where the hot paths are.
    tracesSampleRate: 0.1,
    // Disable Session Replay in Phase 0 (LGPD review pending before we ship
    // user-session recordings).
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 0.0,
  })
}
