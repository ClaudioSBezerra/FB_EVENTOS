"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.invitation = exports.member = exports.session = exports.organization = exports.verification = exports.account = exports.twoFactor = exports.user = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const roles_1 = require("./roles");
const tenants_1 = require("./tenants");
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
exports.user = (0, pg_core_1.pgTable)('user', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    email: (0, pg_core_1.text)('email').notNull().unique(),
    emailVerified: (0, pg_core_1.boolean)('email_verified').notNull().default(false),
    name: (0, pg_core_1.text)('name'),
    image: (0, pg_core_1.text)('image'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // LGPD consent additionalFields (Plan 04 reads/writes; Plan 05 layers in policies).
    consentVersion: (0, pg_core_1.text)('consent_version'),
    consentAt: (0, pg_core_1.timestamp)('consent_at', { withTimezone: true }),
    consentIp: (0, pg_core_1.text)('consent_ip'),
    // AUTH-05 — Better Auth twoFactor plugin column (added in Plan 04 migration 0003).
    twoFactorEnabled: (0, pg_core_1.boolean)('two_factor_enabled').default(false),
    // LGPD-05 soft-delete (Plan 05 wires query helpers).
    deletedAt: (0, pg_core_1.timestamp)('deleted_at', { withTimezone: true }),
});
/**
 * Better Auth two-factor secrets table (Plan 04 — AUTH-05).
 * One row per user that has enrolled TOTP. NOT tenant-scoped — 2FA is a
 * user-level setting that follows the user across all orgs.
 */
exports.twoFactor = (0, pg_core_1.pgTable)('two_factor', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.user.id, { onDelete: 'cascade' }),
    secret: (0, pg_core_1.text)('secret').notNull(),
    backupCodes: (0, pg_core_1.text)('backup_codes').notNull(),
    verified: (0, pg_core_1.boolean)('verified').default(true),
});
/**
 * Better Auth account table — OAuth provider linkage per user.
 * NOT tenant-scoped (a user has the same Google account regardless of tenant).
 */
exports.account = (0, pg_core_1.pgTable)('account', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.user.id, { onDelete: 'cascade' }),
    accountId: (0, pg_core_1.text)('account_id').notNull(),
    providerId: (0, pg_core_1.text)('provider_id').notNull(),
    accessToken: (0, pg_core_1.text)('access_token'),
    refreshToken: (0, pg_core_1.text)('refresh_token'),
    idToken: (0, pg_core_1.text)('id_token'),
    accessTokenExpiresAt: (0, pg_core_1.timestamp)('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: (0, pg_core_1.timestamp)('refresh_token_expires_at', { withTimezone: true }),
    scope: (0, pg_core_1.text)('scope'),
    password: (0, pg_core_1.text)('password'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
/**
 * Better Auth verification table — short-lived tokens (signup, password reset,
 * email change). NOT tenant-scoped — verification happens before the user
 * has selected an active organization.
 */
exports.verification = (0, pg_core_1.pgTable)('verification', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    identifier: (0, pg_core_1.text)('identifier').notNull(),
    value: (0, pg_core_1.text)('value').notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
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
exports.organization = (0, pg_core_1.pgTable)('organization', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    name: (0, pg_core_1.text)('name').notNull(),
    slug: (0, pg_core_1.text)('slug').notNull().unique(),
    logo: (0, pg_core_1.text)('logo'),
    metadata: (0, pg_core_1.text)('metadata'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('organization_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
/**
 * Better Auth session table — refreshable session tied to a user and an
 * active organization (= tenant). `activeOrganizationId` IS the runtime
 * tenant context source (middleware extracts it and passes the resolved
 * tenant_id to withTenant()).
 */
exports.session = (0, pg_core_1.pgTable)('session', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    // tenant_id is NULLABLE: Better Auth creates a session at sign-in
    // BEFORE the user has selected an active organization. Once an org is
    // selected via setActiveOrganization, the session row's tenant_id is
    // updated by the Phase 1+ hook to match. Sessions with tenant_id IS
    // NULL are accessible across tenants via token-lookup (Better Auth's
    // primary access pattern) — see RLS policy below which permits
    // NULL tenant_id reads (session lookup by opaque token, never SELECT *).
    tenantId: (0, pg_core_1.uuid)('tenant_id').references(() => tenants_1.tenants.id),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.user.id, { onDelete: 'cascade' }),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    token: (0, pg_core_1.text)('token').notNull().unique(),
    ipAddress: (0, pg_core_1.text)('ip_address'),
    userAgent: (0, pg_core_1.text)('user_agent'),
    activeOrganizationId: (0, pg_core_1.uuid)('active_organization_id').references(() => exports.organization.id),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('session_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('session_user_id_idx').on(table.userId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        // Permit access if (a) tenant_id matches the current setting, OR
        // (b) tenant_id is NULL (pre-org-selection session — accessed by
        // Better Auth's token-lookup path which never lists rows).
        using: (0, drizzle_orm_1.sql) `${table.tenantId} IS NULL OR ${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} IS NULL OR ${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
/**
 * Better Auth member table — the user↔organization (tenant) join. Carries
 * the `role` column that drives the AUTH-04/05 role checks (Plan 04).
 */
exports.member = (0, pg_core_1.pgTable)('member', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    organizationId: (0, pg_core_1.uuid)('organization_id')
        .notNull()
        .references(() => exports.organization.id, { onDelete: 'cascade' }),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.user.id, { onDelete: 'cascade' }),
    role: (0, pg_core_1.text)('role').notNull().default('member'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('member_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.index)('member_user_id_idx').on(table.userId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
/**
 * Better Auth invitation table — pending invitations to an organization
 * (tenant). Tenant-scoped so an organizadora's pending invites are
 * isolated from other tenants.
 */
exports.invitation = (0, pg_core_1.pgTable)('invitation', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    tenantId: (0, pg_core_1.uuid)('tenant_id')
        .notNull()
        .references(() => tenants_1.tenants.id),
    organizationId: (0, pg_core_1.uuid)('organization_id')
        .notNull()
        .references(() => exports.organization.id, { onDelete: 'cascade' }),
    email: (0, pg_core_1.text)('email').notNull(),
    role: (0, pg_core_1.text)('role').notNull().default('member'),
    status: (0, pg_core_1.text)('status').notNull().default('pending'),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    inviterId: (0, pg_core_1.uuid)('inviter_id')
        .notNull()
        .references(() => exports.user.id),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    (0, pg_core_1.index)('invitation_tenant_id_idx').on(table.tenantId),
    (0, pg_core_1.pgPolicy)('tenant_isolation', {
        as: 'permissive',
        to: roles_1.fbEventosApp,
        for: 'all',
        using: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
        withCheck: (0, drizzle_orm_1.sql) `${table.tenantId} = current_setting('app.current_tenant_id', true)::uuid`,
    }),
]).enableRLS();
