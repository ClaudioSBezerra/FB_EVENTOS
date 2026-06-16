"use strict";
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
'use server';
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.signupFornecedorForTenant = signupFornecedorForTenant;
exports.signupFornecedor = signupFornecedor;
const drizzle_orm_1 = require("drizzle-orm");
const server_1 = require("@/auth/server");
const db_1 = require("@/db");
const auth_1 = require("@/db/schema/auth");
const vendor_consents_1 = require("@/db/schema/vendor_consents");
const with_tenant_1 = require("@/db/with-tenant");
const fornecedores_1 = require("@/lib/actions/fornecedores");
const audit_1 = require("@/lib/audit");
const tenant_1 = require("@/lib/tenant");
const signup_fornecedor_1 = require("@/lib/validators/signup-fornecedor");
// ────────────────────────────────────────────────────────────────────────────
// IP extraction (mirrors src/lib/actions/consent.ts:45-56 verbatim)
// ────────────────────────────────────────────────────────────────────────────
function extractClientIp(headerMap) {
    const xff = headerMap.get('x-forwarded-for');
    if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first)
            return first;
    }
    const xri = headerMap.get('x-real-ip');
    if (xri)
        return xri.trim();
    return 'unknown';
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
async function resolveOrCreateUser(email, password, name, headers) {
    const clientIp = extractClientIp(headers);
    const userAgent = headers.get('user-agent') ?? 'fb-eventos-server/0';
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
            consentVersion: signup_fornecedor_1.LGPD_CONSENT_VERSION_V2,
            consentAt: new Date().toISOString(),
        }),
    });
    const signUpRes = await server_1.auth.handler(signUpReq);
    // Parse sign-up response (regardless of status — Better Auth may return 200
    // with a user object even for duplicate-email signups, but that userId may
    // not actually be persisted in the DB — see D-22 investigation in plan notes).
    // biome-ignore lint/suspicious/noExplicitAny: Better Auth response shape varies by version
    let signUpBody = null;
    if (signUpRes.ok) {
        signUpBody = await signUpRes.json().catch(() => null);
    }
    const signUpUserId = signUpBody?.user?.id ?? signUpBody?.id;
    if (signUpUserId) {
        // Verify the userId is actually persisted in the DB (Better Auth may return
        // a userId in the response for duplicate-email signups that it then rolls
        // back due to the unique constraint — see D-22 investigation).
        const verifyRows = await db_1.db
            .select({ id: auth_1.user.id })
            .from(auth_1.user)
            .where((0, drizzle_orm_1.eq)(auth_1.user.id, signUpUserId))
            .limit(1);
        if (verifyRows[0])
            return { userId: signUpUserId };
    }
    // Step B: Fall back to email lookup (covers D-22 cross-tenant reuse where
    // sign-up returned 200 with a non-persisted userId OR returned 4xx).
    // The `user` table has no RLS (global lookup), so the singleton `db` can
    // query it without a withTenant context. This avoids the sign-in path which
    // is blocked by requireEmailVerification: true on existing unverified users.
    const existingRows = await db_1.db
        .select({ id: auth_1.user.id })
        .from(auth_1.user)
        .where((0, drizzle_orm_1.eq)(auth_1.user.email, email))
        .limit(1);
    const existing = existingRows[0];
    if (existing)
        return { userId: existing.id };
    // If we reach here, sign-up failed for a reason OTHER than duplicate email
    // (e.g., invalid password policy, missing required fields). Surface error.
    throw new Error(`Não foi possível criar a conta (status=${signUpRes.status}). Verifique os dados e tente novamente.`);
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
async function signupFornecedorForTenant(slug, input, headers) {
    // Step 1: Validate input — throws ZodError for missing payment_data consent
    // (T-02-02-02 mitigation: server blocks bypass even if client-side removed the check)
    const parsed = signup_fornecedor_1.signupFornecedorSchema.parse(input);
    // Step 2: Resolve tenant — T-02-02-01 mitigation: verify slug before any DB write
    const tenant = await (0, tenant_1.resolveTenantBySlug)(slug);
    if (!tenant) {
        throw new Error(`Tenant não encontrado: ${slug}`);
    }
    // Step 3: Resolve or create Better Auth user (D-22: reuse if email exists)
    const { userId } = await resolveOrCreateUser(parsed.email, parsed.password, parsed.name, headers);
    const ip = extractClientIp(headers);
    // Steps 4-6: All DB writes inside withTenant (RLS enforced)
    const result = await (0, with_tenant_1.withTenant)(tenant.id, async (db) => {
        // Step 4: Add member row (direct Drizzle INSERT — idempotent via ON CONFLICT)
        // Phase 0 invariant: organization.id === tenant.id, so organizationId = tenant.id.
        const existingMember = await db
            .select({ id: auth_1.member.id })
            .from(auth_1.member)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(auth_1.member.userId, userId), (0, drizzle_orm_1.eq)(auth_1.member.organizationId, tenant.id)))
            .limit(1);
        if (!existingMember[0]) {
            await db.insert(auth_1.member).values({
                tenantId: tenant.id,
                organizationId: tenant.id, // org.id === tenant.id (Phase 0 invariant)
                userId,
                role: 'member',
            });
        }
        // Step 5: Create vendor row (Phase 1 reuse — handles CNPJ Layer 2, audit, email job)
        const vendor = await (0, fornecedores_1.createVendorInTenant)(db, tenant.id, {
            legalName: parsed.legalName,
            tradeName: parsed.tradeName ?? null,
            cnpj: parsed.cnpj,
            email: parsed.email,
            phone: parsed.phone ?? null,
        }, userId);
        // Step 6: INSERT vendor_consents rows for each granted consent type (D-24)
        const consentTypes = [
            'marketing',
            'analytics',
            'payment_data',
        ];
        for (const consentType of consentTypes) {
            if (parsed.consents[consentType]) {
                await db.insert(vendor_consents_1.vendorConsents).values({
                    tenantId: tenant.id,
                    vendorId: vendor.id,
                    consentType,
                    consentText: signup_fornecedor_1.LGPD_CONSENT_TEXTS[consentType],
                    consentVersion: signup_fornecedor_1.LGPD_CONSENT_VERSION_V2,
                    ipAddress: ip,
                });
                await (0, audit_1.recordAudit)(db, {
                    action: 'vendor_consent.granted',
                    entity: 'vendor_consent',
                    entityId: vendor.id,
                    userId,
                    payload: {
                        consent_type: consentType,
                        consent_version: signup_fornecedor_1.LGPD_CONSENT_VERSION_V2,
                        ip_address: ip,
                    },
                });
            }
        }
        return {
            vendorId: vendor.id,
            userId,
            redirectTo: `/${slug}/portal`,
        };
    });
    return result;
}
// ────────────────────────────────────────────────────────────────────────────
// Thin Server Action wrapper (for client form submission via Next.js)
// ────────────────────────────────────────────────────────────────────────────
const headers_1 = require("next/headers");
/**
 * Thin Next.js Server Action — reads headers via next/headers and delegates
 * to signupFornecedorForTenant. Client form calls this directly.
 */
async function signupFornecedor(slug, input) {
    const h = await (0, headers_1.headers)();
    return signupFornecedorForTenant(slug, input, h);
}
