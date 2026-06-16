"use strict";
// FB_EVENTOS — Graphile-Worker task: email.send-status-update
// (Phase 1, Plan 01-08 — ORG-17).
//
// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Pitfall 8 — withTenant() inside the worker (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// Like every other tenant-scoped task in this codebase, this handler MUST
// wrap its body in withTenant(payload.tenant_id, fn). Without it, every
// SELECT against vendors/contracts/payments/tenants returns 0 rows
// (RLS default-deny) and the email is silently never sent.
//
// Failure-mode probe: tests/email/send-status-update.test.ts case
// "worker without withTenant — vendor invisible → throws".
//
// Flow per event:
//   1. Parse payload via Zod (tenant_id + event + per-event refs).
//   2. withTenant(tenant_id):
//      a. Resolve tenant (slug + name) from `tenants` global lookup.
//      b. Per event, resolve recipient(s) + template data.
//      c. Render template via templateRegistry[event](data).
//      d. sendEmail({to, subject, text, html}).
//      e. recordAudit('email.sent', {template, recipient_email_hash, ...}).
//
// AUDIT PAYLOAD: email is hashed (SHA-256) before landing in audit_log so
// the audit row does not duplicate PII directly. The vendor row is still
// load-bearing for forensics (audit_log → contracts → vendors join).
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailSendStatusUpdate = exports.emailSendStatusUpdatePayloadSchema = exports.EMAIL_SEND_STATUS_UPDATE_TASK = void 0;
const node_crypto_1 = require("node:crypto");
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const auth_1 = require("@/db/schema/auth");
const contracts_1 = require("@/db/schema/contracts");
const payments_1 = require("@/db/schema/payments");
const tenants_1 = require("@/db/schema/tenants");
const vendors_1 = require("@/db/schema/vendors");
const with_tenant_1 = require("@/db/with-tenant");
const audit_1 = require("@/lib/audit");
const email_1 = require("@/lib/email");
const templates_1 = require("@/lib/email/templates");
const logger_1 = require("@/lib/logger");
const price_1 = require("@/lib/lots/price");
// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
exports.EMAIL_SEND_STATUS_UPDATE_TASK = 'email.send-status-update';
// ────────────────────────────────────────────────────────────────────────────
// Payload schema — uniform envelope, optional per-event fields
// ────────────────────────────────────────────────────────────────────────────
exports.emailSendStatusUpdatePayloadSchema = zod_1.z.object({
    tenant_id: zod_1.z.string().uuid(),
    event: zod_1.z.enum([
        'signup_fornecedor',
        'aprovacao_fornecedor',
        'rejecao_fornecedor',
        'contrato_emitido',
        'contrato_assinado',
        'pagamento_recebido',
    ]),
    vendor_id: zod_1.z.string().uuid().optional(),
    contract_id: zod_1.z.string().uuid().optional(),
    payment_id: zod_1.z.string().uuid().optional(),
    // Optional vendor identity passed straight in payload (Plan 01-04 stub
    // contract — saves a re-query in the handler).
    legal_name: zod_1.z.string().optional(),
    email: zod_1.z.string().optional(),
    reason: zod_1.z.string().optional(),
});
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function sha256(s) {
    return (0, node_crypto_1.createHash)('sha256').update(s.toLowerCase()).digest('hex');
}
// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────
const emailSendStatusUpdate = async (rawPayload, helpers) => {
    const payload = exports.emailSendStatusUpdatePayloadSchema.parse(rawPayload ?? {});
    const log = (0, logger_1.childLogger)({ tenantId: payload.tenant_id });
    await (0, with_tenant_1.withTenant)(payload.tenant_id, async (db) => {
        // 1. Resolve tenant — `tenants` is a global lookup (no RLS) but we
        //    still issue the query through the tenant-scoped db handle to keep
        //    the transaction boundary uniform.
        const tenantRows = await db
            .select({ id: tenants_1.tenants.id, slug: tenants_1.tenants.slug, name: tenants_1.tenants.name })
            .from(tenants_1.tenants)
            .where((0, drizzle_orm_1.eq)(tenants_1.tenants.id, payload.tenant_id))
            .limit(1);
        const tenant = tenantRows[0];
        if (!tenant) {
            throw new Error(`email.send-status-update: tenant ${payload.tenant_id} not found (deleted or wrong id)`);
        }
        const recipients = await resolveRecipients(db, payload);
        if (recipients.length === 0) {
            // No recipients means the row(s) we needed could not be read — RLS
            // boundary or soft-deleted. Throw so Graphile-Worker retries with
            // backoff (consistent with pdf-generate-contract Pitfall 8 contract).
            throw new Error(`email.send-status-update: no recipients resolved for event=${payload.event} (RLS scope?)`);
        }
        // 2. Render per recipient (some templates personalize the body name).
        for (const recipient of recipients) {
            const rendered = renderTemplate(payload.event, payload, tenant, recipient);
            await (0, email_1.sendEmail)({
                to: recipient.email,
                subject: rendered.subject,
                html: rendered.html ?? `<pre>${escapePre(rendered.text)}</pre>`,
                text: rendered.text,
            });
            await (0, audit_1.recordAudit)(db, {
                action: 'email.sent',
                entity: 'email',
                entityId: payload.vendor_id ?? payload.contract_id ?? payload.payment_id,
                userId: TEMPLATE_SYSTEM_USER_ID,
                payload: {
                    template: payload.event,
                    recipient_email_hash: sha256(recipient.email),
                    subject: rendered.subject,
                    tenant_slug: tenant.slug,
                },
            });
        }
        log.info({
            component: 'job',
            task: exports.EMAIL_SEND_STATUS_UPDATE_TASK,
            jobId: String(helpers.job.id),
            event: payload.event,
            recipientCount: recipients.length,
        }, 'status-update email(s) sent');
    });
};
exports.emailSendStatusUpdate = emailSendStatusUpdate;
/**
 * Synthetic system user UUID for audit rows on email sends. Production
 * deployments may swap this for a "system" Better Auth user, but for Phase 1
 * a deterministic UUID keeps recordAudit's NOT NULL constraint satisfied.
 *
 * Audit-log forensics can still trace back to the originating actor via
 * vendor_id / contract_id / payment_id in payload.
 */
const TEMPLATE_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';
function escapePre(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// ────────────────────────────────────────────────────────────────────────────
// Recipient resolution per event
// ────────────────────────────────────────────────────────────────────────────
async function resolveRecipients(db, payload) {
    switch (payload.event) {
        case 'signup_fornecedor':
        case 'aprovacao_fornecedor':
        case 'rejecao_fornecedor':
        case 'contrato_emitido': {
            // Vendor-only events. Prefer payload.email + payload.legal_name when
            // the upstream enqueuer supplied them (avoids a redundant SELECT).
            if (payload.email && payload.legal_name) {
                return [{ email: payload.email, name: payload.legal_name }];
            }
            if (!payload.vendor_id && !payload.contract_id)
                return [];
            let vendorRow;
            if (payload.vendor_id) {
                const rows = await db
                    .select({ email: vendors_1.vendors.email, legalName: vendors_1.vendors.legalName })
                    .from(vendors_1.vendors)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, payload.vendor_id), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
                    .limit(1);
                vendorRow = rows[0];
            }
            else if (payload.contract_id) {
                const rows = await db
                    .select({ email: vendors_1.vendors.email, legalName: vendors_1.vendors.legalName })
                    .from(contracts_1.contracts)
                    .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, contracts_1.contracts.vendorId))
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(contracts_1.contracts.id, payload.contract_id), (0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)))
                    .limit(1);
                vendorRow = rows[0];
            }
            if (!vendorRow)
                return [];
            return [{ email: vendorRow.email, name: vendorRow.legalName }];
        }
        case 'contrato_assinado':
        case 'pagamento_recebido': {
            // Two recipients: organizadora user + vendor.
            const recipients = [];
            // Vendor side — resolved via contract or payment FK chain.
            let vendorRow;
            if (payload.contract_id) {
                const rows = await db
                    .select({ email: vendors_1.vendors.email, legalName: vendors_1.vendors.legalName })
                    .from(contracts_1.contracts)
                    .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, contracts_1.contracts.vendorId))
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(contracts_1.contracts.id, payload.contract_id), (0, drizzle_orm_1.isNull)(contracts_1.contracts.deletedAt)))
                    .limit(1);
                vendorRow = rows[0];
            }
            else if (payload.payment_id) {
                const rows = await db
                    .select({ email: vendors_1.vendors.email, legalName: vendors_1.vendors.legalName })
                    .from(payments_1.payments)
                    .innerJoin(contracts_1.contracts, (0, drizzle_orm_1.eq)(contracts_1.contracts.id, payments_1.payments.contractId))
                    .innerJoin(vendors_1.vendors, (0, drizzle_orm_1.eq)(vendors_1.vendors.id, contracts_1.contracts.vendorId))
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(payments_1.payments.id, payload.payment_id), (0, drizzle_orm_1.isNull)(payments_1.payments.deletedAt)))
                    .limit(1);
                vendorRow = rows[0];
            }
            if (vendorRow)
                recipients.push({ email: vendorRow.email, name: vendorRow.legalName });
            // Organizadora side — first owner-role member of the active tenant.
            const orgRows = await db.select({ id: auth_1.organization.id }).from(auth_1.organization).limit(1);
            const org = orgRows[0];
            if (org) {
                const ownerRows = await db
                    .select({ email: auth_1.user.email, name: auth_1.user.name })
                    .from(auth_1.member)
                    .innerJoin(auth_1.user, (0, drizzle_orm_1.eq)(auth_1.user.id, auth_1.member.userId))
                    .where((0, drizzle_orm_1.eq)(auth_1.member.organizationId, org.id))
                    .orderBy(auth_1.member.createdAt)
                    .limit(1);
                const owner = ownerRows[0];
                if (owner?.email) {
                    recipients.push({ email: owner.email, name: owner.name ?? 'Organizadora' });
                }
            }
            return recipients;
        }
        default: {
            const _exhaustive = payload.event;
            throw new Error(`email.send-status-update: unhandled event ${_exhaustive}`);
        }
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Template rendering per event
// ────────────────────────────────────────────────────────────────────────────
function renderTemplate(event, payload, tenant, recipient) {
    switch (event) {
        case 'signup_fornecedor':
            return templates_1.templateRegistry.signup_fornecedor({
                vendorName: recipient.name,
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
            });
        case 'aprovacao_fornecedor':
            return templates_1.templateRegistry.aprovacao_fornecedor({
                vendorName: recipient.name,
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
            });
        case 'rejecao_fornecedor':
            return templates_1.templateRegistry.rejecao_fornecedor({
                vendorName: recipient.name,
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
                reason: payload.reason ?? 'Motivo não informado',
            });
        case 'contrato_emitido':
            return templates_1.templateRegistry.contrato_emitido({
                vendorName: recipient.name,
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
                contractRef: shortRef(payload.contract_id ?? ''),
            });
        case 'contrato_assinado':
            return templates_1.templateRegistry.contrato_assinado({
                recipientName: recipient.name,
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
                contractRef: shortRef(payload.contract_id ?? ''),
            });
        case 'pagamento_recebido':
            return templates_1.templateRegistry.pagamento_recebido({
                recipientName: recipient.name,
                tenantName: tenant.name,
                tenantSlug: tenant.slug,
                contractRef: shortRef(payload.contract_id ?? ''),
                amountBRL: (0, price_1.formatBRL)(0),
                paymentId: payload.payment_id ?? '',
            });
        default: {
            const _exhaustive = event;
            throw new Error(`email.send-status-update: no template for event ${_exhaustive}`);
        }
    }
}
function shortRef(uuidOrEmpty) {
    if (!uuidOrEmpty)
        return 'N/A';
    return uuidOrEmpty.slice(0, 8).toUpperCase();
}
