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
 * Required in production (SMTP transport — Phase 1 D-14 gate decision
 * swapped Resend for SMTP+nodemailer; "estrutura própria de envio"):
 *   - SMTP_HOST                    — operator-managed SMTP server (Hostinger,
 *                                    postfix, etc). In dev/test optional;
 *                                    email-lib defaults to localhost:1025 (mailpit).
 *   - SMTP_PORT                    — usually 587 (STARTTLS) or 465 (TLS); dev default 1025
 *   - SMTP_USER + SMTP_PASS        — auth creds; omit for unauthenticated mailpit dev
 *   - SMTP_SECURE                  — true for port 465 TLS, false for 587 STARTTLS
 *   - SMTP_FROM                    — default From address (e.g. no-reply@eventos.fbtax.cloud)
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

  // Email transport — SMTP via nodemailer (Phase 0 Plan 04 + Phase 1 Plan
  // 01-08 D-14 gate swap from Resend to SMTP). All optional in the schema
  // because dev defaults to localhost:1025 (mailpit), and `next build`
  // runs with NODE_ENV=production but cannot see runtime secrets. The
  // wrapper in src/lib/email.ts throws at send time if SMTP_HOST is missing
  // in NODE_ENV=production.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v.toLowerCase() === 'true')),
  SMTP_FROM: z.string().optional(),

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

  // ZapSign (Phase 1, Plan 01-05)
  ZAPSIGN_TOKEN: z.string().optional(),
  ZAPSIGN_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  ZAPSIGN_WEBHOOK_USER: z.string().optional(),
  ZAPSIGN_WEBHOOK_PASS: z.string().optional(),

  // Pagar.me v5 (Phase 1, Plan 01-06)
  // Secret key — sk_test_* for sandbox, sk_* for production. Selects the
  // environment (Pagar.me uses ONE base URL `https://api.pagar.me/core/v5`
  // for both — the key prefix is the env switch).
  PAGARME_SECRET_KEY: z.string().optional(),
  // Diagnostic-only — does NOT change the API URL. Use to assert in logs
  // / health checks that the operator deployed the correct key.
  PAGARME_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  // Basic Auth credentials configured in the Pagar.me dashboard when
  // registering the webhook URL. Webhook URL (production):
  // https://eventos.fbtax.cloud/api/webhooks/pagarme
  PAGARME_WEBHOOK_USER: z.string().optional(),
  PAGARME_WEBHOOK_PASS: z.string().optional(),

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
