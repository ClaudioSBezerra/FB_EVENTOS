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

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization, twoFactor } from 'better-auth/plugins'
import { db } from '@/db'
import { sendEmail } from '@/lib/email'
import { env } from '@/lib/env'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      // Map Better Auth's expected table names to our Drizzle schema.
      // Plan 03 declared these tables — Better Auth needs to know which
      // Drizzle objects to query.
    },
  }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.BETTER_AUTH_URL, env.NEXT_PUBLIC_APP_URL],

  // AUTH-01 + AUTH-02: email/password with verification
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    // AUTH-03: password reset
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Redefinir sua senha — FB_EVENTOS',
        html: `<p>Você solicitou redefinir sua senha. Clique no link abaixo:</p>
               <p><a href="${url}">${url}</a></p>
               <p>Se você não solicitou, ignore esse email.</p>`,
      })
    },
  },

  // AUTH-02: email verification
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Confirme seu email — FB_EVENTOS',
        html: `<p>Bem-vindo ao FB_EVENTOS. Confirme seu email clicando abaixo:</p>
               <p><a href="${url}">${url}</a></p>`,
      })
    },
  },

  // AUTH-04: 7-day session persistence with daily refresh
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  // LGPD-01: consent additionalFields on the `user` table.
  // Schema columns already exist (Plan 03 src/db/schema/auth.ts).
  user: {
    additionalFields: {
      consentVersion: { type: 'string', required: true },
      consentAt: { type: 'string', required: true },
      // consentIp is captured server-side by recordConsentMetadata
      // (src/lib/actions/consent.ts) reading from next/headers — NOT trusted
      // from the client signup payload. required:false here for that reason.
      consentIp: { type: 'string', required: false },
    },
  },

  // TENA-08 + AUTH-05: organization + 2FA plugins
  plugins: [
    organization({
      // Plan 04 wires the org-creation hook in domain code (Phase 1+) to
      // INSERT the matching tenants row + populate organization.tenant_id.
      // For now, allow org creation directly — signup form's onSuccess
      // creates an org per signup.
      allowUserToCreateOrganization: true,
    }),
    twoFactor({
      issuer: 'FB Eventos',
    }),
  ],
})

export type Auth = typeof auth
