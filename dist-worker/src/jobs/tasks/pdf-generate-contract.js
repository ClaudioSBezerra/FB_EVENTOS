"use strict";
// FB_EVENTOS — Graphile-Worker task: pdf.generate-contract
// (Phase 1, Plan 01-05 Task 1).
//
// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Pitfall 8 — withTenant() inside the worker (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// The worker process uses its OWN pg connection (separate pool from web).
// The runner does NOT pre-set `app.current_tenant_id` on that connection.
// Therefore this task MUST wrap its body in
// `withTenant(payload.tenant_id, async (db) => { ... })`. Otherwise RLS
// default-deny returns 0 rows for the contracts/events/vendors/lots reads
// and the job silently no-ops.
//
// Failure-mode probe: tests/contracts/pdf-gen.test.ts case
// "task without withTenant returns no data and the task throws"
//
// Flow:
//   1. Resolve template_version from contracts row → registry → component.
//   2. Load contract + tenant + organization (organizadora) + vendor +
//      event + lot + lot_category in a single JOIN.
//   3. Build the FornecedorStandV1Params shape (denormalized).
//   4. generateContractPdf({ templateVersion, params }) → Buffer.
//   5. MinIO putObject contracts/{contractId}/contract-v1.pdf.
//   6. UPDATE contracts.pdf_minio_key.
//   7. recordAudit('contract.pdf_generated').
//   8. Enqueue zapsign.send-contract { contract_id, tenant_id } in the
//      SAME withTenant transaction (outbox: if commit succeeds, the
//      zapsign job is durable; if rollback, the next job never queued).
//
// AUDIT PAYLOAD: contains template_version + pdf_minio_key + lot_code only
// — no PII (vendor CNPJ / email / razão social) per audit hygiene. The
// vendor row is loaded inside the same tenant scope so consumers can join
// audit_log → contracts → vendors when needed.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORNECEDOR_STAND_V1_VERSION = exports.pdfGenerateContract = exports.ZAPSIGN_SEND_CONTRACT_TASK = exports.PDF_GENERATE_CONTRACT_TASK = exports.pdfGenerateContractPayloadSchema = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const generate_pdf_1 = require("@/contracts/generate-pdf");
const templates_1 = require("@/contracts/templates");
Object.defineProperty(exports, "FORNECEDOR_STAND_V1_VERSION", { enumerable: true, get: function () { return templates_1.FORNECEDOR_STAND_V1_VERSION; } });
const auth_1 = require("@/db/schema/auth");
const contracts_1 = require("@/db/schema/contracts");
const events_1 = require("@/db/schema/events");
const lots_1 = require("@/db/schema/lots");
const vendors_1 = require("@/db/schema/vendors");
const with_tenant_1 = require("@/db/with-tenant");
const enqueue_1 = require("@/jobs/enqueue");
const raw_sql_from_tenant_db_1 = require("@/jobs/raw-sql-from-tenant-db");
const audit_1 = require("@/lib/audit");
const logger_1 = require("@/lib/logger");
const price_1 = require("@/lib/lots/price");
const minio_1 = require("@/lib/storage/minio");
// ────────────────────────────────────────────────────────────────────────────
// Payload schema (job invariants)
// ────────────────────────────────────────────────────────────────────────────
exports.pdfGenerateContractPayloadSchema = zod_1.z.object({
    tenant_id: zod_1.z.string().uuid(),
    tenant_slug: zod_1.z.string().min(1),
    contract_id: zod_1.z.string().uuid(),
    user_id: zod_1.z.string().uuid(),
});
// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
exports.PDF_GENERATE_CONTRACT_TASK = 'pdf.generate-contract';
exports.ZAPSIGN_SEND_CONTRACT_TASK = 'zapsign.send-contract';
function contractObjectKey(contractId) {
    // contracts/{contractId}/contract-v1.pdf — versioned filename so a
    // template_version bump (Phase 3) lands as a sibling object, not an
    // overwrite. Aligned with D-08 reproducibility.
    return `contracts/${contractId}/contract-v1.pdf`;
}
// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────
const pdfGenerateContract = async (rawPayload, helpers) => {
    const payload = exports.pdfGenerateContractPayloadSchema.parse(rawPayload ?? {});
    const log = (0, logger_1.childLogger)({ tenantId: payload.tenant_id });
    await (0, with_tenant_1.withTenant)(payload.tenant_id, async (db) => {
        // Single JOIN — tenant-scoped (RLS enforces the boundary). Drizzle's
        // .innerJoin returns a tuple; we destructure manually.
        const rows = await db
            .select({
            contract: contracts_1.contracts,
            event: events_1.events,
            vendor: vendors_1.vendors,
            lot: lots_1.lots,
            category: lots_1.lotCategories,
        })
            .from(contracts_1.contracts)
            .innerJoin(events_1.events, (0, drizzle_orm_1.eq)(events_1.events.id, contracts_1.contracts.eventId))
            .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, contracts_1.contracts.vendorId))
            .innerJoin(lots_1.lots, (0, drizzle_orm_1.eq)(lots_1.lots.id, contracts_1.contracts.lotId))
            .innerJoin(lots_1.lotCategories, (0, drizzle_orm_1.eq)(lots_1.lotCategories.id, lots_1.lots.categoryId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(contracts_1.contracts.id, payload.contract_id), (0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)))
            .limit(1);
        const row = rows[0];
        if (!row) {
            // The task throws so Graphile-Worker retries with backoff. RLS-no-
            // worker contract: this MUST throw — silently completing would
            // strand the contract in `draft` forever.
            throw new Error(`pdf.generate-contract: contract ${payload.contract_id} not found in tenant ${payload.tenant_id} (RLS scope)`);
        }
        // Lookup organizadora display name from the org row (single tenant has
        // one organization in Phase 1 — Better Auth's organization plugin).
        const orgRows = await db.select({ name: auth_1.organization.name }).from(auth_1.organization).limit(1);
        const orgName = orgRows[0]?.name ?? 'Organizadora';
        // Compute the lote price (aditivo: base_fixed + area × per_sqm_rate)
        // and format for the contract body.
        const price = (0, price_1.computeLotPrice)({ baseFixed: row.category.baseFixed, perSqmRate: row.category.perSqmRate }, { areaM2: row.lot.areaM2 });
        const params = {
            contractNumber: row.contract.id.slice(0, 8).toUpperCase(),
            organizadora: { name: orgName },
            fornecedor: {
                legalName: row.vendor.legalName,
                cnpj: row.vendor.cnpj,
                email: row.vendor.email,
            },
            evento: {
                name: row.event.name,
                placeName: row.event.placeName,
                placeAddress: row.event.placeAddress,
                startsAt: row.event.startsAt,
                endsAt: row.event.endsAt,
            },
            lote: {
                code: row.lot.code,
                areaM2: Number(row.lot.areaM2),
                categoryName: row.category.name,
                valueBRL: (0, price_1.formatBRL)(price),
            },
            generatedAt: new Date(),
        };
        // Generate + upload.
        const buffer = await (0, generate_pdf_1.generateContractPdf)({
            templateVersion: row.contract.templateVersion,
            params,
        });
        const objectKey = contractObjectKey(row.contract.id);
        await (0, minio_1.getMinIOClient)().putObject((0, minio_1.getTenantBucket)(payload.tenant_slug), objectKey, buffer, buffer.length, { 'Content-Type': 'application/pdf' });
        // Persist pdf_minio_key.
        await db
            .update(contracts_1.contracts)
            .set({ pdfMinioKey: objectKey, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(contracts_1.contracts.id, row.contract.id));
        await (0, audit_1.recordAudit)(db, {
            action: 'contract.pdf_generated',
            entity: 'contract',
            entityId: row.contract.id,
            userId: payload.user_id,
            payload: {
                template_version: row.contract.templateVersion,
                pdf_minio_key: objectKey,
                lot_code: row.lot.code,
            },
        });
        // Outbox: enqueue zapsign.send-contract atomically with the UPDATE
        // above. If the worker process dies between UPDATE and enqueue, the
        // transaction rolls back and the original pdf.generate-contract retry
        // picks up cleanly. Same pattern as Plan 01-04 (rawSqlFromTenantDb).
        await (0, enqueue_1.enqueueJob)((0, raw_sql_from_tenant_db_1.rawSqlFromTenantDb)(db), exports.ZAPSIGN_SEND_CONTRACT_TASK, {
            tenant_id: payload.tenant_id,
            tenant_slug: payload.tenant_slug,
            contract_id: row.contract.id,
            user_id: payload.user_id,
        });
        log.info({
            component: 'job',
            task: exports.PDF_GENERATE_CONTRACT_TASK,
            jobId: String(helpers.job.id),
            contractId: row.contract.id,
            templateVersion: row.contract.templateVersion,
            pdfMinioKey: objectKey,
        }, 'contract PDF generated');
    });
};
exports.pdfGenerateContract = pdfGenerateContract;
