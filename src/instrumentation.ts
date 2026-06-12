// FB_EVENTOS — Next.js instrumentation entrypoint (Phase 0, Plan 06).
//
// Next.js calls `register()` once per runtime on cold-start. We dispatch on
// `NEXT_RUNTIME` so Node-only imports (Pino + Sentry server SDK + the
// future Graphile-Worker bootstrap) never accidentally pull into the Edge
// runtime bundle.
//
// RESEARCH Pattern 8 reference. Documented entry-point for Sentry init via
// withSentryConfig in next.config.ts.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Side-effect import: logs server-init, prepares Sentry server SDK.
    await import('./instrumentation-node')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    // Sentry edge init is loaded automatically by withSentryConfig via
    // sentry.edge.config.ts — no explicit import required here. We keep the
    // branch present so future Edge-only telemetry has an obvious home.
  }
}
