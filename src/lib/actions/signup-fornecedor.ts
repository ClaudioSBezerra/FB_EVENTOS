// FB_EVENTOS — Fornecedor self-service signup Server Action (Phase 2, Plan 02-02).
//
// Handles /{slug}/fornecedor/cadastro form submission.
// Uses actionClient (NOT withTenantAction) because the fornecedor has no
// org membership yet — Pattern S2 caveat from 02-PATTERNS.md line 1322.
//
// Flow (D-21/D-22/D-23/D-24):
//   1. Zod validate: consents.payment_data must be literal(true) — T-02-02-02.
//   2. resolveTenantBySlug(slug) → 404 if unknown tenant.
//   3. Resolve or create Better Auth user (D-22: reuse if email exists).
//   4. Insert member row into the org (direct Drizzle INSERT inside withTenant).
//   5. withTenant(tenant.id) → createVendorInTenant (Phase 1 reuse).
//   6. For each granted consent type → INSERT vendor_consents row (D-24).
//   7. Return { vendorId, userId, redirectTo }.
//
// The thin Server Action `signupFornecedor` is for client components;
// `signupFornecedorForTenant` is the testable pure helper.
//
// WHY DIRECT MEMBER INSERT INSTEAD OF auth.api.addMember:
//   auth.api.addMember is an admin-gated endpoint requiring an active session.
//   Since the fornecedor has no session yet, we insert the member row directly
//   using Drizzle inside withTenant — the same pattern used by all Phase 1 tests
//   (appPool + SET LOCAL) and functionally identical to what Better Auth's org
//   plugin does internally. The member.id is generated as a UUID, same as
//   Better Auth would generate.
//
// REFERENCES:
//   - 02-CONTEXT.md D-21 D-22 D-23 D-24
//   - 02-02-PLAN.md Task 1
//   - src/lib/actions/fornecedores.ts (createVendorInTenant — Phase 1 reuse)
//   - src/lib/actions/consent.ts (extractClientIp pattern)

'use server'

import { and, eq } from 'drizzle-orm'

import { auth } from '@/auth/server'
import { db } from '@/db'
import { member, user } from '@/db/schema/auth'
import { vendorConsents } from '@/db/schema/vendor_consents'
import { withTenant } from '@/db/with-tenant'
import { createVendorInTenant } from '@/lib/actions/fornecedores'
import { recordAudit } from '@/lib/audit'
import { resolveTenantBySlug } from '@/lib/tenant'
import {
  LGPD_CONSENT_TEXTS,
  LGPD_CONSENT_VERSION_V2,
  type SignupFornecedorSchema,
  signupFornecedorSchema,
} from '@/lib/validators/signup-fornecedor'

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type SignupFornecedorInput = SignupFornecedorSchema

export interface SignupFornecedorResult {
  vendorId: string
  userId: string
  redirectTo: string
}

// ────────────────────────────────────────────────────────────────────────────
// IP extraction (mirrors src/lib/actions/consent.ts:45-56 verbatim)
// ────────────────────────────────────────────────────────────────────────────

function extractClientIp(headerMap: Headers): string {
  const xff = headerMap.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xri = headerMap.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

// ────────────────────────────────────────────────────────────────────────────
// Resolve or create a Better Auth user
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve or create a Better Auth user for the given email.
 *
 * D-22: a fornecedor can sign up on multiple tenants using the same email.
 * Better Auth's `user` table has globally-unique emails (no RLS). So:
 *   - First signup → `auth.handler(signUpEmail)` creates the user, returns id.
 *   - Subsequent signups on OTHER tenants → sign-up returns 4xx (duplicate email).
 *     We fall back to a direct Drizzle SELECT on the `user` table (no RLS) to
 *     retrieve the existing user's id. We do NOT call sign-in because the config
 *     has `requireEmailVerification: true` — sign-in blocks unverified users.
 *
 * The LGPD consentVersion / consentAt are written on first signup via
 * Better Auth's additionalFields. On subsequent cross-tenant signups the
 * user row already has them (we don't overwrite).
 */
async function resolveOrCreateUser(
  email: string,
  password: string,
  name: string,
  headers: Headers,
): Promise<{ userId: string }> {
  const clientIp = extractClientIp(headers)
  const userAgent = headers.get('user-agent') ?? 'fb-eventos-server/0'

  // Step A: Try to sign up via Better Auth.
  const signUpReq = new Request('http://localhost/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': clientIp,
      'user-agent': userAgent,
    },
    body: JSON.stringify({
      email,
      password,
      name,
      consentVersion: LGPD_CONSENT_VERSION_V2,
      consentAt: new Date().toISOString(),
    }),
  })

  const signUpRes = await auth.handler(signUpReq)

  // Parse sign-up response (regardless of status — Better Auth may return 200
  // with a user object even for duplicate-email signups, but that userId may
  // not actually be persisted in the DB — see D-22 investigation in plan notes).
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth response shape varies by version
  let signUpBody: any = null
  if (signUpRes.ok) {
    signUpBody = await signUpRes.json().catch(() => null)
  }
  const signUpUserId: string | undefined = signUpBody?.user?.id ?? signUpBody?.id

  if (signUpUserId) {
    // Verify the userId is actually persisted in the DB (Better Auth may return
    // a userId in the response for duplicate-email signups that it then rolls
    // back due to the unique constraint — see D-22 investigation).
    const verifyRows = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, signUpUserId))
      .limit(1)
    if (verifyRows[0]) return { userId: signUpUserId }
  }

  // Step B: Fall back to email lookup (covers D-22 cross-tenant reuse where
  // sign-up returned 200 with a non-persisted userId OR returned 4xx).
  // The `user` table has no RLS (global lookup), so the singleton `db` can
  // query it without a withTenant context. This avoids the sign-in path which
  // is blocked by requireEmailVerification: true on existing unverified users.
  const existingRows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)

  const existing = existingRows[0]
  if (existing) return { userId: existing.id }

  // If we reach here, sign-up failed for a reason OTHER than duplicate email
  // (e.g., invalid password policy, missing required fields). Surface error.
  throw new Error(
    `Não foi possível criar a conta (status=${signUpRes.status}). Verifique os dados e tente novamente.`,
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helper — testable without Next.js request context
// ────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrates the full fornecedor self-service signup:
 *   validateZod → resolveTenant → resolveOrCreateUser →
 *   addMember (direct Drizzle INSERT) → createVendor (Phase 1) →
 *   INSERT vendor_consents (D-24)
 *
 * @param slug    Tenant slug from URL (/{slug}/fornecedor/cadastro)
 * @param input   Signup form values (validated by signupFornecedorSchema)
 * @param headers Request headers (for IP extraction)
 */
export async function signupFornecedorForTenant(
  slug: string,
  input: SignupFornecedorInput,
  headers: Headers,
): Promise<SignupFornecedorResult> {
  // Step 1: Validate input — throws ZodError for missing payment_data consent
  // (T-02-02-02 mitigation: server blocks bypass even if client-side removed the check)
  const parsed = signupFornecedorSchema.parse(input)

  // Step 2: Resolve tenant — T-02-02-01 mitigation: verify slug before any DB write
  const tenant = await resolveTenantBySlug(slug)
  if (!tenant) {
    throw new Error(`Tenant não encontrado: ${slug}`)
  }

  // Step 3: Resolve or create Better Auth user (D-22: reuse if email exists)
  const { userId } = await resolveOrCreateUser(parsed.email, parsed.password, parsed.name, headers)

  const ip = extractClientIp(headers)

  // Steps 4-6: All DB writes inside withTenant (RLS enforced)
  const result = await withTenant(tenant.id, async (db) => {
    // Step 4: Add member row (direct Drizzle INSERT — idempotent via ON CONFLICT)
    // Phase 0 invariant: organization.id === tenant.id, so organizationId = tenant.id.
    const existingMember = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, tenant.id)))
      .limit(1)

    if (!existingMember[0]) {
      await db.insert(member).values({
        tenantId: tenant.id,
        organizationId: tenant.id, // org.id === tenant.id (Phase 0 invariant)
        userId,
        role: 'member',
      })
    }

    // Step 5: Create vendor row (Phase 1 reuse — handles CNPJ Layer 2, audit, email job)
    const vendor = await createVendorInTenant(
      db,
      tenant.id,
      {
        legalName: parsed.legalName,
        tradeName: parsed.tradeName ?? null,
        cnpj: parsed.cnpj,
        email: parsed.email,
        phone: parsed.phone ?? null,
      },
      userId,
    )

    // Step 6: INSERT vendor_consents rows for each granted consent type (D-24)
    const consentTypes: Array<'marketing' | 'analytics' | 'payment_data'> = [
      'marketing',
      'analytics',
      'payment_data',
    ]

    for (const consentType of consentTypes) {
      if (parsed.consents[consentType]) {
        await db.insert(vendorConsents).values({
          tenantId: tenant.id,
          vendorId: vendor.id,
          consentType,
          consentText: LGPD_CONSENT_TEXTS[consentType],
          consentVersion: LGPD_CONSENT_VERSION_V2,
          ipAddress: ip,
        })

        await recordAudit(db, {
          action: 'vendor_consent.granted',
          entity: 'vendor_consent',
          entityId: vendor.id,
          userId,
          payload: {
            consent_type: consentType,
            consent_version: LGPD_CONSENT_VERSION_V2,
            ip_address: ip,
          },
        })
      }
    }

    return {
      vendorId: vendor.id,
      userId,
      redirectTo: `/${slug}/portal`,
    }
  })

  return result
}

// ────────────────────────────────────────────────────────────────────────────
// Thin Server Action wrapper (for client form submission via Next.js)
// ────────────────────────────────────────────────────────────────────────────

import { headers as nextHeaders } from 'next/headers'

/**
 * Thin Next.js Server Action — reads headers via next/headers and delegates
 * to signupFornecedorForTenant. Client form calls this directly.
 */
export async function signupFornecedor(
  slug: string,
  input: SignupFornecedorInput,
): Promise<SignupFornecedorResult> {
  const h = await nextHeaders()
  return signupFornecedorForTenant(slug, input, h)
}
