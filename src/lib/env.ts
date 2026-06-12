/**
 * Centralized environment variable lookups.
 *
 * Phase 0 / Plan 01: stub that re-exports process.env values without validation.
 * Phase 0 / Plan 03: keys for DATABASE_URL + DATABASE_MIGRATOR_URL are now
 * load-bearing for src/db/index.ts. Validation remains a TODO until Plan 04
 * adds Zod (Zod 4 lands in Plan 04 to keep this plan's package surface
 * focused). When Zod arrives, swap the body of this module for a fail-fast
 * z.object({...}).parse(process.env) call — all call sites continue to read
 * `env.X` and pick up validation for free.
 *
 * Required at runtime (no fallback):
 *   - DATABASE_URL                 — fb_eventos_app role (Plan 03)
 * Required at migration time only:
 *   - DATABASE_MIGRATOR_URL        — fb_eventos_migrator role (Plan 03)
 * Required at auth time:
 *   - BETTER_AUTH_SECRET           — min 32 chars (Plan 04 will validate)
 *   - BETTER_AUTH_URL              — (Plan 04)
 *
 * @see .env.example for the full key manifest.
 */

function read(key: string): string | undefined {
  return process.env[key]
}

function readRequired(key: string): string {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable: ${key}. ` + `See .env.example for the manifest.`,
    )
  }
  return value
}

export const env = {
  // Database (Plan 03)
  DATABASE_URL: read('DATABASE_URL'),
  DATABASE_MIGRATOR_URL: read('DATABASE_MIGRATOR_URL'),

  // Auth (Plan 04)
  BETTER_AUTH_SECRET: read('BETTER_AUTH_SECRET'),
  BETTER_AUTH_URL: read('BETTER_AUTH_URL'),

  // Email (Plan 04)
  RESEND_API_KEY: read('RESEND_API_KEY'),

  // Object Storage (Phase 1)
  MINIO_ENDPOINT: read('MINIO_ENDPOINT'),
  MINIO_PORT: read('MINIO_PORT'),
  MINIO_ACCESS_KEY: read('MINIO_ACCESS_KEY'),
  MINIO_SECRET_KEY: read('MINIO_SECRET_KEY'),
  MINIO_USE_SSL: read('MINIO_USE_SSL'),
  MINIO_DEFAULT_BUCKET: read('MINIO_DEFAULT_BUCKET'),

  // Observability (Plan 06)
  SENTRY_DSN: read('SENTRY_DSN'),
  SENTRY_AUTH_TOKEN: read('SENTRY_AUTH_TOKEN'),
  LOG_LEVEL: read('LOG_LEVEL') ?? 'info',

  // App
  NEXT_PUBLIC_APP_URL: read('NEXT_PUBLIC_APP_URL'),
  NODE_ENV: read('NODE_ENV') ?? 'development',
  TZ: read('TZ') ?? 'America/Sao_Paulo',
} as const

// Re-export the strict accessor so later plans can switch a single import
// from `env.X` to `requireEnv('X')` when a value is non-optional at boot.
export { readRequired as requireEnv }
