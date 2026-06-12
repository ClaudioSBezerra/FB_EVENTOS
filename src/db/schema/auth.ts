// FB_EVENTOS — Better Auth tables + RLS policies (Phase 0, Plan 03).
//
// Declares the core Better Auth tables (user, session, account, verification)
// PLUS the organization-plugin tables (organization, member, invitation).
// Plan 04 wires up `auth = betterAuth({...})` and the drizzleAdapter against
// these tables. We declare them HERE because every tenant-owned Better Auth
// table needs RLS policies + `.enableRLS()` from day 1 — adding RLS later
// would require the migrator to disable+re-enable policies on a table that
// already has rows, which is operationally risky.
//
// Tenant model: organization = tenant. The `member` table is the user↔tenant
// join. `session.activeOrganizationId` is the runtime tenant context source
// (middleware reads it and passes the resolved tenant_id to withTenant()).
//
// RLS shape per RESEARCH Pattern 1:
//   - Every org-scoped row has `tenantId uuid not null references tenants(id)`
//   - `pgPolicy('tenant_isolation', { to: fbEventosApp, using: ... })`
//   - `.enableRLS()` chained on the table builder (drizzle-orm@0.45.2;
//     `withRLS()` is the post-v1.0-beta.1 rename, not yet shipped in 0.45)
//   - `ALTER TABLE ... FORCE ROW LEVEL SECURITY` in 0002_force_rls.sql
//
// Special cases:
//   - `user` table is global (referenced cross-tenant via `member`). It has
//     no tenant_id and no RLS policy, BUT it carries the LGPD consent
//     additionalFields columns (consentVersion, consentAt, consentIp —
//     RESEARCH Pitfall 6 mitigation) and a deletedAt soft-delete column.
//   - `verification` is per-email (signup / password reset / email change)
//     and is NOT tenant-scoped — it has no tenant_id and no RLS policy.
//   - `account` is per-user (OAuth provider account links) and is NOT
//     tenant-scoped — it has no tenant_id and no RLS policy.
//
// Plan 04 may extend these with Better Auth-required columns we didn't
// anticipate; that's expected and will land as a new generated migration.

import { sql } from 'drizzle-orm'
import { boolean, index, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { fbEventosApp } from './roles'
import { tenants } from './tenants'

// ────────────────────────────────────────────────────────────────────────────
// Better Auth core tables (NOT tenant-scoped)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Better Auth user table — global lookup, cross-tenant via `member` join.
 *
 * Columns carry Better Auth's required shape PLUS the LGPD additionalFields
 * (consentVersion, consentAt, consentIp) declared on the auth config in
 * Plan 04. Without the columns, Better Auth's drizzleAdapter silently fails
 * on insert of additionalFields (RESEARCH Pitfall 6).
 *
 * NO tenant_id column, NO RLS policy — this is intentional.
 */
export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  // LGPD consent additionalFields (Plan 04 reads/writes; Plan 05 layers in policies).
  consentVersion: text('consent_version'),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  consentIp: text('consent_ip'),
  // AUTH-05 — Better Auth twoFactor plugin column (added in Plan 04 migration 0003).
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
  // LGPD-05 soft-delete (Plan 05 wires query helpers).
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

/**
 * Better Auth two-factor secrets table (Plan 04 — AUTH-05).
 * One row per user that has enrolled TOTP. NOT tenant-scoped — 2FA is a
 * user-level setting that follows the user across all orgs.
 */
export const twoFactor = pgTable('two_factor', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  verified: boolean('verified').default(true),
})

/**
 * Better Auth account table — OAuth provider linkage per user.
 * NOT tenant-scoped (a user has the same Google account regardless of tenant).
 */
export const account = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Better Auth verification table — short-lived tokens (signup, password reset,
 * email change). NOT tenant-scoped — verification happens before the user
 * has selected an active organization.
 */
export const verification = pgTable('verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ────────────────────────────────────────────────────────────────────────────
// Organization plugin tables (TENANT-SCOPED — RLS REQUIRED)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Better Auth organization table.
 *
 * In the FB_EVENTOS data model `organization` IS the tenant. We add an
 * explicit `tenantId uuid` that mirrors the organization's own id (the
 * Plan 04 organization-creation hook will INSERT a tenants row with the
 * same id, then INSERT the organization row with `tenantId = id`). This
 * keeps RLS policies uniform across every tenant-scoped table (always
 * `tenant_id = current_setting(...)`), which lets the verifier scan for
 * `tenant_id` references mechanically.
 */
export const organization = pgTable(
  'organization',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('organization_tenant_id_idx').on(table.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

/**
 * Better Auth session table — refreshable session tied to a user and an
 * active organization (= tenant). `activeOrganizationId` IS the runtime
 * tenant context source (middleware extracts it and passes the resolved
 * tenant_id to withTenant()).
 */
export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // tenant_id is NULLABLE: Better Auth creates a session at sign-in
    // BEFORE the user has selected an active organization. Once an org is
    // selected via setActiveOrganization, the session row's tenant_id is
    // updated by the Phase 1+ hook to match. Sessions with tenant_id IS
    // NULL are accessible across tenants via token-lookup (Better Auth's
    // primary access pattern) — see RLS policy below which permits
    // NULL tenant_id reads (session lookup by opaque token, never SELECT *).
    tenantId: uuid('tenant_id').references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: uuid('active_organization_id').references(() => organization.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('session_tenant_id_idx').on(table.tenantId),
    index('session_user_id_idx').on(table.userId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      // Permit access if (a) tenant_id matches the current setting, OR
      // (b) tenant_id is NULL (pre-org-selection session — accessed by
      // Better Auth's token-lookup path which never lists rows).
      using: sql`${table.tenantId} IS NULL OR ${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} IS NULL OR ${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

/**
 * Better Auth member table — the user↔organization (tenant) join. Carries
 * the `role` column that drives the AUTH-04/05 role checks (Plan 04).
 */
export const member = pgTable(
  'member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('member_tenant_id_idx').on(table.tenantId),
    index('member_user_id_idx').on(table.userId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()

/**
 * Better Auth invitation table — pending invitations to an organization
 * (tenant). Tenant-scoped so an organizadora's pending invites are
 * isolated from other tenants.
 */
export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('invitation_tenant_id_idx').on(table.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      to: fbEventosApp,
      for: 'all',
      using: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
      withCheck: sql`${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
  ],
).enableRLS()
