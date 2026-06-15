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

'use server'

import { randomBytes } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db as singletonDb } from '@/db'
import { tenants } from '@/db/schema/tenants'
import { vendorDocuments, vendors } from '@/db/schema/vendors'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import {
  getMinIOClient,
  getTenantBucket,
  mintPresignedGet,
  mintPresignedPut,
} from '@/lib/storage/minio'

// ────────────────────────────────────────────────────────────────────────────
// Constants, Zod schemas, and result types live in vendor-docs.shared.ts
// (Next.js 15 strict 'use server' — only async functions may be exported here).
// ────────────────────────────────────────────────────────────────────────────

import {
  type ConfirmVendorDocUploadInput,
  type ConfirmVendorDocUploadResult,
  confirmVendorDocUploadInput,
  type MintVendorDocDownloadResult,
  type MintVendorDocUploadInput,
  type MintVendorDocUploadResult,
  mintVendorDocUploadInput,
  type PersistedVendorDoc,
  VENDOR_DOC_ALLOWED_CONTENT_TYPES,
  VENDOR_DOC_GET_TTL_SECONDS,
  VENDOR_DOC_MAX_BYTES,
  VENDOR_DOC_PUT_TTL_SECONDS,
  type VendorDocContentType,
  type VendorDocIdInput,
  type VendorDocScopeInput,
  vendorDocIdInput,
  vendorDocScopeInput,
} from './vendor-docs.shared'

const contentTypeToExtension: Record<VendorDocContentType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

const extensionToContentType: Record<string, VendorDocContentType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function sanitizeFileName(raw: string): string {
  const base = raw.replace(/^.*[\\/]/, '')
  return (
    base
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'documento'
  )
}

function extractExtension(fileName: string): string {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m?.[1] ?? ''
}

async function resolveTenantSlug(tenantId: string): Promise<string> {
  const rows = await singletonDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  const slug = rows[0]?.slug
  if (!slug) throw new Error(`Tenant slug not found for tenant_id=${tenantId}`)
  return slug
}

async function assertVendorInTenant(db: TenantDb, vendorId: string): Promise<void> {
  const rows = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), isNull(vendors.deletedAt)))
    .limit(1)
  if (!rows[0]) throw new Error('Fornecedor não encontrado ou inacessível')
}

function toPersistedDoc(row: typeof vendorDocuments.$inferSelect): PersistedVendorDoc {
  return {
    id: row.id,
    tenantId: row.tenantId,
    vendorId: row.vendorId,
    minioKey: row.minioKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    docType: row.docType,
    uploadedAt: row.uploadedAt,
  }
}

async function tryDelete(bucket: string, key: string): Promise<void> {
  const minio = getMinIOClient() as unknown as {
    removeObject?: (bucket: string, key: string) => Promise<void>
  }
  if (typeof minio.removeObject === 'function') {
    try {
      await minio.removeObject(bucket, key)
    } catch {
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
export async function mintVendorDocUploadUrlInTenant(
  db: TenantDb,
  tenantId: string,
  input: MintVendorDocUploadInput,
): Promise<MintVendorDocUploadResult> {
  await assertVendorInTenant(db, input.vendorId)

  const tenantSlug = await resolveTenantSlug(tenantId)
  const random = randomBytes(8).toString('hex') // 16 hex chars
  const sanitized = sanitizeFileName(input.fileName)
  const wantedExt = contentTypeToExtension[input.contentType]
  const baseWithoutExt = sanitized.replace(/\.[a-z0-9]+$/i, '')
  const key = `vendor-docs/${input.vendorId}/${random}-${baseWithoutExt}.${wantedExt}`

  const presigned = await mintPresignedPut(tenantSlug, key, {
    contentType: input.contentType,
    sizeMaxBytes: VENDOR_DOC_MAX_BYTES,
    ttlSeconds: VENDOR_DOC_PUT_TTL_SECONDS,
  })

  return {
    url: presigned.url,
    key: presigned.key,
    bucket: presigned.bucket,
    expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
    contentType: input.contentType,
    sizeMaxBytes: VENDOR_DOC_MAX_BYTES,
  }
}

/**
 * Confirm a vendor doc upload completed. Verifies the key sits under the
 * per-vendor prefix, the content-type matches the declared extension, and
 * the size is within bounds. On mismatch, the orphan object is removed.
 */
export async function confirmVendorDocUploadInTenant(
  db: TenantDb,
  tenantId: string,
  input: ConfirmVendorDocUploadInput,
  userId: string,
): Promise<ConfirmVendorDocUploadResult> {
  const expectedPrefix = `vendor-docs/${input.vendorId}/`
  if (!input.key.startsWith(expectedPrefix)) {
    throw new Error('Chave de upload inválida para este fornecedor')
  }

  await assertVendorInTenant(db, input.vendorId)

  const ext = extractExtension(input.key)
  const expectedContentType = extensionToContentType[ext]
  if (!expectedContentType) {
    throw new Error(`Extensão de arquivo não permitida: .${ext}`)
  }

  const tenantSlug = await resolveTenantSlug(tenantId)
  const bucket = getTenantBucket(tenantSlug)
  const minio = getMinIOClient()

  let stat: Awaited<ReturnType<typeof minio.statObject>>
  try {
    stat = await minio.statObject(bucket, input.key)
  } catch (err) {
    throw new Error(
      `Falha ao verificar upload: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const metaContentType =
    (stat.metaData?.['content-type'] as string | undefined) ??
    (stat.metaData?.['Content-Type'] as string | undefined) ??
    null

  if (metaContentType && metaContentType !== expectedContentType) {
    await tryDelete(bucket, input.key)
    throw new Error(
      `Tipo de conteúdo inválido: esperado ${expectedContentType}, recebido ${metaContentType}`,
    )
  }

  if (stat.size > VENDOR_DOC_MAX_BYTES) {
    await tryDelete(bucket, input.key)
    throw new Error(`Arquivo excede o limite de ${VENDOR_DOC_MAX_BYTES} bytes (25 MB)`)
  }

  const rows = await db
    .insert(vendorDocuments)
    .values({
      tenantId,
      vendorId: input.vendorId,
      minioKey: input.key,
      contentType: expectedContentType,
      sizeBytes: stat.size,
      docType: input.docType,
    })
    .returning()
  const row = rows[0]
  if (!row) {
    await tryDelete(bucket, input.key)
    throw new Error('Não foi possível registrar o documento (verificação RLS falhou)')
  }

  await recordAudit(db, {
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
  })

  return {
    ok: true,
    docId: row.id,
    key: input.key,
    size: stat.size,
    contentType: expectedContentType,
  }
}

/**
 * Mint a pre-signed GET URL for the doc. EVERY download generates an
 * audit_log row carrying actor + doc + (optional) ip. This is the LGPD
 * access trail — the trail is the contract, not the URL itself.
 */
export async function mintVendorDocDownloadUrlInTenant(
  db: TenantDb,
  tenantId: string,
  input: VendorDocIdInput,
  userId: string,
  ipAddress?: string,
): Promise<MintVendorDocDownloadResult> {
  const rows = await db
    .select()
    .from(vendorDocuments)
    .where(and(eq(vendorDocuments.id, input.docId), isNull(vendorDocuments.deletedAt)))
    .limit(1)
  const doc = rows[0]
  if (!doc) throw new Error('Documento não encontrado ou inacessível')

  const tenantSlug = await resolveTenantSlug(tenantId)
  const presigned = await mintPresignedGet(tenantSlug, doc.minioKey, VENDOR_DOC_GET_TTL_SECONDS)

  await recordAudit(db, {
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
  })

  return {
    url: presigned.url,
    expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
  }
}

/**
 * Soft-delete the vendor doc row. The MinIO object is left in place
 * (Lifecycle policy + manual purge handle physical cleanup); the audit
 * row provides traceability for re-instate / forensic recovery.
 */
export async function deleteVendorDocInTenant(
  db: TenantDb,
  input: VendorDocIdInput,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .update(vendorDocuments)
    .set({ deletedAt: new Date() })
    .where(and(eq(vendorDocuments.id, input.docId), isNull(vendorDocuments.deletedAt)))
    .returning({
      id: vendorDocuments.id,
      vendorId: vendorDocuments.vendorId,
      docType: vendorDocuments.docType,
    })
  const row = rows[0]
  if (!row) return false

  await recordAudit(db, {
    action: 'vendor.doc_deleted',
    entity: 'vendor_document',
    entityId: row.id,
    userId,
    payload: { vendor_id: row.vendorId, doc_type: row.docType },
  })
  return true
}

/**
 * List non-deleted documents for a vendor. RLS-scoped.
 */
export async function listVendorDocsInTenant(
  db: TenantDb,
  input: VendorDocScopeInput,
): Promise<PersistedVendorDoc[]> {
  const rows = await db
    .select()
    .from(vendorDocuments)
    .where(and(eq(vendorDocuments.vendorId, input.vendorId), isNull(vendorDocuments.deletedAt)))
    .orderBy(desc(vendorDocuments.uploadedAt))
  return rows.map(toPersistedDoc)
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8) — thin wrappers
// ────────────────────────────────────────────────────────────────────────────

export const mintVendorDocUploadUrl = withTenantAction
  .inputSchema(mintVendorDocUploadInput)
  .action(async ({ ctx, parsedInput }) => {
    return mintVendorDocUploadUrlInTenant(ctx.db, ctx.tenantId, parsedInput)
  })

export const confirmVendorDocUpload = withTenantAction
  .inputSchema(confirmVendorDocUploadInput)
  .action(async ({ ctx, parsedInput }) => {
    const result = await confirmVendorDocUploadInTenant(
      ctx.db,
      ctx.tenantId,
      parsedInput,
      ctx.userId,
    )
    revalidatePath(`/[slug]/fornecedores/${parsedInput.vendorId}`, 'page')
    return result
  })

export const mintVendorDocDownloadUrl = withTenantAction
  .inputSchema(vendorDocIdInput)
  .action(async ({ ctx, parsedInput }) => {
    return mintVendorDocDownloadUrlInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
  })

export const deleteVendorDoc = withTenantAction
  .inputSchema(vendorDocIdInput)
  .action(async ({ ctx, parsedInput }) => {
    const ok = await deleteVendorDocInTenant(ctx.db, parsedInput, ctx.userId)
    if (!ok) throw new Error('Documento não encontrado')
    return { ok }
  })

export const listVendorDocs = withTenantAction
  .inputSchema(vendorDocScopeInput)
  .action(async ({ ctx, parsedInput }) => {
    return listVendorDocsInTenant(ctx.db, parsedInput)
  })
