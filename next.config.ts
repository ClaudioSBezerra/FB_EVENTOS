// FB_EVENTOS — Next.js config (Phase 0, Plan 01 + Plan 06).
//
// Plan 06 wraps the exported config with `withSentryConfig` so:
//   - sentry.client.config.ts / sentry.server.config.ts / sentry.edge.config.ts
//     are auto-loaded by Next.js at the right runtime moments.
//   - Sentry's source-map upload (when SENTRY_AUTH_TOKEN is present) runs at
//     build time. In Phase 0 we pass placeholder org/project — production
//     values land in Coolify env (Plan 07).
//
// Keep `output: 'standalone'` from Plan 01 — docker/Dockerfile depends on
// .next/standalone for the multi-stage build.

import { withSentryConfig } from '@sentry/nextjs'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Required by docker/Dockerfile (multi-stage build copies .next/standalone).
  // See RESEARCH.md Pattern 11.
  output: 'standalone',
}

export default withSentryConfig(nextConfig, {
  // Placeholders — real values supplied by Coolify env at deploy (Plan 07).
  // `silent: true` suppresses the Sentry CLI banner during builds without a
  // configured DSN/auth token (CI, local dev, etc.).
  silent: true,
  org: 'fb-eventos-placeholder',
  project: 'fb-eventos-web-placeholder',
  // Disable Sentry features that require an auth token until Plan 07 wires
  // the real value. This keeps `pnpm build` green in CI without credentials.
  widenClientFileUpload: false,
  disableLogger: true,
  automaticVercelMonitors: false,
})
