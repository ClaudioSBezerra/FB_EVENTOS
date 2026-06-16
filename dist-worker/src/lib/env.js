"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.requireEnv = requireEnv;
const zod_1 = require("zod");
const isMigrationTime = process.argv.some((a) => a.includes('migrate')) ||
    process.argv.some((a) => a.includes('drizzle-kit')) ||
    process.env.MIGRATION_RUNTIME === '1';
// Build-time / CI skip-hatch. Two contexts need to import this module
// without runtime secrets being available:
//   1. `next build` (production webpack pass) — Next.js evaluates Route
//      Handler modules to collect page data. URLs aren't resolved yet;
//      Coolify supplies them at container start.
//   2. CI test job — `.env.local` is gitignored and CI runs with bare
//      `process.env`. The vitest preflight imports env.ts via @/db.
// Setting SKIP_ENV_VALIDATION=1 swaps the strict URL/secret checks for
// permissive `z.string().optional()` so the file parses without crashing.
// NEVER set this in a runtime container — the Dockerfile sets it ONLY for
// the `pnpm build` step and explicitly unsets it for the runtime stage.
const isBuildTime = process.env.SKIP_ENV_VALIDATION === '1' || process.env.NEXT_PHASE === 'phase-production-build';
const envSchema = zod_1.z.object({
    // Database
    DATABASE_URL: zod_1.z.string().min(1, 'DATABASE_URL is required (fb_eventos_app role, Plan 03)'),
    DATABASE_MIGRATOR_URL: zod_1.z.string().optional(),
    // Auth (Plan 04)
    BETTER_AUTH_SECRET: zod_1.z
        .string()
        .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters (generate with `openssl rand -hex 32`)'),
    BETTER_AUTH_URL: zod_1.z.url('BETTER_AUTH_URL must be a valid URL'),
    // Email transport — SMTP via nodemailer (Phase 0 Plan 04 + Phase 1 Plan
    // 01-08 D-14 gate swap from Resend to SMTP). All optional in the schema
    // because dev defaults to localhost:1025 (mailpit), and `next build`
    // runs with NODE_ENV=production but cannot see runtime secrets. The
    // wrapper in src/lib/email.ts throws at send time if SMTP_HOST is missing
    // in NODE_ENV=production.
    SMTP_HOST: zod_1.z.string().optional(),
    SMTP_PORT: zod_1.z.coerce.number().int().positive().optional(),
    SMTP_USER: zod_1.z.string().optional(),
    SMTP_PASS: zod_1.z.string().optional(),
    SMTP_SECURE: zod_1.z
        .string()
        .optional()
        .transform((v) => (v == null ? undefined : v.toLowerCase() === 'true')),
    SMTP_FROM: zod_1.z.string().optional(),
    // Object Storage (Phase 1)
    MINIO_ENDPOINT: zod_1.z.string().optional(),
    MINIO_PORT: zod_1.z.string().optional(),
    MINIO_ACCESS_KEY: zod_1.z.string().optional(),
    MINIO_SECRET_KEY: zod_1.z.string().optional(),
    MINIO_USE_SSL: zod_1.z.string().optional(),
    MINIO_DEFAULT_BUCKET: zod_1.z.string().optional(),
    // Public endpoint embedded in pre-signed URLs delivered to the browser.
    // Differs from MINIO_ENDPOINT in Coolify because the web container talks
    // to MinIO via the internal hostname while browsers need the public one.
    MINIO_PUBLIC_ENDPOINT: zod_1.z.string().optional(),
    // Observability (Plan 06)
    SENTRY_DSN: zod_1.z.string().optional(),
    SENTRY_AUTH_TOKEN: zod_1.z.string().optional(),
    LOG_LEVEL: zod_1.z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    // ZapSign (Phase 1, Plan 01-05)
    ZAPSIGN_TOKEN: zod_1.z.string().optional(),
    ZAPSIGN_ENV: zod_1.z.enum(['sandbox', 'production']).default('sandbox'),
    ZAPSIGN_WEBHOOK_USER: zod_1.z.string().optional(),
    ZAPSIGN_WEBHOOK_PASS: zod_1.z.string().optional(),
    // Pagar.me v5 (Phase 1, Plan 01-06)
    // Secret key — sk_test_* for sandbox, sk_* for production. Selects the
    // environment (Pagar.me uses ONE base URL `https://api.pagar.me/core/v5`
    // for both — the key prefix is the env switch).
    PAGARME_SECRET_KEY: zod_1.z.string().optional(),
    // Diagnostic-only — does NOT change the API URL. Use to assert in logs
    // / health checks that the operator deployed the correct key.
    PAGARME_ENV: zod_1.z.enum(['sandbox', 'production']).default('sandbox'),
    // Basic Auth credentials configured in the Pagar.me dashboard when
    // registering the webhook URL. Webhook URL (production):
    // https://eventos.fbtax.cloud/api/webhooks/pagarme
    PAGARME_WEBHOOK_USER: zod_1.z.string().optional(),
    PAGARME_WEBHOOK_PASS: zod_1.z.string().optional(),
    // HMAC signing secret for webhook verification (Phase 2, Plan 02-05 — AM-02).
    // Obtain from Pagar.me dashboard → Configurações → Webhooks → Signing Secret.
    // ⚠️ PROBE PENDING: Run tests/probes/pagarme-hmac-header-probe.test.ts to
    // confirm X-Hub-Signature header name + base64 encoding before production deploy.
    // See docs/adr/0005-webhook-hmac-strategy.md for the full HMAC contract.
    PAGARME_WEBHOOK_SIGNING_SECRET: zod_1.z.string().optional(),
    // App
    NEXT_PUBLIC_APP_URL: zod_1.z.url('NEXT_PUBLIC_APP_URL must be a valid URL'),
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    TZ: zod_1.z.string().default('America/Sao_Paulo'),
});
function parseEnv() {
    // Build-time / CI skip — relax URL and secret checks so the module
    // parses without crashing when `.env.local` / Coolify runtime secrets
    // are unavailable. See the `isBuildTime` comment above for context.
    const schema = isBuildTime
        ? envSchema.extend({
            DATABASE_URL: zod_1.z
                .string()
                .optional()
                .default('postgresql://placeholder:placeholder@localhost:5432/placeholder'),
            BETTER_AUTH_SECRET: zod_1.z
                .string()
                .optional()
                .default('build-time-placeholder-secret-not-for-runtime-use-32+chars'),
            BETTER_AUTH_URL: zod_1.z.string().optional().default('https://placeholder.invalid'),
            NEXT_PUBLIC_APP_URL: zod_1.z.string().optional().default('https://placeholder.invalid'),
        })
        : envSchema;
    const result = schema.safeParse(process.env);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n');
        throw new Error(`Invalid environment variables:\n${issues}\n\nSee .env.example for the full manifest.`);
    }
    if (isMigrationTime && !result.data.DATABASE_MIGRATOR_URL) {
        throw new Error('DATABASE_MIGRATOR_URL is required at migration time (drizzle-kit migrate / pnpm db:migrate). ' +
            'See .env.example.');
    }
    return result.data;
}
exports.env = parseEnv();
/**
 * Strict accessor for tests / scripts that read keys at runtime. Returns the
 * parsed value or throws. New code should import `env` directly.
 */
function requireEnv(key) {
    const value = exports.env[key];
    if (value === undefined || value === '') {
        throw new Error(`Missing required environment variable: ${String(key)}`);
    }
    return value;
}
