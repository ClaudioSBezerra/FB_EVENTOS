"use strict";
// FB_EVENTOS — Vendor document cofre Server Actions (Phase 1, Plan 01-04 — Task 3).
//
// Four Server Actions wrapped in `withTenantAction`:
//
//   - mintVendorDocUploadUrl   — verify vendor in tenant; generate
//                                pre-signed PUT (TTL 5min) under
//                                `vendor-docs/{vendorId}/{cryptoRandom-16}-
//                                {sanitize(fileName)}` with PDF/PNG/JPG
//                                content-type lock and ≤25 MB cap.
//   - confirmVendorDocUpload   — after browser PUT, statObject verifies
//                                content-type + size match; on success
//                                INSERT vendor_documents row + audit row.
//   - mintVendorDocDownloadUrl — verify doc in tenant; pre-signed GET
//                                (TTL 15min); EVERY download generates an
//                                audit_log row (LGPD-relevant access trail).
//   - deleteVendorDoc          — soft-delete vendor_documents row + audit.
//
// Pure-helper / thin-action split (Plan 01-03 pattern): every action exports
// a `*InTenant(db, tenantId, input, userId)` pure helper that tests drive.
//
// MinIO key shape: `vendor-docs/{vendorId}/{cryptoRandom16}-{sanitize(fileName)}.{ext}`.
// Extension is forced from the declared content-type so the confirm step can
// re-derive the expected content-type from the key (matches the pattern in
// src/lib/actions/minio-presign.ts).
//
// REFERENCES:
//   - 01-CONTEXT.md ORG-15 (doc cofre) / D-05 / D-06 (MinIO PUT/GET TTL)
//   - src/lib/actions/minio-presign.ts (Plan 01-02 pattern reference)
//   - src/db/schema/vendors.ts (vendor_documents table — Plan 01-01)
'use server';
// FB_EVENTOS — Vendor document cofre Server Actions (Phase 1, Plan 01-04 — Task 3).
//
// Four Server Actions wrapped in `withTenantAction`:
//
//   - mintVendorDocUploadUrl   — verify vendor in tenant; generate
//                                pre-signed PUT (TTL 5min) under
//                                `vendor-docs/{vendorId}/{cryptoRandom-16}-
//                                {sanitize(fileName)}` with PDF/PNG/JPG
//                                content-type lock and ≤25 MB cap.
//   - confirmVendorDocUpload   — after browser PUT, statObject verifies
//                                content-type + size match; on success
//                                INSERT vendor_documents row + audit row.
//   - mintVendorDocDownloadUrl — verify doc in tenant; pre-signed GET
//                                (TTL 15min); EVERY download generates an
//                                audit_log row (LGPD-relevant access trail).
//   - deleteVendorDoc          — soft-delete vendor_documents row + audit.
//
// Pure-helper / thin-action split (Plan 01-03 pattern): every action exports
// a `*InTenant(db, tenantId, input, userId)` pure helper that tests drive.
//
// MinIO key shape: `vendor-docs/{vendorId}/{cryptoRandom16}-{sanitize(fileName)}.{ext}`.
// Extension is forced from the declared content-type so the confirm step can
// re-derive the expected content-type from the key (matches the pattern in
// src/lib/actions/minio-presign.ts).
//
// REFERENCES:
//   - 01-CONTEXT.md ORG-15 (doc cofre) / D-05 / D-06 (MinIO PUT/GET TTL)
//   - src/lib/actions/minio-presign.ts (Plan 01-02 pattern reference)
//   - src/db/schema/vendors.ts (vendor_documents table — Plan 01-01)
Object.defineProperty(exports, "__esModule", { value: true });
exports.listVendorDocs = exports.deleteVendorDoc = exports.mintVendorDocDownloadUrl = exports.confirmVendorDocUpload = exports.mintVendorDocUploadUrl = void 0;
exports.mintVendorDocUploadUrlInTenant = mintVendorDocUploadUrlInTenant;
exports.confirmVendorDocUploadInTenant = confirmVendorDocUploadInTenant;
exports.mintVendorDocDownloadUrlInTenant = mintVendorDocDownloadUrlInTenant;
exports.deleteVendorDocInTenant = deleteVendorDocInTenant;
exports.listVendorDocsInTenant = listVendorDocsInTenant;
const node_crypto_1 = require("node:crypto");
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const db_1 = require("@/db");
const tenants_1 = require("@/db/schema/tenants");
const vendors_1 = require("@/db/schema/vendors");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const minio_1 = require("@/lib/storage/minio");
// ────────────────────────────────────────────────────────────────────────────
// Constants, Zod schemas, and result types live in vendor-docs.shared.ts
// (Next.js 15 strict 'use server' — only async functions may be exported here).
// ────────────────────────────────────────────────────────────────────────────
const vendor_docs_shared_1 = require("./vendor-docs.shared");
const contentTypeToExtension = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
};
const extensionToContentType = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
};
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function sanitizeFileName(raw) {
    const base = raw.replace(/^.*[\\/]/, '');
    return (base
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'documento');
}
function extractExtension(fileName) {
    const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m?.[1] ?? '';
}
async function resolveTenantSlug(tenantId) {
    const rows = await db_1.db
        .select({ slug: tenants_1.tenants.slug })
        .from(tenants_1.tenants)
        .where((0, drizzle_orm_1.eq)(tenants_1.tenants.id, tenantId))
        .limit(1);
    const slug = rows[0]?.slug;
    if (!slug)
        throw new Error(`Tenant slug not found for tenant_id=${tenantId}`);
    return slug;
}
async function assertVendorInTenant(db, vendorId) {
    const rows = await db
        .select({ id: vendors_1.vendors.id })
        .from(vendors_1.vendors)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendors.id, vendorId), (0, drizzle_orm_1.isNull)(vendors_1.vendors.deletedAt)))
        .limit(1);
    if (!rows[0])
        throw new Error('Fornecedor não encontrado ou inacessível');
}
function toPersistedDoc(row) {
    return {
        id: row.id,
        tenantId: row.tenantId,
        vendorId: row.vendorId,
        minioKey: row.minioKey,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        docType: row.docType,
        uploadedAt: row.uploadedAt,
    };
}
async function tryDelete(bucket, key) {
    const minio = (0, minio_1.getMinIOClient)();
    if (typeof minio.removeObject === 'function') {
        try {
            await minio.removeObject(bucket, key);
        }
        catch {
            // ignore — orphan reaped by MinIO lifecycle policies
        }
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers
// ────────────────────────────────────────────────────────────────────────────
/**
 * Mint a pre-signed PUT URL for a vendor doc upload. Verifies the vendor
 * exists under the current tenant (RLS) before generating the URL.
 *
 * Key shape (matches the planta pattern):
 *   `vendor-docs/{vendorId}/{cryptoRandom16}-{sanitize(fileName)}.{ext}`
 *
 * Extension is forced to match the declared content-type so confirm can
 * re-derive the expected content-type from the key.
 */
async function mintVendorDocUploadUrlInTenant(db, tenantId, input) {
    await assertVendorInTenant(db, input.vendorId);
    const tenantSlug = await resolveTenantSlug(tenantId);
    const random = (0, node_crypto_1.randomBytes)(8).toString('hex'); // 16 hex chars
    const sanitized = sanitizeFileName(input.fileName);
    const wantedExt = contentTypeToExtension[input.contentType];
    const baseWithoutExt = sanitized.replace(/\.[a-z0-9]+$/i, '');
    const key = `vendor-docs/${input.vendorId}/${random}-${baseWithoutExt}.${wantedExt}`;
    const presigned = await (0, minio_1.mintPresignedPut)(tenantSlug, key, {
        contentType: input.contentType,
        sizeMaxBytes: vendor_docs_shared_1.VENDOR_DOC_MAX_BYTES,
        ttlSeconds: vendor_docs_shared_1.VENDOR_DOC_PUT_TTL_SECONDS,
    });
    return {
        url: presigned.url,
        key: presigned.key,
        bucket: presigned.bucket,
        expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
        contentType: input.contentType,
        sizeMaxBytes: vendor_docs_shared_1.VENDOR_DOC_MAX_BYTES,
    };
}
/**
 * Confirm a vendor doc upload completed. Verifies the key sits under the
 * per-vendor prefix, the content-type matches the declared extension, and
 * the size is within bounds. On mismatch, the orphan object is removed.
 */
async function confirmVendorDocUploadInTenant(db, tenantId, input, userId) {
    const expectedPrefix = `vendor-docs/${input.vendorId}/`;
    if (!input.key.startsWith(expectedPrefix)) {
        throw new Error('Chave de upload inválida para este fornecedor');
    }
    await assertVendorInTenant(db, input.vendorId);
    const ext = extractExtension(input.key);
    const expectedContentType = extensionToContentType[ext];
    if (!expectedContentType) {
        throw new Error(`Extensão de arquivo não permitida: .${ext}`);
    }
    const tenantSlug = await resolveTenantSlug(tenantId);
    const bucket = (0, minio_1.getTenantBucket)(tenantSlug);
    const minio = (0, minio_1.getMinIOClient)();
    let stat;
    try {
        stat = await minio.statObject(bucket, input.key);
    }
    catch (err) {
        throw new Error(`Falha ao verificar upload: ${err instanceof Error ? err.message : String(err)}`);
    }
    const metaContentType = stat.metaData?.['content-type'] ??
        stat.metaData?.['Content-Type'] ??
        null;
    if (metaContentType && metaContentType !== expectedContentType) {
        await tryDelete(bucket, input.key);
        throw new Error(`Tipo de conteúdo inválido: esperado ${expectedContentType}, recebido ${metaContentType}`);
    }
    if (stat.size > vendor_docs_shared_1.VENDOR_DOC_MAX_BYTES) {
        await tryDelete(bucket, input.key);
        throw new Error(`Arquivo excede o limite de ${vendor_docs_shared_1.VENDOR_DOC_MAX_BYTES} bytes (25 MB)`);
    }
    const rows = await db
        .insert(vendors_1.vendorDocuments)
        .values({
        tenantId,
        vendorId: input.vendorId,
        minioKey: input.key,
        contentType: expectedContentType,
        sizeBytes: stat.size,
        docType: input.docType,
    })
        .returning();
    const row = rows[0];
    if (!row) {
        await tryDelete(bucket, input.key);
        throw new Error('Não foi possível registrar o documento (verificação RLS falhou)');
    }
    await (0, audit_1.recordAudit)(db, {
        action: 'vendor.doc_uploaded',
        entity: 'vendor_document',
        entityId: row.id,
        userId,
        payload: {
            vendor_id: input.vendorId,
            doc_type: input.docType,
            size_bytes: stat.size,
            content_type: expectedContentType,
        },
    });
    return {
        ok: true,
        docId: row.id,
        key: input.key,
        size: stat.size,
        contentType: expectedContentType,
    };
}
/**
 * Mint a pre-signed GET URL for the doc. EVERY download generates an
 * audit_log row carrying actor + doc + (optional) ip. This is the LGPD
 * access trail — the trail is the contract, not the URL itself.
 */
async function mintVendorDocDownloadUrlInTenant(db, tenantId, input, userId, ipAddress) {
    const rows = await db
        .select()
        .from(vendors_1.vendorDocuments)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendorDocuments.id, input.docId), (0, drizzle_orm_1.isNull)(vendors_1.vendorDocuments.deletedAt)))
        .limit(1);
    const doc = rows[0];
    if (!doc)
        throw new Error('Documento não encontrado ou inacessível');
    const tenantSlug = await resolveTenantSlug(tenantId);
    const presigned = await (0, minio_1.mintPresignedGet)(tenantSlug, doc.minioKey, vendor_docs_shared_1.VENDOR_DOC_GET_TTL_SECONDS);
    await (0, audit_1.recordAudit)(db, {
        action: 'vendor.doc_downloaded',
        entity: 'vendor_document',
        entityId: doc.id,
        userId,
        ipAddress,
        payload: {
            vendor_id: doc.vendorId,
            doc_type: doc.docType,
            minio_key: doc.minioKey,
        },
    });
    return {
        url: presigned.url,
        expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
    };
}
/**
 * Soft-delete the vendor doc row. The MinIO object is left in place
 * (Lifecycle policy + manual purge handle physical cleanup); the audit
 * row provides traceability for re-instate / forensic recovery.
 */
async function deleteVendorDocInTenant(db, input, userId) {
    const rows = await db
        .update(vendors_1.vendorDocuments)
        .set({ deletedAt: new Date() })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendorDocuments.id, input.docId), (0, drizzle_orm_1.isNull)(vendors_1.vendorDocuments.deletedAt)))
        .returning({
        id: vendors_1.vendorDocuments.id,
        vendorId: vendors_1.vendorDocuments.vendorId,
        docType: vendors_1.vendorDocuments.docType,
    });
    const row = rows[0];
    if (!row)
        return false;
    await (0, audit_1.recordAudit)(db, {
        action: 'vendor.doc_deleted',
        entity: 'vendor_document',
        entityId: row.id,
        userId,
        payload: { vendor_id: row.vendorId, doc_type: row.docType },
    });
    return true;
}
/**
 * List non-deleted documents for a vendor. RLS-scoped.
 */
async function listVendorDocsInTenant(db, input) {
    const rows = await db
        .select()
        .from(vendors_1.vendorDocuments)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(vendors_1.vendorDocuments.vendorId, input.vendorId), (0, drizzle_orm_1.isNull)(vendors_1.vendorDocuments.deletedAt)))
        .orderBy((0, drizzle_orm_1.desc)(vendors_1.vendorDocuments.uploadedAt));
    return rows.map(toPersistedDoc);
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8) — thin wrappers
// ────────────────────────────────────────────────────────────────────────────
exports.mintVendorDocUploadUrl = safe_action_1.withTenantAction
    .inputSchema(vendor_docs_shared_1.mintVendorDocUploadInput)
    .action(async ({ ctx, parsedInput }) => {
    return mintVendorDocUploadUrlInTenant(ctx.db, ctx.tenantId, parsedInput);
});
exports.confirmVendorDocUpload = safe_action_1.withTenantAction
    .inputSchema(vendor_docs_shared_1.confirmVendorDocUploadInput)
    .action(async ({ ctx, parsedInput }) => {
    const result = await confirmVendorDocUploadInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)(`/[slug]/fornecedores/${parsedInput.vendorId}`, 'page');
    return result;
});
exports.mintVendorDocDownloadUrl = safe_action_1.withTenantAction
    .inputSchema(vendor_docs_shared_1.vendorDocIdInput)
    .action(async ({ ctx, parsedInput }) => {
    return mintVendorDocDownloadUrlInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
});
exports.deleteVendorDoc = safe_action_1.withTenantAction
    .inputSchema(vendor_docs_shared_1.vendorDocIdInput)
    .action(async ({ ctx, parsedInput }) => {
    const ok = await deleteVendorDocInTenant(ctx.db, parsedInput, ctx.userId);
    if (!ok)
        throw new Error('Documento não encontrado');
    return { ok };
});
exports.listVendorDocs = safe_action_1.withTenantAction
    .inputSchema(vendor_docs_shared_1.vendorDocScopeInput)
    .action(async ({ ctx, parsedInput }) => {
    return listVendorDocsInTenant(ctx.db, parsedInput);
});
