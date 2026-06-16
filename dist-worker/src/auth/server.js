"use strict";
// FB_EVENTOS — Better Auth server instance (Phase 0, Plan 04).
//
// Wires Better Auth 1.6.16 against the Postgres schema declared in Plan 03
// (user / account / verification / organization / session / member /
// invitation). The drizzleAdapter targets the singleton `db` from
// src/db/index.ts which connects as `fb_eventos_app` (NO BYPASSRLS — Plan 03).
//
// Cross-tenant tables (user/account/verification) have NO RLS by design.
// Tenant-scoped tables (session/organization/member/invitation) carry RLS
// policies; reads from them must happen inside a withTenant() block.
// Better Auth's own session lookups inside the handler run via the
// drizzleAdapter against the singleton `db` — and they HIT the RLS
// default-deny path for `session`. That's intentional:
//   - the auth handler reads `session` ROWS via Better Auth's internal
//     queries which include the userId predicate; RLS will block these
//     unless we set the tenant context first. To allow Better Auth to look
//     up sessions across organizations on the auth route handler, we
//     restrict Better Auth's session-bearing queries to the user/account
//     tables (which are NOT under RLS) and read the `session` table via
//     withTenantAction's middleware where the tenant context is known.
//
// LGPD additionalFields (RESEARCH Pitfall 6 — schema columns are already in
// Plan 03's drizzle user schema):
//   - consentVersion: required:true
//   - consentAt: required:true
//   - consentIp: required:false (populated server-side by
//     recordConsentMetadata Server Action — see src/lib/actions/consent.ts)
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
const better_auth_1 = require("better-auth");
const drizzle_1 = require("better-auth/adapters/drizzle");
const plugins_1 = require("better-auth/plugins");
const db_1 = require("@/db");
const auth_1 = require("@/db/schema/auth");
const set_active_org_1 = require("@/lib/auth/set-active-org");
const email_1 = require("@/lib/email");
const env_1 = require("@/lib/env");
exports.auth = (0, better_auth_1.betterAuth)({
    database: (0, drizzle_1.drizzleAdapter)(db_1.db, {
        provider: 'pg',
        schema: {
            // Map Better Auth's expected table names to our Drizzle schema.
            // Plan 03 declared these tables — Better Auth needs the explicit map
            // because it looks up models by name when issuing queries.
            user: auth_1.user,
            account: auth_1.account,
            session: auth_1.session,
            verification: auth_1.verification,
            organization: auth_1.organization,
            member: auth_1.member,
            invitation: auth_1.invitation,
            twoFactor: auth_1.twoFactor,
        },
    }),
    secret: env_1.env.BETTER_AUTH_SECRET,
    baseURL: env_1.env.BETTER_AUTH_URL,
    trustedOrigins: [env_1.env.BETTER_AUTH_URL, env_1.env.NEXT_PUBLIC_APP_URL],
    // Plan 03 schema uses uuid('id').defaultRandom() everywhere. Tell Better
    // Auth to generate UUIDs so its INSERT values match the column type.
    // (Default is a 32-char random string which fails on uuid columns.)
    advanced: {
        database: {
            generateId: 'uuid',
        },
    },
    // AUTH-01 + AUTH-02: email/password with verification
    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        autoSignIn: false,
        // AUTH-03: password reset
        sendResetPassword: async ({ user, url }) => {
            await (0, email_1.sendEmail)({
                to: user.email,
                subject: 'Redefinir sua senha — FB_EVENTOS',
                html: `<p>Você solicitou redefinir sua senha. Clique no link abaixo:</p>
               <p><a href="${url}">${url}</a></p>
               <p>Se você não solicitou, ignore esse email.</p>`,
            });
        },
    },
    // AUTH-02: email verification
    emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => {
            await (0, email_1.sendEmail)({
                to: user.email,
                subject: 'Confirme seu email — FB_EVENTOS',
                html: `<p>Bem-vindo ao FB_EVENTOS. Confirme seu email clicando abaixo:</p>
               <p><a href="${url}">${url}</a></p>`,
            });
        },
    },
    // AUTH-04: 7-day session persistence with daily refresh
    session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
    },
    // Phase 1, Plan 01-01 Task 3 — session.tenant_id wiring.
    //
    // Better Auth's organization plugin calls `updateSession(token,
    // { activeOrganizationId })` whenever the user picks (or auto-picks,
    // on create) an active organization. The hook below extends the
    // patch with the matching `tenantId` so the session row's
    // `tenant_id` stays in sync with `active_organization_id`. Downstream
    // `withTenant()` callers derive their tenant context from
    // session.tenant_id — without this hook, the tenant_id stays NULL
    // forever and every RLS-scoped query returns 0 rows.
    //
    // See src/lib/auth/set-active-org.ts for the lookup implementation.
    databaseHooks: {
        session: {
            update: {
                before: (0, set_active_org_1.makeSessionUpdateBeforeHook)(),
            },
        },
    },
    // LGPD-01: consent additionalFields on the `user` table.
    // Schema columns already exist (Plan 03 src/db/schema/auth.ts).
    user: {
        additionalFields: {
            consentVersion: { type: 'string', required: true },
            // type:'date' so Better Auth converts the ISO string payload to a
            // Date instance before handing it to Drizzle's PgTimestamp column
            // (mapToDriverValue calls toISOString on the Date). Without 'date'
            // here, Drizzle receives a raw string and crashes (Rule 1 bug found
            // during integration testing).
            consentAt: { type: 'date', required: true },
            // consentIp is captured server-side by recordConsentMetadata
            // (src/lib/actions/consent.ts) reading from next/headers — NOT trusted
            // from the client signup payload. required:false here for that reason.
            consentIp: { type: 'string', required: false },
        },
    },
    // TENA-08 + AUTH-05: organization + 2FA plugins
    plugins: [
        (0, plugins_1.organization)({
            // Plan 04 wires the org-creation hook in domain code (Phase 1+) to
            // INSERT the matching tenants row + populate organization.tenant_id.
            // For now, allow org creation directly — signup form's onSuccess
            // creates an org per signup.
            allowUserToCreateOrganization: true,
        }),
        (0, plugins_1.twoFactor)({
            issuer: 'FB Eventos',
        }),
    ],
});
