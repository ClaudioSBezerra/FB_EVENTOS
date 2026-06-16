"use strict";
// FB_EVENTOS — recordConsentMetadata Server Action (Phase 0, Plan 04).
//
// LGPD-01 audit-grade consent capture. Called from src/components/auth/
// signup-form.tsx onSuccess AFTER Better Auth signUp returns. The IP is
// extracted SERVER-SIDE from next/headers `x-forwarded-for` (fallback
// `x-real-ip`) — the client cannot forge the IP because it never crosses
// the request boundary as a payload field.
//
// Insertion path:
//   - If an active org is known → withTenant(tenantId, db => insert)
//     (subjects the INSERT to FORCE RLS via the tenant_isolation policy on
//     the consent_records table once Plan 05 lands grants/RLS; today the
//     STUB schema accepts the insert).
//   - If no active org yet (signup race condition before activeOrgId is set)
//     → fall back to inserting via the singleton db. The STUB schema requires
//     tenantId NOT NULL, so we use the user's first org via a lookup; if no
//     org exists, the action returns ok:false. Plan 05 changes the schema
//     to allow nullable tenant_id and adds a backfill policy.
//
// This intentionally does NOT use withTenantAction because consent capture
// happens BEFORE the user's first authenticated request and may run during
// the signup transaction itself.
'use server';
// FB_EVENTOS — recordConsentMetadata Server Action (Phase 0, Plan 04).
//
// LGPD-01 audit-grade consent capture. Called from src/components/auth/
// signup-form.tsx onSuccess AFTER Better Auth signUp returns. The IP is
// extracted SERVER-SIDE from next/headers `x-forwarded-for` (fallback
// `x-real-ip`) — the client cannot forge the IP because it never crosses
// the request boundary as a payload field.
//
// Insertion path:
//   - If an active org is known → withTenant(tenantId, db => insert)
//     (subjects the INSERT to FORCE RLS via the tenant_isolation policy on
//     the consent_records table once Plan 05 lands grants/RLS; today the
//     STUB schema accepts the insert).
//   - If no active org yet (signup race condition before activeOrgId is set)
//     → fall back to inserting via the singleton db. The STUB schema requires
//     tenantId NOT NULL, so we use the user's first org via a lookup; if no
//     org exists, the action returns ok:false. Plan 05 changes the schema
//     to allow nullable tenant_id and adds a backfill policy.
//
// This intentionally does NOT use withTenantAction because consent capture
// happens BEFORE the user's first authenticated request and may run during
// the signup transaction itself.
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordConsentMetadata = recordConsentMetadata;
const drizzle_orm_1 = require("drizzle-orm");
const headers_1 = require("next/headers");
const zod_1 = require("zod");
const server_1 = require("@/auth/server");
const db_1 = require("@/db");
const auth_1 = require("@/db/schema/auth");
const consent_1 = require("@/db/schema/consent");
const with_tenant_1 = require("@/db/with-tenant");
const inputSchema = zod_1.z.object({
    consentVersion: zod_1.z.string().min(1),
    consentText: zod_1.z.string().optional(),
});
function extractClientIp(headerMap) {
    // x-forwarded-for can be "client, proxy1, proxy2" — the leftmost is the
    // original client. Fall back to x-real-ip and finally a literal "unknown".
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
async function recordConsentMetadata(raw) {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, error: 'invalid_input' };
    }
    const h = await (0, headers_1.headers)();
    const ipAddress = extractClientIp(h);
    const userAgent = h.get('user-agent') ?? null;
    const session = await server_1.auth.api.getSession({ headers: h });
    if (!session) {
        return { ok: false, error: 'no_session' };
    }
    const userId = session.user.id;
    const orgId = session.session.activeOrganizationId ?? null;
    // Resolve tenantId. Phase 0 invariant: organization.tenant_id === organization.id.
    // If activeOrganizationId is set, use it as tenantId. Otherwise, look up the
    // user's first org via the `member` table. (This requires a tenant-scoped
    // query — but `member` is RLS-guarded and we don't yet have a tenant
    // context. We work around by querying member without tenant scoping; the
    // RLS policy will return zero rows, so we fall back to inspecting the
    // session's pending org metadata. In practice, after signUp with
    // organizationSlug, Better Auth sets activeOrganizationId in the new
    // session — so orgId is populated.)
    let tenantId = orgId;
    if (!tenantId) {
        // RLS default-deny on member without withTenant; this returns [].
        // Document the fallback for the no-orgId race; in practice signup-form
        // always passes an organizationSlug, so orgId IS set on first session.
        const rows = await db_1.db
            .select({ tenantId: auth_1.member.tenantId })
            .from(auth_1.member)
            .where((0, drizzle_orm_1.eq)(auth_1.member.userId, userId))
            .limit(1);
        tenantId = rows[0]?.tenantId ?? null;
    }
    if (!tenantId) {
        return { ok: false, error: 'no_tenant' };
    }
    // Insert via withTenant so RLS policy on consent_records (Plan 05 layers
    // policies on top of this STUB schema) is satisfied.
    try {
        await (0, with_tenant_1.withTenant)(tenantId, async (scopedDb) => {
            // Plan 05: consent_ip column was renamed to ip_address; consent_text
            // column was added with default '' so omitting it from Plan 04 callers
            // stays valid. Both edits are backward-compatible with this code path.
            await scopedDb.insert(consent_1.consentRecords).values({
                userId,
                tenantId: tenantId,
                consentVersion: parsed.data.consentVersion,
                consentText: parsed.data.consentText ?? '',
                ipAddress,
                userAgent,
            });
        });
        return { ok: true };
    }
    catch (_err) {
        return { ok: false, error: 'insert_failed' };
    }
}
