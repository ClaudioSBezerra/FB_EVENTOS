"use strict";
// FB_EVENTOS — Planta upload Server Actions (Phase 1, Plan 01-02 — Task 2).
//
// Three Server Actions wrapped in `withTenantAction`:
//
//   - mintEventPlantaUploadUrl(eventId, fileName, contentType, sizeBytes)
//     → Verify the event belongs to current tenant (RLS), generate a unique
//       key under `plantas/{eventId}/{cryptoRandom-16}-{sanitize(fileName)}`,
//       mint a pre-signed PUT URL (TTL 300s, content-type lock, 25 MB cap).
//
//   - mintEventPlantaDownloadUrl(eventId)
//     → Returns pre-signed GET TTL 900s for the stored planta. Tenant scope
//       enforced by RLS (getEventById returns null cross-tenant).
//
//   - confirmEventPlantaUpload(eventId, key)
//     → After the browser PUTs to MinIO, the server calls statObject() to
//       verify content-type matches the original PUT lock + size ≤ 25 MB.
//       If mismatch: delete the orphan + throw. Otherwise: UPDATE
//       events SET planta_minio_key=?, planta_content_type=? + audit row.
//
// IMPORTANT — content-type lock semantics:
//   The pre-signed PUT URL alone does NOT enforce content-type. MinIO will
//   accept whatever Content-Type the browser sends. We bind the EXPECTED
//   content-type when minting the URL by storing it in a transient lookup
//   keyed by (tenantId, key) — Phase 1 keeps this simple by re-deriving
//   the expectation from the BLOCKED file-extension policy (.pdf/.png/.jpg)
//   inside confirmEventPlantaUpload: a content-type that doesn't match the
//   key's extension is a mismatch.
//
//   Phase 2 will harden this by storing the lock in a `planta_upload_intents`
//   table with TTL, but for the pilot the simpler check is adequate (the
//   server is the only one deciding the key based on extension).
'use server';
// FB_EVENTOS — Planta upload Server Actions (Phase 1, Plan 01-02 — Task 2).
//
// Three Server Actions wrapped in `withTenantAction`:
//
//   - mintEventPlantaUploadUrl(eventId, fileName, contentType, sizeBytes)
//     → Verify the event belongs to current tenant (RLS), generate a unique
//       key under `plantas/{eventId}/{cryptoRandom-16}-{sanitize(fileName)}`,
//       mint a pre-signed PUT URL (TTL 300s, content-type lock, 25 MB cap).
//
//   - mintEventPlantaDownloadUrl(eventId)
//     → Returns pre-signed GET TTL 900s for the stored planta. Tenant scope
//       enforced by RLS (getEventById returns null cross-tenant).
//
//   - confirmEventPlantaUpload(eventId, key)
//     → After the browser PUTs to MinIO, the server calls statObject() to
//       verify content-type matches the original PUT lock + size ≤ 25 MB.
//       If mismatch: delete the orphan + throw. Otherwise: UPDATE
//       events SET planta_minio_key=?, planta_content_type=? + audit row.
//
// IMPORTANT — content-type lock semantics:
//   The pre-signed PUT URL alone does NOT enforce content-type. MinIO will
//   accept whatever Content-Type the browser sends. We bind the EXPECTED
//   content-type when minting the URL by storing it in a transient lookup
//   keyed by (tenantId, key) — Phase 1 keeps this simple by re-deriving
//   the expectation from the BLOCKED file-extension policy (.pdf/.png/.jpg)
//   inside confirmEventPlantaUpload: a content-type that doesn't match the
//   key's extension is a mismatch.
//
//   Phase 2 will harden this by storing the lock in a `planta_upload_intents`
//   table with TTL, but for the pilot the simpler check is adequate (the
//   server is the only one deciding the key based on extension).
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmEventPlantaUpload = exports.mintEventPlantaDownloadUrl = exports.mintEventPlantaUploadUrl = void 0;
exports.mintEventPlantaUploadUrlInTenant = mintEventPlantaUploadUrlInTenant;
exports.mintEventPlantaDownloadUrlInTenant = mintEventPlantaDownloadUrlInTenant;
exports.confirmEventPlantaUploadInTenant = confirmEventPlantaUploadInTenant;
const node_crypto_1 = require("node:crypto");
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const db_1 = require("@/db");
const events_1 = require("@/db/schema/events");
const tenants_1 = require("@/db/schema/tenants");
const eventos_1 = require("@/lib/actions/eventos");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const minio_1 = require("@/lib/storage/minio");
// ────────────────────────────────────────────────────────────────────────────
// Constants, Zod schemas, and result types live in minio-presign.shared.ts
// (Next.js 15 strict 'use server' — only async functions may be exported here).
// ────────────────────────────────────────────────────────────────────────────
const minio_presign_shared_1 = require("./minio-presign.shared");
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
// Helper — sanitize a user-provided filename for safe inclusion in a key
// ────────────────────────────────────────────────────────────────────────────
function sanitizeFileName(raw) {
    // Strip directory components, control chars, and unsafe symbols.
    const base = raw.replace(/^.*[\\/]/, '');
    return (base
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || 'planta');
}
function extractExtension(fileName) {
    const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m?.[1] ?? '';
}
/** Tenant-slug resolution (global table — safe outside withTenant). */
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
// ────────────────────────────────────────────────────────────────────────────
// Pure helpers — tests call these inside withTenant
// ────────────────────────────────────────────────────────────────────────────
/**
 * Mint a pre-signed PUT URL for a planta upload tied to `eventId`. Verifies
 * the event exists under the current tenant (RLS) before generating the URL.
 *
 * Throws if:
 *   - the event doesn't exist OR belongs to another tenant (cross-tenant)
 *   - the event is soft-deleted
 */
async function mintEventPlantaUploadUrlInTenant(db, tenantId, input) {
    // Verify the event belongs to the current tenant (RLS does the heavy lift —
    // a cross-tenant id returns null, not the row).
    const event = await (0, eventos_1.getEventByIdInTenant)(db, input.eventId);
    if (!event) {
        throw new Error('Evento não encontrado ou inacessível');
    }
    const tenantSlug = await resolveTenantSlug(tenantId);
    const random = (0, node_crypto_1.randomBytes)(8).toString('hex'); // 16 hex chars
    const sanitized = sanitizeFileName(input.fileName);
    // Force the file extension to match the declared content-type so the
    // confirm step can re-derive the expected content-type from the key.
    const wantedExt = contentTypeToExtension[input.contentType];
    const baseWithoutExt = sanitized.replace(/\.[a-z0-9]+$/i, '');
    const key = `plantas/${input.eventId}/${random}-${baseWithoutExt}.${wantedExt}`;
    const presigned = await (0, minio_1.mintPresignedPut)(tenantSlug, key, {
        contentType: input.contentType,
        sizeMaxBytes: minio_presign_shared_1.PLANTA_MAX_BYTES,
        ttlSeconds: minio_presign_shared_1.PLANTA_PUT_TTL_SECONDS,
    });
    return {
        url: presigned.url,
        key: presigned.key,
        bucket: presigned.bucket,
        expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
        contentType: input.contentType,
        sizeMaxBytes: minio_presign_shared_1.PLANTA_MAX_BYTES,
    };
}
/**
 * Mint a pre-signed GET URL for the planta tied to `eventId`. Returns null
 * if the event has no planta uploaded.
 */
async function mintEventPlantaDownloadUrlInTenant(db, tenantId, eventId) {
    const event = await (0, eventos_1.getEventByIdInTenant)(db, eventId);
    if (!event || !event.plantaMinioKey)
        return null;
    const tenantSlug = await resolveTenantSlug(tenantId);
    const r = await (0, minio_1.mintPresignedGet)(tenantSlug, event.plantaMinioKey, minio_presign_shared_1.PLANTA_GET_TTL_SECONDS);
    return {
        url: r.url,
        expiresAt: new Date(Date.now() + r.expiresInSeconds * 1000).toISOString(),
    };
}
/**
 * Confirm a planta upload completed successfully and stamp the events row.
 *
 * Verification protocol:
 *   1. The key must live under `plantas/{eventId}/...` AND the eventId must
 *      belong to the current tenant (RLS check via getEventByIdInTenant).
 *   2. statObject() the key on the tenant's bucket:
 *      - If statObject throws / key doesn't exist → throw.
 *      - If actual content-type != expected (derived from key extension) →
 *        DELETE the orphan object + throw.
 *      - If actual size > PLANTA_MAX_BYTES → DELETE the orphan + throw.
 *   3. UPDATE events SET planta_minio_key = ?, planta_content_type = ?
 *      WHERE id = ? (RLS enforces tenant_id match).
 *   4. recordAudit('event.planta_uploaded', { event_id, key, size, content_type }).
 */
async function confirmEventPlantaUploadInTenant(db, tenantId, input, userId) {
    // Sanity: key must start with the per-event prefix.
    const expectedPrefix = `plantas/${input.eventId}/`;
    if (!input.key.startsWith(expectedPrefix)) {
        throw new Error('Chave de upload inválida para este evento');
    }
    // Tenant cross-check via RLS.
    const event = await (0, eventos_1.getEventByIdInTenant)(db, input.eventId);
    if (!event) {
        throw new Error('Evento não encontrado ou inacessível');
    }
    // Re-derive the expected content-type from the key extension.
    const ext = extractExtension(input.key);
    const expectedContentType = extensionToContentType[ext];
    if (!expectedContentType) {
        throw new Error(`Extensão de arquivo não permitida: .${ext}`);
    }
    const tenantSlug = await resolveTenantSlug(tenantId);
    const bucket = (0, minio_1.getTenantBucket)(tenantSlug);
    const minio = (0, minio_1.getMinIOClient)();
    // 2. statObject — surfaces NoSuchKey if browser didn't actually upload.
    let stat;
    try {
        stat = await minio.statObject(bucket, input.key);
    }
    catch (err) {
        throw new Error(`Falha ao verificar upload: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Normalize metadata key access — different MinIO versions return either
    // 'Content-Type' or 'content-type' in metaData; statObject also returns
    // a top-level shape for the size.
    const metaContentType = stat.metaData?.['content-type'] ??
        stat.metaData?.['Content-Type'] ??
        null;
    // Content-type mismatch → orphan delete + reject.
    if (metaContentType && metaContentType !== expectedContentType) {
        await tryDelete(bucket, input.key);
        throw new Error(`Tipo de conteúdo inválido: esperado ${expectedContentType}, recebido ${metaContentType}`);
    }
    // Size mismatch → orphan delete + reject.
    if (stat.size > minio_presign_shared_1.PLANTA_MAX_BYTES) {
        await tryDelete(bucket, input.key);
        throw new Error(`Arquivo excede o limite de ${minio_presign_shared_1.PLANTA_MAX_BYTES} bytes (25 MB)`);
    }
    // 3. UPDATE the event row (RLS enforces tenant_id match).
    const rows = await db
        .update(events_1.events)
        .set({
        plantaMinioKey: input.key,
        plantaContentType: expectedContentType,
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(events_1.events.id, input.eventId))
        .returning({ id: events_1.events.id });
    if (rows.length === 0) {
        // RLS hid the row from us — should not happen because we already checked
        // via getEventByIdInTenant, but defense in depth.
        await tryDelete(bucket, input.key);
        throw new Error('Não foi possível atualizar o evento (verificação RLS falhou)');
    }
    // 4. Audit trail.
    await (0, audit_1.recordAudit)(db, {
        action: 'event.planta_uploaded',
        entity: 'event',
        entityId: input.eventId,
        userId,
        payload: {
            key: input.key,
            size: stat.size,
            content_type: expectedContentType,
        },
    });
    return {
        ok: true,
        eventId: input.eventId,
        key: input.key,
        size: stat.size,
        contentType: expectedContentType,
    };
}
/** Best-effort orphan deletion. Production MinIO returns 204; ignore errors. */
async function tryDelete(bucket, key) {
    const minio = (0, minio_1.getMinIOClient)();
    if (typeof minio.removeObject === 'function') {
        try {
            await minio.removeObject(bucket, key);
        }
        catch {
            // ignore — the orphan can be reaped by Lifecycle policies
        }
    }
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8)
// ────────────────────────────────────────────────────────────────────────────
exports.mintEventPlantaUploadUrl = safe_action_1.withTenantAction
    .inputSchema(minio_presign_shared_1.mintPlantaUploadInput)
    .action(async ({ ctx, parsedInput }) => {
    return mintEventPlantaUploadUrlInTenant(ctx.db, ctx.tenantId, parsedInput);
});
exports.mintEventPlantaDownloadUrl = safe_action_1.withTenantAction
    .inputSchema(minio_presign_shared_1.eventOnlyInput)
    .action(async ({ ctx, parsedInput }) => {
    return mintEventPlantaDownloadUrlInTenant(ctx.db, ctx.tenantId, parsedInput.eventId);
});
exports.confirmEventPlantaUpload = safe_action_1.withTenantAction
    .inputSchema(minio_presign_shared_1.confirmPlantaUploadInput)
    .action(async ({ ctx, parsedInput }) => {
    const result = await confirmEventPlantaUploadInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/eventos', 'page');
    (0, cache_1.revalidatePath)(`/[slug]/eventos/${parsedInput.eventId}`, 'page');
    return result;
});
