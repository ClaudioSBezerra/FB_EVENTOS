// FB_EVENTOS — Server-side MinIO client wrapper (Phase 1, Plan 01-01).
//
// Thin singleton around `minio-js` v8. Phase 1 Server Actions and
// Graphile-Worker tasks consume `getMinIOClient()` to mint pre-signed PUT
// URLs (browser → MinIO direct upload) and pre-signed GET URLs (vendor doc
// download / signed-contract delivery).
//
// Tenant ergonomics:
//   - `getTenantBucket('trindade')` returns the canonical bucket name
//     `trindade-uploads` matching `scripts/minio/setup-buckets.sh`.
//   - `mintPresignedPut(...)` enforces TTL ≤ 300s (5 min, per D-05) and
//     defaults to a 25 MB size cap (matches ORG-02 planta upload limit).
//   - `mintPresignedGet(...)` defaults to TTL = 900s (15 min, per D-06).
//
// Coolify endpoint split:
//   - The Coolify-internal endpoint (`MINIO_ENDPOINT` = container DNS)
//     is used for server-side reads/writes (`statObject`, `putObject`).
//   - The public endpoint (`MINIO_PUBLIC_ENDPOINT`) is embedded in signed
//     URLs delivered to browsers. A second `_publicClient` is constructed
//     against this endpoint and used ONLY for `presignedPutObject` /
//     `presignedGetObject` so the signature matches the URL the browser hits.
//
// Tests inject the in-memory mock:
//   - `setMinIOClientForTests(getMockMinIO())` replaces the singleton for
//     a test process. `resetMinIOClient()` restores production behavior.
//   - `src/test/minio-test.ts` exposes the `MockMinIOClient` interface.
//
// REFERENCES:
//   - 01-RESEARCH.md §A2 (singleton + bucketFor)
//   - 01-RESEARCH.md §A4 (pre-signed PUT/GET + post-upload statObject)
//   - docs.min.io JS API reference (presignedPutObject, statObject)

import { Client } from 'minio'
import { env } from '@/lib/env'

// ────────────────────────────────────────────────────────────────────────────
// Minimal surface used by Phase 1 Server Actions + jobs. Mirrors the
// `MockMinIOClient` interface in `src/test/minio-test.ts` so production and
// test code paths share a contract.
// ────────────────────────────────────────────────────────────────────────────

export interface MinIOClientLike {
  presignedPutObject(bucket: string, key: string, expirySeconds: number): Promise<string>
  presignedGetObject(bucket: string, key: string, expirySeconds: number): Promise<string>
  putObject(
    bucket: string,
    key: string,
    body: Buffer | string,
    size?: number,
    metaData?: Record<string, string>,
  ): Promise<{ etag: string; versionId: string | null }>
  statObject(
    bucket: string,
    key: string,
  ): Promise<{
    size: number
    metaData: Record<string, string>
    lastModified: Date
    etag: string
  }>
  makeBucket(bucket: string, region?: string): Promise<void>
  bucketExists(bucket: string): Promise<boolean>
}

// ────────────────────────────────────────────────────────────────────────────
// Internal client construction
// ────────────────────────────────────────────────────────────────────────────

function readClientConfig(useSsl: boolean) {
  const endpoint = env.MINIO_ENDPOINT
  const port = env.MINIO_PORT ? Number(env.MINIO_PORT) : useSsl ? 443 : 9000
  const accessKey = env.MINIO_ACCESS_KEY
  const secretKey = env.MINIO_SECRET_KEY
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error(
      'MinIO is not configured. Set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY. ' +
        'See .env.example or docker/coolify/minio.service.md.',
    )
  }
  return { endpoint, port, accessKey, secretKey }
}

function readPublicEndpoint(useSsl: boolean): { endpoint: string; port: number } {
  // Public endpoint (browser-facing) — used ONLY for pre-signed URL
  // construction. Falls back to the internal endpoint if not set (single-VM
  // dev where browser ↔ MinIO ↔ web all share localhost).
  const raw = env.MINIO_PUBLIC_ENDPOINT
  if (!raw) {
    return {
      endpoint: env.MINIO_ENDPOINT ?? 'localhost',
      port: env.MINIO_PORT ? Number(env.MINIO_PORT) : useSsl ? 443 : 9000,
    }
  }
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    return {
      endpoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    }
  } catch {
    return { endpoint: raw, port: useSsl ? 443 : 9000 }
  }
}

function buildClient(): MinIOClientLike {
  const useSsl = (env.MINIO_USE_SSL ?? 'false').toLowerCase() === 'true'
  const cfg = readClientConfig(useSsl)
  return new Client({
    endPoint: cfg.endpoint,
    port: cfg.port,
    useSSL: useSsl,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
  })
}

function buildPublicClient(): MinIOClientLike {
  const useSsl = (env.MINIO_USE_SSL ?? 'false').toLowerCase() === 'true'
  // If a public endpoint is configured, derive SSL from its URL scheme.
  const publicSsl = env.MINIO_PUBLIC_ENDPOINT
    ? env.MINIO_PUBLIC_ENDPOINT.startsWith('https')
    : useSsl
  const pub = readPublicEndpoint(publicSsl)
  const cfg = readClientConfig(useSsl)
  return new Client({
    endPoint: pub.endpoint,
    port: pub.port,
    useSSL: publicSsl,
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Singletons + test injection
// ────────────────────────────────────────────────────────────────────────────

let _client: MinIOClientLike | null = null
let _publicClient: MinIOClientLike | null = null

/** Get the singleton MinIO client (lazy; throws if MinIO env is incomplete). */
export function getMinIOClient(): MinIOClientLike {
  if (!_client) _client = buildClient()
  return _client
}

/**
 * Public-facing client used ONLY for pre-signed URL minting. The
 * signature must match the endpoint the browser hits, so when Coolify
 * splits internal vs public hostnames we need a separate client.
 */
function getPublicMinIOClient(): MinIOClientLike {
  if (!_publicClient) _publicClient = buildPublicClient()
  return _publicClient
}

/**
 * Test injection point — replace the singleton with a mock implementation.
 * Used by tests that import `getMockMinIO()` from `@/test/minio-test`.
 */
export function setMinIOClientForTests(client: MinIOClientLike): void {
  _client = client
  _publicClient = client
}

/** Reset both singletons (afterAll cleanup). */
export function resetMinIOClient(): void {
  _client = null
  _publicClient = null
}

// ────────────────────────────────────────────────────────────────────────────
// Bucket helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Canonical per-tenant bucket name. Matches the convention used by
 * `scripts/minio/setup-buckets.sh` and the Coolify post-deploy hook.
 *
 * @example
 *   getTenantBucket('trindade') // 'trindade-uploads'
 */
export function getTenantBucket(tenantSlug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/.test(tenantSlug)) {
    throw new Error(
      `Invalid tenant slug "${tenantSlug}": must be lowercase alphanumeric with dashes, 3-42 chars`,
    )
  }
  return `${tenantSlug}-uploads`
}

// ────────────────────────────────────────────────────────────────────────────
// Pre-signed URL helpers
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_PUT_TTL_SECONDS = 300 // 5 min (D-05)
const DEFAULT_GET_TTL_SECONDS = 900 // 15 min (D-06)
const MAX_PUT_TTL_SECONDS = 300 // hard cap — prevents accidental long-lived URLs
const DEFAULT_PUT_SIZE_MAX_BYTES = 25 * 1024 * 1024 // 25 MB matches ORG-02 planta cap

export interface MintPresignedPutOpts {
  /** Content-Type the upload must declare (browser fetch will fail if it omits). */
  contentType?: string
  /** Upper bound enforced server-side via `statObject` after upload completes. */
  sizeMaxBytes?: number
  /** TTL in seconds — defaults to 300; clamped to MAX_PUT_TTL_SECONDS. */
  ttlSeconds?: number
}

export interface MintPresignedPutResult {
  url: string
  bucket: string
  key: string
  expiresInSeconds: number
  /** Documented size cap — callers MUST re-verify via statObject post-upload. */
  sizeMaxBytes: number
  contentType: string | null
}

/**
 * Mint a pre-signed PUT URL the browser uses to upload directly to MinIO.
 * The Server Action that calls this MUST follow up with `statObject` after
 * the upload completes to verify content-type + size are within bounds
 * (the pre-signed URL alone doesn't enforce them — the browser can pass
 * the wrong Content-Type and MinIO will accept it).
 */
export async function mintPresignedPut(
  tenantSlug: string,
  key: string,
  opts: MintPresignedPutOpts = {},
): Promise<MintPresignedPutResult> {
  const bucket = getTenantBucket(tenantSlug)
  const ttl = Math.min(opts.ttlSeconds ?? DEFAULT_PUT_TTL_SECONDS, MAX_PUT_TTL_SECONDS)
  const sizeMaxBytes = opts.sizeMaxBytes ?? DEFAULT_PUT_SIZE_MAX_BYTES
  const url = await getPublicMinIOClient().presignedPutObject(bucket, key, ttl)
  return {
    url,
    bucket,
    key,
    expiresInSeconds: ttl,
    sizeMaxBytes,
    contentType: opts.contentType ?? null,
  }
}

/**
 * Mint a pre-signed GET URL for object download (vendor doc vault,
 * signed-contract delivery, etc.). Default TTL 15 min (D-06).
 */
export async function mintPresignedGet(
  tenantSlug: string,
  key: string,
  ttlSeconds: number = DEFAULT_GET_TTL_SECONDS,
): Promise<{ url: string; bucket: string; key: string; expiresInSeconds: number }> {
  const bucket = getTenantBucket(tenantSlug)
  const url = await getPublicMinIOClient().presignedGetObject(bucket, key, ttlSeconds)
  return { url, bucket, key, expiresInSeconds: ttlSeconds }
}
