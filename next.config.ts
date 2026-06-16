// FB_EVENTOS — Next.js config (Phase 0, Plan 01 + Plan 06).
//
// Sentry wrapper DISABLED FOR THE DEMO:
//   The withSentryConfig() wrapper installed Sentry's request handler
//   middleware, which crashed the HTTP listener silently in the Coolify
//   production deploy — Next.js logged "Ready in 407ms" but `localhost:3000`
//   refused connections from inside the container (healthcheck failed 20×
//   in a row, container marked unhealthy, Traefik returned 404 to the
//   public domain). Since SENTRY_DSN is empty in this demo deploy anyway,
//   removing the wrapper has zero observability impact.
//
//   To re-enable Sentry later:
//     1. Set SENTRY_DSN in Coolify env
//     2. Restore the withSentryConfig wrapper below
//     3. Test the production build path BEFORE re-deploying (the bug only
//        manifests in production standalone mode, not in `next dev`)
//
// Keep `output: 'standalone'` from Plan 01 — docker/Dockerfile depends on
// .next/standalone for the multi-stage build.

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required by docker/Dockerfile (multi-stage build copies .next/standalone).
  // See RESEARCH.md Pattern 11.
  output: 'standalone',
}

export default nextConfig
