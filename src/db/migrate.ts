// FB_EVENTOS — Migration runner (Phase 0, Plan 03).
//
// DO NOT call runMigrations() from src/app/**, src/middleware.ts, or any
// other code path that runs on Next.js boot. Migrations execute ONLY in
// the deploy step (CI / Coolify post-deploy hook — wired in Plan 07).
//
// Why this prohibition is load-bearing: FB_APU04 had a self-healing boot
// path that called `DROP TABLE schema_migrations` when a column type
// mismatched. That code destroyed migration history during a routine
// deploy. We never repeat that pattern. Migrations are explicit, file-
// based, applied via the CLI, and reviewable in git history.
//
// CI enforcement: scripts/ci/check-no-drizzle-push.sh (Plan 02) blocks
// `drizzle-kit push` (which would bypass the migration files entirely).
// This file uses `drizzle-kit migrate` exclusively via the postgres-js
// adapter — it applies the committed SQL migrations in src/db/migrations/.
//
// Env loading: tsx is invoked with `--env-file=.env.local` so DATABASE_MIGRATOR_URL
// is read from the local manifest. Production paths supply env via Coolify.

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

export async function runMigrations(): Promise<void> {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) {
    throw new Error(
      'DATABASE_MIGRATOR_URL is required to run migrations. ' +
        'NEVER substitute DATABASE_URL — the app role lacks DDL privileges.',
    )
  }

  const client = postgres(migratorUrl, { max: 1 })
  try {
    await migrate(drizzle(client), {
      migrationsFolder: './src/db/migrations',
    })
    console.log('Migrations applied successfully')
  } finally {
    await client.end()
  }
}

// Allow `pnpm tsx src/db/migrate.ts` to be the canonical local-dev /
// CI invocation. Direct execution path only — never auto-imported.
const isEntry = (() => {
  try {
    const me = new URL(import.meta.url).pathname
    const arg = process.argv[1] ?? ''
    return me === arg || me.endsWith(arg) || arg.endsWith('migrate.ts')
  } catch {
    return false
  }
})()
if (isEntry) {
  runMigrations().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
