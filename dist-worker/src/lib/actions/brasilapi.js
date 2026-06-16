"use strict";
// FB_EVENTOS — BrasilAPI CNPJ lookup Server Action (Phase 1, Plan 01-04 — Task 1).
//
// 2-layer CNPJ validation (D-16):
//   - Layer 1 (cnpjSchema in src/lib/validators/cnpj.ts): format + mod-11 DVs.
//   - Layer 2 (this file): BrasilAPI lookup confirming `situacao_cadastral`.
//
// CACHE POLICY (7 days, success only):
//   - cached_at < 7 days AND payload represents an ATIVA response → cache hit.
//   - Inactive / 404 / 5xx / timeout responses are NEVER cached because:
//     • Status is volatile (BAIXADA → ATIVA can flip overnight).
//     • Failure caching causes a hot CNPJ to stay broken for 7 days.
//
// GRACEFUL DEGRADATION (D-16):
//   - 5xx / timeout / network error → `{ verified: null, source: 'degraded' }`.
//     The caller (createVendor) accepts the cadastro with cnpj_verified=false
//     and an audit row records the degradation. The organizadora can manually
//     re-trigger the lookup later when BrasilAPI returns.
//   - 404 → `{ verified: false, source: 'brasilapi', reason: 'not_found' }`.
//     The form rejects the submission — the CNPJ does not exist at Receita.
//
// AUTH GATE (NOT withTenantAction):
//   This action uses `authedAction` because the cnpj_lookup_cache is a global
//   (cross-tenant) public-data cache — there is no tenant context to scope it
//   to. The authedAction gate prevents an anonymous DoS that would exhaust
//   BrasilAPI's free-tier budget.
//
// AUDIT REDACTION:
//   The audit_log row carries `cnpj_redacted` (last 4 digits only) so the
//   audit trail never persists a full CNPJ — this matches the redactCNPJ()
//   helper in src/lib/validators/cnpj.ts.
//
// REFERENCES:
//   - 01-CONTEXT.md D-16 (2-layer + degrade)
//   - 01-RESEARCH.md §A3 / §A10 (BrasilAPI shape; situacao_cadastral=2=ATIVA)
//   - src/lib/validators/cnpj.ts (Layer 1)
//   - src/db/schema/cnpj-cache.ts + migration 0012
'use server';
// FB_EVENTOS — BrasilAPI CNPJ lookup Server Action (Phase 1, Plan 01-04 — Task 1).
//
// 2-layer CNPJ validation (D-16):
//   - Layer 1 (cnpjSchema in src/lib/validators/cnpj.ts): format + mod-11 DVs.
//   - Layer 2 (this file): BrasilAPI lookup confirming `situacao_cadastral`.
//
// CACHE POLICY (7 days, success only):
//   - cached_at < 7 days AND payload represents an ATIVA response → cache hit.
//   - Inactive / 404 / 5xx / timeout responses are NEVER cached because:
//     • Status is volatile (BAIXADA → ATIVA can flip overnight).
//     • Failure caching causes a hot CNPJ to stay broken for 7 days.
//
// GRACEFUL DEGRADATION (D-16):
//   - 5xx / timeout / network error → `{ verified: null, source: 'degraded' }`.
//     The caller (createVendor) accepts the cadastro with cnpj_verified=false
//     and an audit row records the degradation. The organizadora can manually
//     re-trigger the lookup later when BrasilAPI returns.
//   - 404 → `{ verified: false, source: 'brasilapi', reason: 'not_found' }`.
//     The form rejects the submission — the CNPJ does not exist at Receita.
//
// AUTH GATE (NOT withTenantAction):
//   This action uses `authedAction` because the cnpj_lookup_cache is a global
//   (cross-tenant) public-data cache — there is no tenant context to scope it
//   to. The authedAction gate prevents an anonymous DoS that would exhaust
//   BrasilAPI's free-tier budget.
//
// AUDIT REDACTION:
//   The audit_log row carries `cnpj_redacted` (last 4 digits only) so the
//   audit trail never persists a full CNPJ — this matches the redactCNPJ()
//   helper in src/lib/validators/cnpj.ts.
//
// REFERENCES:
//   - 01-CONTEXT.md D-16 (2-layer + degrade)
//   - 01-RESEARCH.md §A3 / §A10 (BrasilAPI shape; situacao_cadastral=2=ATIVA)
//   - src/lib/validators/cnpj.ts (Layer 1)
//   - src/db/schema/cnpj-cache.ts + migration 0012
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupCNPJ = void 0;
exports.lookupCNPJCore = lookupCNPJCore;
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const db_1 = require("@/db");
const cnpj_cache_1 = require("@/db/schema/cnpj-cache");
const with_tenant_1 = require("@/db/with-tenant");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const tenant_1 = require("@/lib/tenant");
const cnpj_1 = require("@/lib/validators/cnpj");
const brasilapi_shared_1 = require("./brasilapi.shared");
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function isSituacaoAtiva(payload) {
    const num = payload.situacao_cadastral;
    if (typeof num === 'number')
        return num === brasilapi_shared_1.SITUACAO_ATIVA;
    if (typeof num === 'string') {
        // Accept both "2" and "ATIVA" (defensive — BrasilAPI returns the numeric
        // code, but a future shape change should still resolve correctly).
        if (num.trim() === String(brasilapi_shared_1.SITUACAO_ATIVA))
            return true;
        if (num.trim().toUpperCase() === 'ATIVA')
            return true;
    }
    const desc = payload.descricao_situacao_cadastral;
    if (typeof desc === 'string' && desc.trim().toUpperCase() === 'ATIVA')
        return true;
    return false;
}
function describeSituacao(payload) {
    const desc = payload.descricao_situacao_cadastral;
    if (typeof desc === 'string' && desc.length > 0)
        return desc;
    const num = payload.situacao_cadastral;
    if (num != null)
        return String(num);
    return null;
}
async function readCache(cnpj) {
    // cnpj_lookup_cache has NO RLS (global cache of public data). Read via the
    // singleton db pool — no withTenant required.
    const rows = await db_1.db
        .select()
        .from(cnpj_cache_1.cnpjLookupCache)
        .where((0, drizzle_orm_1.sql) `${cnpj_cache_1.cnpjLookupCache.cnpj} = ${cnpj}`)
        .limit(1);
    const row = rows[0];
    if (!row)
        return null;
    return {
        cnpj: row.cnpj,
        payload: row.payload,
        cachedAt: row.cachedAt,
    };
}
function isCacheFresh(cachedAt) {
    const ageMs = Date.now() - cachedAt.getTime();
    const ttlMs = brasilapi_shared_1.CNPJ_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    return ageMs < ttlMs;
}
async function writeCache(cnpj, payload) {
    // INSERT … ON CONFLICT (cnpj) DO UPDATE — refresh the row + cached_at.
    await db_1.db
        .insert(cnpj_cache_1.cnpjLookupCache)
        .values({ cnpj, payload, cachedAt: new Date() })
        .onConflictDoUpdate({
        target: cnpj_cache_1.cnpjLookupCache.cnpj,
        set: {
            payload: (0, drizzle_orm_1.sql) `excluded.payload`,
            cachedAt: (0, drizzle_orm_1.sql) `excluded.cached_at`,
        },
    });
}
async function fetchBrasilAPI(cnpj) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), brasilapi_shared_1.BRASILAPI_TIMEOUT_MS);
    try {
        const res = await fetch(`${brasilapi_shared_1.BRASILAPI_BASE_URL}/${cnpj}`, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
        });
        if (res.status === 200) {
            const payload = (await res.json());
            return { ok: true, payload };
        }
        return { ok: false, status: res.status };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof Error && err.name === 'AbortError') {
            return { ok: false, status: 'timeout', message };
        }
        return { ok: false, status: 'network', message };
    }
    finally {
        clearTimeout(timer);
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Audit helper — recordAudit requires a tenant context; we use the caller's
// active organization to land the row in their audit_log. If no tenant
// context is available (org-less authedAction caller), we skip the audit
// rather than throw — the lookup itself is the user-visible deliverable.
// ────────────────────────────────────────────────────────────────────────────
async function tryAudit(orgId, userId, payload) {
    if (!orgId)
        return;
    const tenantId = await (0, tenant_1.fetchTenantIdForOrg)(orgId).catch(() => null);
    if (!tenantId)
        return;
    try {
        await (0, with_tenant_1.withTenant)(tenantId, async (db) => {
            await (0, audit_1.recordAudit)(db, {
                action: 'cnpj.lookup',
                entity: 'cnpj_lookup',
                userId,
                payload,
            });
        });
    }
    catch {
        // Audit-best-effort: a missing app.current_tenant_id (no org context)
        // would otherwise raise 22P02 — swallow because the lookup result is
        // the contract; audit is observability.
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Core lookup logic (pure, testable)
// ────────────────────────────────────────────────────────────────────────────
/**
 * Look up a CNPJ at BrasilAPI with 7-day cache + degradation.
 *
 * Caching policy:
 *   - Only ATIVA (situacao_cadastral=2) responses are persisted.
 *   - Cache fresh for 7 days from cached_at.
 *   - 404 / 5xx / timeout / non-ATIVA responses bypass the cache.
 *
 * @param rawCnpj  formatted or unformatted CNPJ (cnpjSchema parses both).
 */
async function lookupCNPJCore(rawCnpj) {
    const parsed = cnpj_1.cnpjSchema.safeParse(rawCnpj);
    if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'CNPJ inválido';
        throw new Error(message);
    }
    const cnpj = parsed.data; // already normalized to 14 digits
    // 1. Cache hit?
    const cached = await readCache(cnpj);
    if (cached && isCacheFresh(cached.cachedAt) && isSituacaoAtiva(cached.payload)) {
        return {
            verified: true,
            source: 'cache',
            data: cached.payload,
            cnpj,
        };
    }
    // 2. Live BrasilAPI call.
    const live = await fetchBrasilAPI(cnpj);
    if (live.ok) {
        const payload = live.payload;
        if (isSituacaoAtiva(payload)) {
            // Cache only successful ATIVA responses.
            await writeCache(cnpj, payload).catch(() => {
                // Cache write failure is not user-visible; degrade silently.
            });
            return { verified: true, source: 'brasilapi', data: payload, cnpj };
        }
        return {
            verified: false,
            source: 'brasilapi',
            reason: 'inactive',
            situacao: describeSituacao(payload),
            cnpj,
        };
    }
    // 3. Failure handling.
    if (live.status === 404) {
        return { verified: false, source: 'brasilapi', reason: 'not_found', cnpj };
    }
    if (typeof live.status === 'number' && live.status >= 500 && live.status < 600) {
        return {
            verified: null,
            source: 'degraded',
            reason: `brasilapi_${live.status}`,
            cnpj,
        };
    }
    if (live.status === 'timeout') {
        return { verified: null, source: 'degraded', reason: 'timeout', cnpj };
    }
    if (live.status === 'network') {
        return { verified: null, source: 'degraded', reason: 'network', cnpj };
    }
    // Other status codes (e.g., 400, 401) — treat as degraded so the
    // organizadora can still register the vendor pending manual verification.
    return {
        verified: null,
        source: 'degraded',
        reason: `brasilapi_${String(live.status)}`,
        cnpj,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Server Action — authedAction (not withTenantAction; cache is global)
// ────────────────────────────────────────────────────────────────────────────
const lookupCnpjInput = zod_1.z.object({
    cnpj: zod_1.z.string().trim().min(1, 'CNPJ é obrigatório'),
});
exports.lookupCNPJ = safe_action_1.authedAction
    .inputSchema(lookupCnpjInput)
    .action(async ({ ctx, parsedInput }) => {
    const result = await lookupCNPJCore(parsedInput.cnpj);
    const cnpj = (0, cnpj_1.normalizeCNPJ)(parsedInput.cnpj);
    await tryAudit(ctx.orgId, ctx.userId, {
        cnpj_redacted: (0, cnpj_1.redactCNPJ)(cnpj),
        source: result.source,
        verified: result.verified,
        reason: 'reason' in result ? result.reason : null,
    });
    return result;
});
