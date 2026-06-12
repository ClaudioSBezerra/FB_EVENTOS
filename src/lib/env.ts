/**
 * Centralized environment variable lookups.
 *
 * Phase 0 / Plan 01: stub that re-exports process.env values without validation.
 * Plan 03 replaces the body of this module with a Zod-validated parser that
 * fails fast at boot. All future imports continue to read from `env.*` and pick
 * up validation for free without touching call sites.
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
