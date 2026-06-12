// FB_EVENTOS — Test DB helpers (Phase 0, Plan 03).
//
// Exports postgres.js clients and a few factories that tests use to arrange
// tenant-isolated fixtures.
//
//   - `appPool`        Uses DATABASE_URL (fb_eventos_app role, NOBYPASSRLS).
//                      Tests use this to PROVE the RLS contract — any query
//                      here against a tenant-owned table is subject to the
//                      tenant_isolation policy.
//
//   - `migratorPool`   Uses DATABASE_MIGRATOR_URL (fb_eventos_migrator role).
//                      Used by pg_catalog assertions (read pg_roles,
//                      pg_class, etc.) and for TRUNCATE during afterEach
//                      cleanup. NOT used for INSERTing into tenant-scoped
//                      tables — the tenant_isolation policy targets
//                      fb_eventos_app exclusively, so under FORCE RLS the
//                      migrator gets default-deny on write to those tables.
//
//
// Fixture inserts use appPool wrapped in a `SET LOCAL app.current_tenant_id`
// transaction — same pattern as withTenant(). This way fixtures exercise the
// production write path: any RLS misconfiguration (missing WITH CHECK,
// wrong policy role target, etc.) surfaces during test setup, not in prod.
//
//   - `createTenant`         Inserts a row in `tenants` and returns the id.
//                            No RLS on `tenants` (global lookup) so this
//                            does not need SET LOCAL.
//
//   - `insertOrganization`   Inserts a row in `organization` for a given
//                            tenant. Wraps the INSERT in a transaction with
//                            SET LOCAL so FORCE RLS lets the migrator write.
//
//   - `insertSession`        Inserts a row in `session` for a given tenant
//                            + user. Same FORCE-RLS dance.
//
// All factories use the migrator pool so tests can arrange state without
// burning through the app-role RLS contract on EVERY fixture.

import postgres from 'postgres'

const requireEnv = (key: string): string => {
  const v = process.env[key]
  if (!v) throw new Error(`Test DB: ${key} required (set via .env.local or CI env).`)
  return v
}

export const appPool = postgres(requireEnv('DATABASE_URL'), { max: 5 })
export const migratorPool = postgres(requireEnv('DATABASE_MIGRATOR_URL'), { max: 5 })

export async function createTenant(slug: string, name: string): Promise<string> {
  const rows = await migratorPool<{ id: string }[]>`
    INSERT INTO tenants (slug, name) VALUES (${slug}, ${name})
    RETURNING id
  `
  if (!rows[0]) throw new Error('createTenant: no id returned')
  return rows[0].id
}

export async function insertUser(email: string, name = 'Test User'): Promise<string> {
  const rows = await migratorPool<{ id: string }[]>`
    INSERT INTO "user" (email, name, email_verified)
    VALUES (${email}, ${name}, true)
    RETURNING id
  `
  if (!rows[0]) throw new Error('insertUser: no id returned')
  return rows[0].id
}

/**
 * Insert an organization row for `tenantId`. We use the APP pool so the
 * INSERT satisfies the `tenant_isolation` policy (which targets
 * fb_eventos_app and includes a `WITH CHECK (tenant_id = current_setting)`
 * clause). This is how Better Auth's organization-creation hook will work in
 * Plan 04 — fixtures match production semantics.
 */
export async function insertOrganization(
  tenantId: string,
  slug: string,
  name: string,
): Promise<string> {
  return await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    const rows = await tx<{ id: string }[]>`
      INSERT INTO organization (tenant_id, slug, name)
      VALUES (${tenantId}, ${slug}, ${name})
      RETURNING id
    `
    if (!rows[0]) throw new Error('insertOrganization: no id returned')
    return rows[0].id
  })
}

/**
 * Insert a session row tied to (tenantId, userId) via the APP pool inside
 * withTenant semantics — matches production Better Auth session creation.
 */
export async function insertSession(
  tenantId: string,
  userId: string,
  token: string,
  expiresAt: Date,
): Promise<string> {
  return await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    const rows = await tx<{ id: string }[]>`
      INSERT INTO session (tenant_id, user_id, token, expires_at)
      VALUES (${tenantId}, ${userId}, ${token}, ${expiresAt})
      RETURNING id
    `
    if (!rows[0]) throw new Error('insertSession: no id returned')
    return rows[0].id
  })
}
