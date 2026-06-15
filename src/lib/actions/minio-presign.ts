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

'use server'

import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db as singletonDb } from '@/db'
import { events } from '@/db/schema/events'
import { tenants } from '@/db/schema/tenants'
import type { TenantDb } from '@/db/with-tenant'
import { getEventByIdInTenant } from '@/lib/actions/eventos'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import {
  getMinIOClient,
  getTenantBucket,
  mintPresignedGet,
  mintPresignedPut,
} from '@/lib/storage/minio'

// ────────────────────────────────────────────────────────────────────────────
// Constants, Zod schemas, and result types live in minio-presign.shared.ts
// (Next.js 15 strict 'use server' — only async functions may be exported here).
// ────────────────────────────────────────────────────────────────────────────

import {
  type ConfirmPlantaUploadInput,
  type ConfirmPlantaUploadResult,
  confirmPlantaUploadInput,
  eventOnlyInput,
  type MintPlantaDownloadResult,
  type MintPlantaUploadInput,
  type MintPlantaUploadResult,
  mintPlantaUploadInput,
  PLANTA_ALLOWED_CONTENT_TYPES,
  PLANTA_GET_TTL_SECONDS,
  PLANTA_MAX_BYTES,
  PLANTA_PUT_TTL_SECONDS,
  type PlantaContentType,
} from './minio-presign.shared'

const contentTypeToExtension: Record<PlantaContentType, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

const extensionToContentType: Record<string, PlantaContentType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

// ────────────────────────────────────────────────────────────────────────────
// Helper — sanitize a user-provided filename for safe inclusion in a key
// ────────────────────────────────────────────────────────────────────────────

function sanitizeFileName(raw: string): string {
  // Strip directory components, control chars, and unsafe symbols.
  const base = raw.replace(/^.*[\\/]/, '')
  return (
    base
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'planta'
  )
}

function extractExtension(fileName: string): string {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m?.[1] ?? ''
}

/** Tenant-slug resolution (global table — safe outside withTenant). */
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
export async function mintEventPlantaUploadUrlInTenant(
  db: TenantDb,
  tenantId: string,
  input: MintPlantaUploadInput,
): Promise<MintPlantaUploadResult> {
  // Verify the event belongs to the current tenant (RLS does the heavy lift —
  // a cross-tenant id returns null, not the row).
  const event = await getEventByIdInTenant(db, input.eventId)
  if (!event) {
    throw new Error('Evento não encontrado ou inacessível')
  }

  const tenantSlug = await resolveTenantSlug(tenantId)
  const random = randomBytes(8).toString('hex') // 16 hex chars
  const sanitized = sanitizeFileName(input.fileName)
  // Force the file extension to match the declared content-type so the
  // confirm step can re-derive the expected content-type from the key.
  const wantedExt = contentTypeToExtension[input.contentType]
  const baseWithoutExt = sanitized.replace(/\.[a-z0-9]+$/i, '')
  const key = `plantas/${input.eventId}/${random}-${baseWithoutExt}.${wantedExt}`

  const presigned = await mintPresignedPut(tenantSlug, key, {
    contentType: input.contentType,
    sizeMaxBytes: PLANTA_MAX_BYTES,
    ttlSeconds: PLANTA_PUT_TTL_SECONDS,
  })

  return {
    url: presigned.url,
    key: presigned.key,
    bucket: presigned.bucket,
    expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString(),
    contentType: input.contentType,
    sizeMaxBytes: PLANTA_MAX_BYTES,
  }
}

/**
 * Mint a pre-signed GET URL for the planta tied to `eventId`. Returns null
 * if the event has no planta uploaded.
 */
export async function mintEventPlantaDownloadUrlInTenant(
  db: TenantDb,
  tenantId: string,
  eventId: string,
): Promise<MintPlantaDownloadResult | null> {
  const event = await getEventByIdInTenant(db, eventId)
  if (!event || !event.plantaMinioKey) return null
  const tenantSlug = await resolveTenantSlug(tenantId)
  const r = await mintPresignedGet(tenantSlug, event.plantaMinioKey, PLANTA_GET_TTL_SECONDS)
  return {
    url: r.url,
    expiresAt: new Date(Date.now() + r.expiresInSeconds * 1000).toISOString(),
  }
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
export async function confirmEventPlantaUploadInTenant(
  db: TenantDb,
  tenantId: string,
  input: ConfirmPlantaUploadInput,
  userId: string,
): Promise<ConfirmPlantaUploadResult> {
  // Sanity: key must start with the per-event prefix.
  const expectedPrefix = `plantas/${input.eventId}/`
  if (!input.key.startsWith(expectedPrefix)) {
    throw new Error('Chave de upload inválida para este evento')
  }

  // Tenant cross-check via RLS.
  const event = await getEventByIdInTenant(db, input.eventId)
  if (!event) {
    throw new Error('Evento não encontrado ou inacessível')
  }

  // Re-derive the expected content-type from the key extension.
  const ext = extractExtension(input.key)
  const expectedContentType = extensionToContentType[ext]
  if (!expectedContentType) {
    throw new Error(`Extensão de arquivo não permitida: .${ext}`)
  }

  const tenantSlug = await resolveTenantSlug(tenantId)
  const bucket = getTenantBucket(tenantSlug)
  const minio = getMinIOClient()

  // 2. statObject — surfaces NoSuchKey if browser didn't actually upload.
  let stat: Awaited<ReturnType<typeof minio.statObject>>
  try {
    stat = await minio.statObject(bucket, input.key)
  } catch (err) {
    throw new Error(
      `Falha ao verificar upload: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Normalize metadata key access — different MinIO versions return either
  // 'Content-Type' or 'content-type' in metaData; statObject also returns
  // a top-level shape for the size.
  const metaContentType =
    (stat.metaData?.['content-type'] as string | undefined) ??
    (stat.metaData?.['Content-Type'] as string | undefined) ??
    null

  // Content-type mismatch → orphan delete + reject.
  if (metaContentType && metaContentType !== expectedContentType) {
    await tryDelete(bucket, input.key)
    throw new Error(
      `Tipo de conteúdo inválido: esperado ${expectedContentType}, recebido ${metaContentType}`,
    )
  }

  // Size mismatch → orphan delete + reject.
  if (stat.size > PLANTA_MAX_BYTES) {
    await tryDelete(bucket, input.key)
    throw new Error(`Arquivo excede o limite de ${PLANTA_MAX_BYTES} bytes (25 MB)`)
  }

  // 3. UPDATE the event row (RLS enforces tenant_id match).
  const rows = await db
    .update(events)
    .set({
      plantaMinioKey: input.key,
      plantaContentType: expectedContentType,
      updatedAt: new Date(),
    })
    .where(eq(events.id, input.eventId))
    .returning({ id: events.id })

  if (rows.length === 0) {
    // RLS hid the row from us — should not happen because we already checked
    // via getEventByIdInTenant, but defense in depth.
    await tryDelete(bucket, input.key)
    throw new Error('Não foi possível atualizar o evento (verificação RLS falhou)')
  }

  // 4. Audit trail.
  await recordAudit(db, {
    action: 'event.planta_uploaded',
    entity: 'event',
    entityId: input.eventId,
    userId,
    payload: {
      key: input.key,
      size: stat.size,
      content_type: expectedContentType,
    },
  })

  return {
    ok: true,
    eventId: input.eventId,
    key: input.key,
    size: stat.size,
    contentType: expectedContentType,
  }
}

/** Best-effort orphan deletion. Production MinIO returns 204; ignore errors. */
async function tryDelete(bucket: string, key: string): Promise<void> {
  const minio = getMinIOClient() as unknown as {
    removeObject?: (bucket: string, key: string) => Promise<void>
  }
  if (typeof minio.removeObject === 'function') {
    try {
      await minio.removeObject(bucket, key)
    } catch {
      // ignore — the orphan can be reaped by Lifecycle policies
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8)
// ────────────────────────────────────────────────────────────────────────────

export const mintEventPlantaUploadUrl = withTenantAction
  .inputSchema(mintPlantaUploadInput)
  .action(async ({ ctx, parsedInput }) => {
    return mintEventPlantaUploadUrlInTenant(ctx.db, ctx.tenantId, parsedInput)
  })

export const mintEventPlantaDownloadUrl = withTenantAction
  .inputSchema(eventOnlyInput)
  .action(async ({ ctx, parsedInput }) => {
    return mintEventPlantaDownloadUrlInTenant(ctx.db, ctx.tenantId, parsedInput.eventId)
  })

export const confirmEventPlantaUpload = withTenantAction
  .inputSchema(confirmPlantaUploadInput)
  .action(async ({ ctx, parsedInput }) => {
    const result = await confirmEventPlantaUploadInTenant(
      ctx.db,
      ctx.tenantId,
      parsedInput,
      ctx.userId,
    )
    revalidatePath('/[slug]/eventos', 'page')
    revalidatePath(`/[slug]/eventos/${parsedInput.eventId}`, 'page')
    return result
  })
