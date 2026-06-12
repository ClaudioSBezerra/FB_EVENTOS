// FB_EVENTOS — Drizzle Kit configuration (Phase 0, Plan 03).
//
// Drizzle Kit drives schema introspection (`drizzle-kit generate`) and
// migration application (`drizzle-kit migrate`). It is invoked by:
//   - developers via `pnpm db:generate` / `pnpm db:migrate` in local dev
//   - CI in the deploy step (Plan 07 wires this into Coolify post-deploy)
//
// CRITICAL: This file uses DATABASE_MIGRATOR_URL (the DDL role), NEVER
// DATABASE_URL (the DML / fb_eventos_app runtime role). Migrations require
// CREATE/DROP/ALTER privileges that fb_eventos_app deliberately does NOT
// have — see RESEARCH.md Pattern 2: Two-Role Postgres Setup.
//
// `drizzle-kit push` is CONTRACTUALLY BANNED (RESEARCH Pitfall 4 / T-0-03).
// It bypasses the migration file trail and silently drops columns. Enforced
// by scripts/ci/check-no-drizzle-push.sh on every PR.

import { defineConfig } from 'drizzle-kit'

const migratorUrl = process.env.DATABASE_MIGRATOR_URL
if (!migratorUrl) {
  // Permit `drizzle-kit check` in CI build smoke without a live DB by
  // surfacing a clear error, NOT a silent fallback to DATABASE_URL.
  throw new Error(
    'DATABASE_MIGRATOR_URL is required for drizzle-kit. ' +
      'Set it in .env.local for dev or in CI secrets for deploy. ' +
      'NEVER substitute DATABASE_URL — the app role lacks DDL privileges.',
  )
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: migratorUrl,
  },
  strict: true,
  verbose: true,
})
