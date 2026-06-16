"use strict";
// FB_EVENTOS — Vendor (Fornecedor) Server Actions (Phase 1, Plan 01-04 — Task 2).
//
// Five Server Actions wrapped in `withTenantAction`:
//
//   - createVendor   — Zod parse → lookupCNPJCore (Layer 2) → INSERT vendors
//                       (status='pending') → audit → enqueueJob email
//                       `signup_fornecedor`. If BrasilAPI degraded, INSERT
//                       still succeeds with cnpj_verified=false and the
//                       audit row carries the degrade reason — D-16 contract.
//   - updateVendor   — Zod parse → UPDATE (only non-status, non-CNPJ fields)
//                       → audit.
//   - approveVendor  — pending → approved. UPDATE → audit → email job
//                       `aprovacao_fornecedor`.
//   - rejectVendor   — pending → rejected (reason required). UPDATE → audit
//                       → email job `rejecao_fornecedor`.
//   - listVendors    — RLS-scoped SELECT with optional status filter +
//                       case-insensitive trade_name / legal_name / cnpj
//                       search.
//
// PURE-HELPER / THIN-ACTION SPLIT (Plan 01-03 pattern):
//   Every action exports a `*InTenant(db, tenantId, input, userId)` pure
//   helper that tests call directly inside withTenant; the next-safe-action
//   wrapper just delegates. Tests bypass the Better Auth session round-trip.
//
// EMAIL JOB ENQUEUE STUB:
//   Each status transition enqueues a `email.send-status-update` job via
//   `enqueueJob(db, ...)`. The handler is registered in Plan 01-08 — for
//   now we just need the job row to land atomically inside the same
//   transaction as the business UPDATE (outbox pattern). Without atomicity
//   a rollback would leave a phantom email job in the queue.
//
// AUDIT REDACTION:
//   recordAudit payloads carry CNPJ via `redactCNPJ` so the audit_log never
//   persists a full CNPJ — matches Plan 01-04 Task 1 brasilapi.ts pattern.
//
// REFERENCES:
//   - 01-CONTEXT.md ORG-07/08/16 (vendor CRUD + approval FSM)
//   - 01-CONTEXT.md D-15 (Resend templates) / D-16 (CNPJ 2-layer + degrade)
//   - src/lib/actions/lot-assignments.ts (pure-helper + walk-cause-chain pattern)
'use server';
// FB_EVENTOS — Vendor (Fornecedor) Server Actions (Phase 1, Plan 01-04 — Task 2).
//
// Five Server Actions wrapped in `withTenantAction`:
//
//   - createVendor   — Zod parse → lookupCNPJCore (Layer 2) → INSERT vendors
//                       (status='pending') → audit → enqueueJob email
//                       `signup_fornecedor`. If BrasilAPI degraded, INSERT
//                       still succeeds with cnpj_verified=false and the
//                       audit row carries the degrade reason — D-16 contract.
//   - updateVendor   — Zod parse → UPDATE (only non-status, non-CNPJ fields)
//                       → audit.
//   - approveVendor  — pending → approved. UPDATE → audit → email job
//                       `aprovacao_fornecedor`.
//   - rejectVendor   — pending → rejected (reason required). UPDATE → audit
//                       → email job `rejecao_fornecedor`.
//   - listVendors    — RLS-scoped SELECT with optional status filter +
//                       case-insensitive trade_name / legal_name / cnpj
//                       search.
//
// PURE-HELPER / THIN-ACTION SPLIT (Plan 01-03 pattern):
//   Every action exports a `*InTenant(db, tenantId, input, userId)` pure
//   helper that tests call directly inside withTenant; the next-safe-action
//   wrapper just delegates. Tests bypass the Better Auth session round-trip.
//
// EMAIL JOB ENQUEUE STUB:
//   Each status transition enqueues a `email.send-status-update` job via
//   `enqueueJob(db, ...)`. The handler is registered in Plan 01-08 — for
//   now we just need the job row to land atomically inside the same
//   transaction as the business UPDATE (outbox pattern). Without atomicity
//   a rollback would leave a phantom email job in the queue.
//
// AUDIT REDACTION:
//   recordAudit payloads carry CNPJ via `redactCNPJ` so the audit_log never
//   persists a full CNPJ — matches Plan 01-04 Task 1 brasilapi.ts pattern.
//
// REFERENCES:
//   - 01-CONTEXT.md ORG-07/08/16 (vendor CRUD + approval FSM)
//   - 01-CONTEXT.md D-15 (Resend templates) / D-16 (CNPJ 2-layer + degrade)
//   - src/lib/actions/lot-assignments.ts (pure-helper + walk-cause-chain pattern)
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVendorById = exports.listVendors = exports.rejectVendor = exports.approveVendor = exports.updateVendor = exports.createVendor = void 0;
exports.createVendorInTenant = createVendorInTenant;
exports.updateVendorInTenant = updateVendorInTenant;
exports.approveVendorInTenant = approveVendorInTenant;
exports.rejectVendorInTenant = rejectVendorInTenant;
exports.listVendorsInTenant = listVendorsInTenant;
exports.getVendorByIdInTenant = getVendorByIdInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const vendors_1 = require("@/db/schema/vendors");
const enqueue_1 = require("@/jobs/enqueue");
const brasilapi_1 = require("@/lib/actions/brasilapi");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const cnpj_1 = require("@/lib/validators/cnpj");
const vendor_1 = require("@/lib/validators/vendor");
const fornecedores_shared_1 = require("./fornecedores.shared");
function toPersistedVendor(row) {
    return {
        id: row.id,
        tenantId: row.tenantId,
        legalName: row.legalName,
        tradeName: row.tradeName,
        cnpj: row.cnpj,
        cnpjVerified: row.cnpjVerified,
        cnpjCheckedAt: row.cnpjCheckedAt,
        email: row.email,
        phone: row.phone,
        status: row.status,
        approvalReason: row.approvalReason,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
/**
 * Extract the underlying postgres.js TransactionSql from a Drizzle TenantDb.
 *
 * Drizzle's PgTransaction exposes its session as an `@internal` field, but
 * the runtime layout is stable for postgres-js: `tx.session.client` is the
 * `TransactionSql` tag. We need this to call `enqueueJob(tx, ...)` which
 * speaks the raw postgres.js tagged-template protocol so the outbox INSERT
 * lands in the SAME transaction as the business UPDATE (atomicity contract
 * documented in src/jobs/enqueue.ts).
 *
 * If a future Drizzle major version refactors `session.client`, this
 * helper localizes the fix — and the enqueue-job test in tests/jobs/
 * already proves the runtime shape at every commit.
 */
function rawSqlFromTenantDb(db) {
    const internal = db;
    return internal.session.client;
}
async function enqueueStatusEmail(db, tenantId, vendorId, event, extra = {}) {
    await (0, enqueue_1.enqueueJob)(rawSqlFromTenantDb(db), fornecedores_shared_1.EMAIL_STATUS_UPDATE_TASK, {
        tenant_id: tenantId,
        vendor_id: vendorId,
        event,
        ...extra,
    });
}
function describeCnpjLookup(result) {
    if (result.verified === true) {
        return { verified: true, source: result.source, reason: null, situacao: null };
    }
    if (result.verified === false) {
        return {
            verified: false,
            source: result.source,
            reason: result.reason,
            situacao: 'situacao' in result ? (result.situacao ?? null) : null,
        };
    }
    return { verified: false, source: result.source, reason: result.reason, situacao: null };
}
// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers (tests drive these inside withTenant)
// ────────────────────────────────────────────────────────────────────────────
/**
 * Insert a new vendor row. Runs Layer 2 BrasilAPI lookup before INSERT and
 * stores `cnpj_verified` based on the result:
 *   - verified=true  → cnpj_verified=true
 *   - verified=false → cnpj_verified=false + audit row captures reason
 *   - degraded       → cnpj_verified=false + audit captures degradation
 *
 * If the lookup returns reason='inactive' OR 'not_found' the action STILL
 * proceeds with cnpj_verified=false (organizadora can manually verify later
 * via doc upload). If the organizadora wants to block, the UX layer should
 * surface the lookup result to the form and require an explicit
 * "registrar mesmo assim" click — that decision is UX-level, not action-level.
 */
async function createVendorInTenant(db, tenantId, input, userId) {
    // input.cnpj is already normalized to 14 digits by cnpjSchema.transform().
    const normalized = (0, cnpj_1.normalizeCNPJ)(input.cnpj);
    // Layer 2 lookup — never throws on degrade; throws only on validator errors
    // which can't happen here (Zod already accepted the input).
    let lookup;
    try {
        lookup = await (0, brasilapi_1.lookupCNPJCore)(normalized);
    }
    catch (err) {
        // Defensive — should not happen.
        lookup = {
            verified: null,
            source: 'degraded',
            reason: err instanceof Error ? err.message : 'lookup_error',
            cnpj: normalized,
        };
    }
    const lookupInfo = describeCnpjLookup(lookup);
    const rows = await db
        .insert(vendors_1.vendors)
        .values({
        tenantId,
        legalName: input.legalName,
        tradeName: input.tradeName ?? null,
        cnpj: normalized,
        cnpjVerified: lookupInfo.verified,
        cnpjCheckedAt: new Date(),
        email: input.email,
        phone: input.phone ?? null,
        status: 'pending',
    })
        .returning();
    const row = rows[0];
    if (!row)
        throw new Error('createVendorInTenant: insert returned no row');
    await (0, audit_1.recordAudit)(db, {
        action: 'vendor.created',
        entity: 'vendor',
        entityId: row.id,
        userId,
        payload: {
            cnpj_redacted: (0, cnpj_1.redactCNPJ)(normalized),
            cnpj_verified: lookupInfo.verified,
            cnpj_source: lookupInfo.source,
            cnpj_reason: lookupInfo.reason,
            legal_name: input.legalName,
        },
    });
    await enqueueStatusEmail(db, tenantId, row.id, 'signup_fornecedor', {
        legal_name: row.legalName,
        email: row.email,
    });
    return toPersistedVendor(row);
}
/**
 * Update mutable vendor fields. CNPJ + status are NOT updatable here —
 * status flows through approveVendor/rejectVendor and CNPJ is immutable
 * after creation (cadastro re-do replaces the row).
 */
async function updateVendorInTenant(db, input, userId) {
    const patch = {};
    if (input.legalName !== undefined)
        patch.legalName = input.legalName;
    if (input.tradeName !== undefined)
        patch.tradeName = input.tradeName;
    if (input.email !== undefined)
        patch.email = input.email;
    if (input.phone !== undefined)
        patch.phone = input.phone;
    patch.updatedAt = new Date();
    const rows = await db
        .update(vendors_1.vendors)
        .set(patch)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, input.id), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
        .returning();
    const row = rows[0];
    if (!row)
        return null;
    await (0, audit_1.recordAudit)(db, {
        action: 'vendor.updated',
        entity: 'vendor',
        entityId: row.id,
        userId,
        payload: { changes: Object.keys(patch).filter((k) => k !== 'updatedAt') },
    });
    return toPersistedVendor(row);
}
/**
 * Approve a pending vendor. Idempotency: requires status='pending' at the
 * SELECT step (FSM pending → approved | rejected; approved is terminal).
 * The UPDATE WHERE clause re-asserts status='pending' so a concurrent
 * transition is rejected by the row-not-found branch.
 */
async function approveVendorInTenant(db, tenantId, input, userId) {
    if (input.action !== 'approve') {
        throw new Error('approveVendorInTenant: input.action must be "approve"');
    }
    const rows = await db
        .update(vendors_1.vendors)
        .set({
        status: 'approved',
        approvalReason: input.reason ?? null,
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, input.vendorId), (0, drizzle_orm_1.eq)(vendors_1.vendors.status, 'pending'), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
        .returning();
    const row = rows[0];
    if (!row) {
        // Could be: missing, cross-tenant (RLS), already-non-pending. Read back
        // to give a UX-quality diagnosis.
        const existing = await db
            .select({ status: vendors_1.vendors.status })
            .from(vendors_1.vendors)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, input.vendorId), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
            .limit(1);
        if (existing[0]) {
            throw new Error(`Fornecedor já está em status "${existing[0].status}" — aprovação requer status "pending"`);
        }
        throw new Error('Fornecedor não encontrado ou inacessível');
    }
    await (0, audit_1.recordAudit)(db, {
        action: 'vendor.approved',
        entity: 'vendor',
        entityId: row.id,
        userId,
        payload: {
            cnpj_redacted: (0, cnpj_1.redactCNPJ)(row.cnpj),
            reason: input.reason ?? null,
        },
    });
    await enqueueStatusEmail(db, tenantId, row.id, 'aprovacao_fornecedor', {
        legal_name: row.legalName,
        email: row.email,
    });
    return toPersistedVendor(row);
}
/**
 * Reject a pending vendor. Reason is required (Zod enforces; we re-check
 * defensively in case the helper is called outside the action wrapper).
 */
async function rejectVendorInTenant(db, tenantId, input, userId) {
    if (input.action !== 'reject') {
        throw new Error('rejectVendorInTenant: input.action must be "reject"');
    }
    if (!input.reason || input.reason.trim().length === 0) {
        throw new Error('Motivo é obrigatório ao rejeitar fornecedor');
    }
    const rows = await db
        .update(vendors_1.vendors)
        .set({
        status: 'rejected',
        approvalReason: input.reason,
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, input.vendorId), (0, drizzle_orm_1.eq)(vendors_1.vendors.status, 'pending'), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
        .returning();
    const row = rows[0];
    if (!row) {
        const existing = await db
            .select({ status: vendors_1.vendors.status })
            .from(vendors_1.vendors)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, input.vendorId), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
            .limit(1);
        if (existing[0]) {
            throw new Error(`Fornecedor já está em status "${existing[0].status}" — rejeição requer status "pending"`);
        }
        throw new Error('Fornecedor não encontrado ou inacessível');
    }
    await (0, audit_1.recordAudit)(db, {
        action: 'vendor.rejected',
        entity: 'vendor',
        entityId: row.id,
        userId,
        payload: {
            cnpj_redacted: (0, cnpj_1.redactCNPJ)(row.cnpj),
            reason: input.reason,
        },
    });
    await enqueueStatusEmail(db, tenantId, row.id, 'rejecao_fornecedor', {
        legal_name: row.legalName,
        email: row.email,
        reason: input.reason,
    });
    return toPersistedVendor(row);
}
/**
 * RLS-scoped SELECT. Optional `status` filter + optional case-insensitive
 * search across legal_name / trade_name / cnpj. Search is intentionally
 * substring-match (ilike '%term%') — Phase 1 vendor counts are small (≤100s
 * per organizadora), so a sequential scan is fine without trigram indexes.
 */
async function listVendorsInTenant(db, input) {
    const conditions = [(0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)];
    if (input.status) {
        conditions.push((0, drizzle_orm_1.eq)(vendors_1.vendors.status, input.status));
    }
    if (input.search && input.search.length > 0) {
        const term = `%${input.search}%`;
        // For CNPJ search we strip non-digits so "12.345" matches the stored
        // 14-digit form.
        const cnpjTerm = `%${input.search.replace(/\D/g, '')}%`;
        const searchClause = (0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(vendors_1.vendors.legalName, term), (0, drizzle_orm_1.ilike)(vendors_1.vendors.tradeName, term), input.search.replace(/\D/g, '').length > 0 ? (0, drizzle_orm_1.ilike)(vendors_1.vendors.cnpj, cnpjTerm) : undefined);
        if (searchClause)
            conditions.push(searchClause);
    }
    const rows = await db
        .select()
        .from(vendors_1.vendors)
        .where((0, drizzle_orm_1.and)(...conditions))
        .orderBy((0, drizzle_orm_1.desc)(vendors_1.vendors.createdAt), (0, drizzle_orm_1.asc)(vendors_1.vendors.legalName));
    return rows.map(toPersistedVendor);
}
async function getVendorByIdInTenant(db, input) {
    const rows = await db
        .select()
        .from(vendors_1.vendors)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, input.id), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
        .limit(1);
    return rows[0] ? toPersistedVendor(rows[0]) : null;
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8) — thin wrappers
// ────────────────────────────────────────────────────────────────────────────
exports.createVendor = safe_action_1.withTenantAction
    .inputSchema(vendor_1.vendorCreateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await createVendorInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/fornecedores', 'page');
    return row;
});
exports.updateVendor = safe_action_1.withTenantAction
    .inputSchema(vendor_1.vendorUpdateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await updateVendorInTenant(ctx.db, parsedInput, ctx.userId);
    if (!row)
        throw new Error('Fornecedor não encontrado ou inacessível');
    (0, cache_1.revalidatePath)('/[slug]/fornecedores', 'page');
    (0, cache_1.revalidatePath)(`/[slug]/fornecedores/${row.id}`, 'page');
    return row;
});
exports.approveVendor = safe_action_1.withTenantAction
    .inputSchema(vendor_1.vendorApprovalSchema)
    .action(async ({ ctx, parsedInput }) => {
    if (parsedInput.action !== 'approve') {
        throw new Error('approveVendor: use rejectVendor for reject action');
    }
    const row = await approveVendorInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/fornecedores', 'page');
    (0, cache_1.revalidatePath)(`/[slug]/fornecedores/${row.id}`, 'page');
    return row;
});
exports.rejectVendor = safe_action_1.withTenantAction
    .inputSchema(vendor_1.vendorApprovalSchema)
    .action(async ({ ctx, parsedInput }) => {
    if (parsedInput.action !== 'reject') {
        throw new Error('rejectVendor: use approveVendor for approve action');
    }
    const row = await rejectVendorInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/fornecedores', 'page');
    (0, cache_1.revalidatePath)(`/[slug]/fornecedores/${row.id}`, 'page');
    return row;
});
exports.listVendors = safe_action_1.withTenantAction
    .inputSchema(vendor_1.vendorListInputSchema)
    .action(async ({ ctx, parsedInput }) => {
    return listVendorsInTenant(ctx.db, parsedInput);
});
exports.getVendorById = safe_action_1.withTenantAction
    .inputSchema(vendor_1.vendorIdSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await getVendorByIdInTenant(ctx.db, parsedInput);
    if (!row)
        throw new Error('Fornecedor não encontrado');
    return row;
});
