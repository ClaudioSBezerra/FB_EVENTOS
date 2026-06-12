// FB_EVENTOS — Better Auth client (Phase 0, Plan 04).
//
// React-side client used by the auth UI (signup-form, login-form, etc).
// `inferAdditionalFields` carries the consentVersion/consentAt/consentIp
// shape into the typed `signUp.email` payload so the form gets compile-time
// errors when the LGPD additionalFields aren't passed.

'use client'

import {
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { auth } from './server'

export const authClient = createAuthClient({
  baseURL:
    typeof window === 'undefined'
      ? process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      : window.location.origin,
  plugins: [organizationClient(), twoFactorClient(), inferAdditionalFields<typeof auth>()],
})

export const { signIn, signUp, signOut, useSession } = authClient

// Better Auth 1.6 exposes resetPassword and a request flow via the same
// client. `requestPasswordReset` triggers the email; `resetPassword`
// consumes the token. The names match Better Auth's surface.
export const requestPasswordReset = authClient.requestPasswordReset
export const resetPassword = authClient.resetPassword
