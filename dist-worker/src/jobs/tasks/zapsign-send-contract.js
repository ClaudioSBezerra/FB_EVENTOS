"use strict";
// FB_EVENTOS — Graphile-Worker task: zapsign.send-contract
// (Phase 1, Plan 01-05 Task 2).
//
// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Pitfall 8 — withTenant() inside the worker (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// Like pdf.generate-contract (Plan 01-05 Task 1), this task wraps its body
// in withTenant(payload.tenant_id, fn) so RLS engages. Without that wrap
// the contracts row reads as 0 rows (default-deny) and the job silently
// no-ops.
//
// Flow (D-01 / D-02):
//   1. Load contracts row (must have pdf_minio_key set by Task 1).
//   2. Mint a 15-min pre-signed GET URL for the draft PDF.
//   3. Load organizadora email/name (from active session user via Better
//      Auth's user table — Phase 1: simplified to "first user in the
//      tenant's org" since the organizadora always self-emits contracts).
//   4. Load fornecedor (vendor) email + name.
//   5. POST to ZapSign /api/v1/docs/ with:
//      - signature_order_active: true
//      - signers: [{order_group:1, organizadora}, {order_group:2, fornecedor}]
//      - external_id: contract.id (echoed back on every webhook)
//   6. INSERT zapsign_documents row with zapsign_id + payload_send.
//   7. UPDATE contracts: status='awaiting_org', zapsign_doc_id=<token>.
//   8. recordAudit('contract.zapsign_sent').
//   9. Enqueue email.send-status-update {event:'contrato_emitido'}.
Object.defineProperty(exports, "__esModule", { value: true });
exports.zapsignSendContract = exports.EMAIL_STATUS_UPDATE_TASK = exports.ZAPSIGN_SEND_CONTRACT_TASK = exports.zapsignSendContractPayloadSchema = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const auth_1 = require("@/db/schema/auth");
const contracts_1 = require("@/db/schema/contracts");
const vendors_1 = require("@/db/schema/vendors");
const with_tenant_1 = require("@/db/with-tenant");
const enqueue_1 = require("@/jobs/enqueue");
const raw_sql_from_tenant_db_1 = require("@/jobs/raw-sql-from-tenant-db");
const audit_1 = require("@/lib/audit");
const logger_1 = require("@/lib/logger");
const minio_1 = require("@/lib/storage/minio");
const client_1 = require("@/lib/zapsign/client");
// ────────────────────────────────────────────────────────────────────────────
// Payload schema (mirrors pdf.generate-contract)
// ────────────────────────────────────────────────────────────────────────────
exports.zapsignSendContractPayloadSchema = zod_1.z.object({
    tenant_id: zod_1.z.string().uuid(),
    tenant_slug: zod_1.z.string().min(1),
    contract_id: zod_1.z.string().uuid(),
    user_id: zod_1.z.string().uuid(),
});
// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
exports.ZAPSIGN_SEND_CONTRACT_TASK = 'zapsign.send-contract';
exports.EMAIL_STATUS_UPDATE_TASK = 'email.send-status-update';
// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────
const zapsignSendContract = async (rawPayload, helpers) => {
    const payload = exports.zapsignSendContractPayloadSchema.parse(rawPayload ?? {});
    const log = (0, logger_1.childLogger)({ tenantId: payload.tenant_id });
    await (0, with_tenant_1.withTenant)(payload.tenant_id, async (db) => {
        // 1. Load the contracts row + fornecedor in a single tenant-scoped JOIN.
        const rows = await db
            .select({ contract: contracts_1.contracts, vendor: vendors_1.vendors })
            .from(contracts_1.contracts)
            .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, contracts_1.contracts.vendorId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(contracts_1.contracts.id, payload.contract_id), (0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)))
            .limit(1);
        const row = rows[0];
        if (!row) {
            throw new Error(`zapsign.send-contract: contract ${payload.contract_id} not found in tenant ${payload.tenant_id} (RLS scope)`);
        }
        if (!row.contract.pdfMinioKey) {
            throw new Error(`zapsign.send-contract: contract ${payload.contract_id} has no pdf_minio_key yet — pdf.generate-contract must run first`);
        }
        // 2. Mint a 15-min pre-signed GET URL for the draft PDF.
        const presigned = await (0, minio_1.mintPresignedGet)(payload.tenant_slug, row.contract.pdfMinioKey, 900);
        // 3. Resolve organizadora identity. Phase 1: the active organization
        //    has exactly one tenant; we fetch the owner-role member's user row
        //    for the org's display name + email. If multiple owners exist we
        //    pick the first deterministically (ordered by membership created).
        const orgRows = await db
            .select({ name: auth_1.organization.name, id: auth_1.organization.id })
            .from(auth_1.organization)
            .limit(1);
        const org = orgRows[0];
        if (!org) {
            throw new Error(`zapsign.send-contract: no organization in tenant ${payload.tenant_id}`);
        }
        const ownerRows = await db
            .select({ name: auth_1.user.name, email: auth_1.user.email })
            .from(auth_1.member)
            .innerJoin(auth_1.user, (0, drizzle_orm_1.eq)(auth_1.user.id, auth_1.member.userId))
            .where((0, drizzle_orm_1.eq)(auth_1.member.organizationId, org.id))
            .orderBy(auth_1.member.createdAt)
            .limit(1);
        // Fallback to the job-invoker user if no owner is found.
        let orgSignerName = ownerRows[0]?.name ?? org.name;
        let orgSignerEmail = ownerRows[0]?.email;
        if (!orgSignerEmail) {
            const invoker = await db
                .select({ name: auth_1.user.name, email: auth_1.user.email })
                .from(auth_1.user)
                .where((0, drizzle_orm_1.eq)(auth_1.user.id, payload.user_id))
                .limit(1);
            orgSignerName = invoker[0]?.name ?? orgSignerName;
            orgSignerEmail = invoker[0]?.email;
        }
        if (!orgSignerEmail) {
            throw new Error('zapsign.send-contract: could not resolve organizadora signer email');
        }
        // 4. Build the ZapSign payload.
        const zapsignPayload = {
            name: `Contrato ${row.contract.id.slice(0, 8).toUpperCase()}`,
            url_pdf: presigned.url,
            signers: [
                { name: orgSignerName, email: orgSignerEmail, order_group: 1, send_automatic_email: true },
                {
                    name: row.vendor.legalName,
                    email: row.vendor.email,
                    order_group: 2,
                    send_automatic_email: true,
                },
            ],
            signature_order_active: true,
            lang: 'pt-br',
            external_id: row.contract.id,
        };
        // 5. POST to ZapSign.
        const response = await (0, client_1.createDocument)(zapsignPayload);
        // 6. INSERT zapsign_documents row.
        await db.insert(contracts_1.zapsignDocuments).values({
            tenantId: payload.tenant_id,
            contractId: row.contract.id,
            zapsignId: response.token,
            // Drizzle jsonb columns accept any JSON-serializable value at runtime.
            // biome-ignore lint/suspicious/noExplicitAny: jsonb takes any serializable shape
            payloadSend: zapsignPayload,
        });
        // 7. UPDATE contracts.
        await db
            .update(contracts_1.contracts)
            .set({
            status: 'awaiting_org',
            zapsignDocId: response.token,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(contracts_1.contracts.id, row.contract.id));
        // 8. Audit.
        await (0, audit_1.recordAudit)(db, {
            action: 'contract.zapsign_sent',
            entity: 'contract',
            entityId: row.contract.id,
            userId: payload.user_id,
            payload: {
                zapsign_id: response.token,
                zapsign_open_id: response.open_id,
                signer_count: zapsignPayload.signers.length,
                status_new: 'awaiting_org',
            },
        });
        // 9. Enqueue email job — Plan 01-08 will register the handler. Payload
        //    shape matches the contract pinned by Plan 01-04 notifications.test.
        await (0, enqueue_1.enqueueJob)((0, raw_sql_from_tenant_db_1.rawSqlFromTenantDb)(db), exports.EMAIL_STATUS_UPDATE_TASK, {
            tenant_id: payload.tenant_id,
            contract_id: row.contract.id,
            vendor_id: row.vendor.id,
            event: 'contrato_emitido',
            legal_name: row.vendor.legalName,
            email: row.vendor.email,
        });
        log.info({
            component: 'job',
            task: exports.ZAPSIGN_SEND_CONTRACT_TASK,
            jobId: String(helpers.job.id),
            contractId: row.contract.id,
            zapsignId: response.token,
            zapsignEnv: process.env.ZAPSIGN_ENV ?? 'sandbox',
        }, 'contract sent to ZapSign');
    });
};
exports.zapsignSendContract = zapsignSendContract;
