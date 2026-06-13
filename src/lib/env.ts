/**
 * Centralized environment variable lookups with Zod 4 validation (Plan 04).
 *
 * Replaces the Plan 01 stub. Validates ALL keys on first import and throws a
 * friendly error if any required key is missing or malformed. The
 * BETTER_AUTH_SECRET min-32 check and BETTER_AUTH_URL valid-URL check are
 * non-negotiable: Better Auth signs sessions with the secret and uses the
 * URL as the canonical origin for verification links.
 *
 * Required at runtime:
 *   - DATABASE_URL                 — fb_eventos_app role (Plan 03)
 *   - BETTER_AUTH_SECRET           — min 32 chars
 *   - BETTER_AUTH_URL              — valid URL
 *   - NEXT_PUBLIC_APP_URL          — valid URL
 *
 * Required at migration time only:
 *   - DATABASE_MIGRATOR_URL        — fb_eventos_migrator role (Plan 03)
 *
 * Required in production (Resend email transport):
 *   - RESEND_API_KEY               — in dev/test this is optional;
 *                                    email-lib falls back to nodemailer + mailpit
 *
 * Required at build/runtime with sensible defaults:
 *   - LOG_LEVEL                    — pino enum, default 'info'
 *   - NODE_ENV                     — node enum, default 'development'
 *   - TZ                           — default 'America/Sao_Paulo'
 *
 * @see .env.example for the full manifest.
 */

import { z } from 'zod'

const isMigrationTime =
  process.argv.some((a) => a.includes('migrate')) ||
  process.argv.some((a) => a.includes('drizzle-kit')) ||
  process.env.MIGRATION_RUNTIME === '1'

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (fb_eventos_app role, Plan 03)'),
  DATABASE_MIGRATOR_URL: z.string().optional(),

  // Auth (Plan 04)
  BETTER_AUTH_SECRET: z
    .string()
    .min(
      32,
      'BETTER_AUTH_SECRET must be at least 32 characters (generate with `openssl rand -hex 32`)',
    ),
  BETTER_AUTH_URL: z.url('BETTER_AUTH_URL must be a valid URL'),

  // Email (Plan 04) — optional in env validation; production deployments
  // MUST set RESEND_API_KEY via Coolify env, and src/lib/email.ts throws at
  // send time if it's missing in NODE_ENV=production. Keeping the schema
  // optional avoids breaking `next build` (which runs with NODE_ENV=production
  // but cannot see runtime secrets at compile time).
  RESEND_API_KEY: z.string().optional(),

  // Object Storage (Phase 1)
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_PORT: z.string().optional(),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_USE_SSL: z.string().optional(),
  MINIO_DEFAULT_BUCKET: z.string().optional(),
  // Public endpoint embedded in pre-signed URLs delivered to the browser.
  // Differs from MINIO_ENDPOINT in Coolify because the web container talks
  // to MinIO via the internal hostname while browsers need the public one.
  MINIO_PUBLIC_ENDPOINT: z.string().optional(),

  // Observability (Plan 06)
  SENTRY_DSN: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // App
  NEXT_PUBLIC_APP_URL: z.url('NEXT_PUBLIC_APP_URL must be a valid URL'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),
})

export type Env = z.infer<typeof envSchema>

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment variables:\n${issues}\n\nSee .env.example for the full manifest.`,
    )
  }
  if (isMigrationTime && !result.data.DATABASE_MIGRATOR_URL) {
    throw new Error(
      'DATABASE_MIGRATOR_URL is required at migration time (drizzle-kit migrate / pnpm db:migrate). ' +
        'See .env.example.',
    )
  }
  return result.data
}

export const env: Env = parseEnv()

/**
 * Strict accessor for tests / scripts that read keys at runtime. Returns the
 * parsed value or throws. New code should import `env` directly.
 */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${String(key)}`)
  }
  return value as NonNullable<Env[K]>
}
