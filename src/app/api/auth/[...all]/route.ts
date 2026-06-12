// FB_EVENTOS — Better Auth Next.js route handler (Phase 0, Plan 04).
//
// Mounts every Better Auth endpoint under /api/auth/* (sign-in, sign-up,
// sign-out, verify-email, reset-password, organization, two-factor, etc).

import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/auth/server'

export const { POST, GET } = toNextJsHandler(auth)
