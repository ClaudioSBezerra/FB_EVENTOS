// FB_EVENTOS — Next.js instrumentation entrypoint (Phase 0, Plan 06).
//
// Sentry init was moved out (see next.config.ts header). Without the
// withSentryConfig wrapper there's nothing for the Edge runtime to load
// here. Keeping the file present so future telemetry has an obvious home.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Side-effect import: logs server-init via Pino. No Sentry side-effect.
    await import('./instrumentation-node')
  }
}
