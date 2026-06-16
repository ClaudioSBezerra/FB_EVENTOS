"use strict";
// FB_EVENTOS — Contract Server Actions (Phase 1, Plan 01-05 Task 2).
//
// Two Server Actions wrapped in `withTenantAction`:
//
//   - emitContract({lotAssignmentId})
//       Resolves the assignment → vendor + lot + event in tenant scope,
//       INSERTs a `contracts` row at status='draft' with
//       template_version='fornecedor-stand-v1', enqueues the
//       `pdf.generate-contract` job in the SAME transaction (outbox), and
//       records the audit row. The PDF generation task chains the
//       `zapsign.send-contract` job on its own commit.
//
//   - listContracts({eventId?, status?})
//       RLS-scoped SELECT for the contracts dashboard.
//
//   - getContractById({contractId})
//       Single-row read for the detail page.
//
// PURE-HELPER / THIN-ACTION SPLIT (Plan 01-03 / 01-04 pattern):
//   Tests drive the *InTenant pure helpers directly inside withTenant;
//   the next-safe-action wrappers just delegate.
'use server';
// FB_EVENTOS — Contract Server Actions (Phase 1, Plan 01-05 Task 2).
//
// Two Server Actions wrapped in `withTenantAction`:
//
//   - emitContract({lotAssignmentId})
//       Resolves the assignment → vendor + lot + event in tenant scope,
//       INSERTs a `contracts` row at status='draft' with
//       template_version='fornecedor-stand-v1', enqueues the
//       `pdf.generate-contract` job in the SAME transaction (outbox), and
//       records the audit row. The PDF generation task chains the
//       `zapsign.send-contract` job on its own commit.
//
//   - listContracts({eventId?, status?})
//       RLS-scoped SELECT for the contracts dashboard.
//
//   - getContractById({contractId})
//       Single-row read for the detail page.
//
// PURE-HELPER / THIN-ACTION SPLIT (Plan 01-03 / 01-04 pattern):
//   Tests drive the *InTenant pure helpers directly inside withTenant;
//   the next-safe-action wrappers just delegate.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContractById = exports.listContracts = exports.emitContract = void 0;
exports.emitContractInTenant = emitContractInTenant;
exports.listContractsInTenant = listContractsInTenant;
exports.getContractByIdInTenant = getContractByIdInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const contracts_1 = require("@/db/schema/contracts");
const lots_1 = require("@/db/schema/lots");
const vendors_1 = require("@/db/schema/vendors");
const enqueue_1 = require("@/jobs/enqueue");
const raw_sql_from_tenant_db_1 = require("@/jobs/raw-sql-from-tenant-db");
const pdf_generate_contract_1 = require("@/jobs/tasks/pdf-generate-contract");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const tenant_1 = require("@/lib/tenant");
const contract_1 = require("@/lib/validators/contract");
function toPersistedContract(row) {
    return {
        id: row.id,
        tenantId: row.tenantId,
        vendorId: row.vendorId,
        lotId: row.lotId,
        eventId: row.eventId,
        templateVersion: row.templateVersion,
        status: row.status,
        pdfMinioKey: row.pdfMinioKey,
        zapsignDocId: row.zapsignDocId,
        signedPdfMinioKey: row.signedPdfMinioKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (tests drive these inside withTenant)
// ────────────────────────────────────────────────────────────────────────────
/**
 * Emit a draft contract for an active lot_assignment and kick off the
 * PDF-generation pipeline.
 *
 *  - Resolves the active assignment → lot + vendor + event in tenant scope.
 *  - Rejects if the vendor is not status='approved' (defensive — the
 *    assignment creation already gates on this, but a vendor could be
 *    re-rejected between assignment + emit).
 *  - INSERTs contracts row (status='draft', template_version='fornecedor-stand-v1').
 *  - Enqueues `pdf.generate-contract` in the SAME transaction. The PDF
 *    task chains zapsign.send-contract on its own commit.
 *  - recordAudit('contract.emitted') — no PII in payload.
 */
async function emitContractInTenant(db, tenantId, input, userId) {
    // 1. Resolve the assignment + vendor + lot in one tenant-scoped query.
    const assignmentRows = await db
        .select({
        assignment: vendors_1.lotAssignments,
        vendor: vendors_1.vendors,
        lot: lots_1.lots,
    })
        .from(vendors_1.lotAssignments)
        .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, vendors_1.lotAssignments.vendorId))
        .innerJoin(lots_1.lots, (0, drizzle_orm_1.eq)(lots_1.lots.id, vendors_1.lotAssignments.lotId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.lotAssignments.id, input.lotAssignmentId), (0, drizzle_orm_1.isNull)(vendors_1.lotAssignments.deletedAt), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt), (0, drizzle_orm_1.isNull)(lots_1.lots.deletedAt)))
        .limit(1);
    const row = assignmentRows[0];
    if (!row) {
        throw new Error('Atribuição não encontrada ou inacessível');
    }
    if (row.vendor.status !== 'approved') {
        throw new Error(`Fornecedor precisa estar aprovado para emitir contrato (status atual: ${row.vendor.status})`);
    }
    // 2. INSERT contracts row at status='draft'.
    const inserted = await db
        .insert(contracts_1.contracts)
        .values({
        tenantId,
        vendorId: row.vendor.id,
        lotId: row.lot.id,
        eventId: row.lot.eventId,
        templateVersion: pdf_generate_contract_1.FORNECEDOR_STAND_V1_VERSION,
        status: 'draft',
    })
        .returning();
    const contract = inserted[0];
    if (!contract)
        throw new Error('emitContractInTenant: insert returned no row');
    // 3. Outbox enqueue — pdf.generate-contract in the SAME transaction as
    //    the INSERT above. Tenant slug resolved via tenants lookup.
    const tenantSlug = await (0, tenant_1.resolveTenantSlug)(tenantId);
    await (0, enqueue_1.enqueueJob)((0, raw_sql_from_tenant_db_1.rawSqlFromTenantDb)(db), pdf_generate_contract_1.PDF_GENERATE_CONTRACT_TASK, {
        tenant_id: tenantId,
        tenant_slug: tenantSlug,
        contract_id: contract.id,
        user_id: userId,
    });
    // 4. Audit (no PII — just contract + lot + template).
    await (0, audit_1.recordAudit)(db, {
        action: 'contract.emitted',
        entity: 'contract',
        entityId: contract.id,
        userId,
        payload: {
            lot_id: row.lot.id,
            lot_code: row.lot.code,
            vendor_id: row.vendor.id,
            template_version: pdf_generate_contract_1.FORNECEDOR_STAND_V1_VERSION,
        },
    });
    return toPersistedContract(contract);
}
async function listContractsInTenant(db, input) {
    const conds = [(0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)];
    if (input.eventId)
        conds.push((0, drizzle_orm_1.eq)(contracts_1.contracts.eventId, input.eventId));
    if (input.status)
        conds.push((0, drizzle_orm_1.eq)(contracts_1.contracts.status, input.status));
    const rows = await db
        .select()
        .from(contracts_1.contracts)
        .where((0, drizzle_orm_1.and)(...conds))
        .orderBy((0, drizzle_orm_1.desc)(contracts_1.contracts.createdAt));
    return rows.map(toPersistedContract);
}
async function getContractByIdInTenant(db, input) {
    const rows = await db
        .select()
        .from(contracts_1.contracts)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(contracts_1.contracts.id, input.contractId), (0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)))
        .limit(1);
    return rows[0] ? toPersistedContract(rows[0]) : null;
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions
// ────────────────────────────────────────────────────────────────────────────
exports.emitContract = safe_action_1.withTenantAction
    .inputSchema(contract_1.emitContractSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await emitContractInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/contratos', 'page');
    (0, cache_1.revalidatePath)(`/[slug]/contratos/${row.id}`, 'page');
    return row;
});
exports.listContracts = safe_action_1.withTenantAction
    .inputSchema(contract_1.listContractsSchema)
    .action(async ({ ctx, parsedInput }) => {
    return listContractsInTenant(ctx.db, parsedInput);
});
exports.getContractById = safe_action_1.withTenantAction
    .inputSchema(contract_1.contractIdSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await getContractByIdInTenant(ctx.db, parsedInput);
    if (!row)
        throw new Error('Contrato não encontrado');
    return row;
});
