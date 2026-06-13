// FB_EVENTOS — In-memory MinIO mock (Phase 1, Plan 01-01 — Wave 0 test infra).
//
// Pure-memory MinIO replacement for tests. Mimics the subset of the
// `minio-js` v8 client surface that Phase 1 uses:
//
//   - presignedPutObject(bucket, key, expirySeconds)  → opaque test URL
//   - presignedGetObject(bucket, key, expirySeconds)  → opaque test URL
//   - putObject(bucket, key, body, size?, metaData?)  → seed helper for tests
//   - statObject(bucket, key)                         → returns size + metaData
//   - makeBucket(bucket)                              → idempotent bucket create
//   - bucketExists(bucket)                            → membership check
//
// Storage shape:
//   Map<bucket: string, Map<key: string, { body, contentType, size, lastModified }>>
//
// Why in-memory (not testcontainers-minio):
//   - Phase 0 tests run in ~30s without spinning up containers; Wave 0 must
//     preserve that latency budget.
//   - The Phase 1 production code path uses real MinIO via `src/lib/storage/
//     minio.ts`. Tests inject the mock via setMinIOForTests(getMockMinIO())
//     in test setup; production never imports this file.
//   - Pre-signed URL contract is OPAQUE — code under test treats the URL as
//     a blob and never parses it. So a deterministic test URL like
//     `https://minio-mock.local/{bucket}/{key}?test-sig=...` satisfies the
//     production contract without needing real signing crypto.
//
// REFERENCES:
//   - 01-RESEARCH.md §A2 (MinIO singleton + bucketFor)
//   - 01-RESEARCH.md §A4 (presignedPutObject + statObject post-upload verify)
//   - minio-js v8 docs.min.io JS API reference

export interface MinioObject {
  body: Buffer
  contentType: string
  size: number
  lastModified: Date
  metaData: Record<string, string>
}

export interface StatObjectResult {
  size: number
  metaData: Record<string, string>
  lastModified: Date
  etag: string
}

/**
 * Subset of minio-js Client surface used by Phase 1. Production code in
 * `src/lib/storage/minio.ts` instantiates a real `minio.Client`; tests
 * instantiate this mock and inject it via `setMinIOForTests`.
 */
export interface MockMinIOClient {
  presignedPutObject(bucket: string, key: string, expirySeconds: number): Promise<string>
  presignedGetObject(bucket: string, key: string, expirySeconds: number): Promise<string>
  putObject(
    bucket: string,
    key: string,
    body: Buffer | string,
    size?: number,
    metaData?: Record<string, string>,
  ): Promise<{ etag: string; versionId: string | null }>
  statObject(bucket: string, key: string): Promise<StatObjectResult>
  makeBucket(bucket: string): Promise<void>
  bucketExists(bucket: string): Promise<boolean>

  /** Test-only: dump the contents of a bucket for assertions. */
  __debug_listBucket(bucket: string): Array<{ key: string; size: number; contentType: string }>
  /** Test-only: clear all buckets + objects (call in afterEach). */
  __debug_reset(): void
}

class InMemoryMinIO implements MockMinIOClient {
  private buckets = new Map<string, Map<string, MinioObject>>()

  async makeBucket(bucket: string): Promise<void> {
    if (!this.buckets.has(bucket)) {
      this.buckets.set(bucket, new Map())
    }
  }

  async bucketExists(bucket: string): Promise<boolean> {
    return this.buckets.has(bucket)
  }

  async presignedPutObject(bucket: string, key: string, expirySeconds: number): Promise<string> {
    // Ensure bucket exists (auto-create in mock for ergonomic test setup).
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map())
    // Opaque mock URL — tests never parse this.
    return `https://minio-mock.local/${bucket}/${encodeURI(key)}?test-sig=PUT&exp=${expirySeconds}`
  }

  async presignedGetObject(bucket: string, key: string, expirySeconds: number): Promise<string> {
    return `https://minio-mock.local/${bucket}/${encodeURI(key)}?test-sig=GET&exp=${expirySeconds}`
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer | string,
    size?: number,
    metaData?: Record<string, string>,
  ): Promise<{ etag: string; versionId: string | null }> {
    if (!this.buckets.has(bucket)) this.buckets.set(bucket, new Map())
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const meta = metaData ?? {}
    const contentType =
      (meta['Content-Type'] as string | undefined) ??
      (meta['content-type'] as string | undefined) ??
      'application/octet-stream'
    const obj: MinioObject = {
      body: buf,
      contentType,
      size: size ?? buf.length,
      lastModified: new Date(),
      metaData: { ...meta, 'content-type': contentType },
    }
    this.buckets.get(bucket)?.set(key, obj)
    // Deterministic etag — not cryptographically accurate but tests don't
    // verify it, and a stable etag makes snapshot comparisons easier.
    const etag = `"${Buffer.from(`${bucket}/${key}/${obj.size}`).toString('base64').slice(0, 32)}"`
    return { etag, versionId: null }
  }

  async statObject(bucket: string, key: string): Promise<StatObjectResult> {
    const obj = this.buckets.get(bucket)?.get(key)
    if (!obj) {
      const err = new Error(`NoSuchKey: ${bucket}/${key}`) as Error & { code: string }
      err.code = 'NoSuchKey'
      throw err
    }
    const etag = `"${Buffer.from(`${bucket}/${key}/${obj.size}`).toString('base64').slice(0, 32)}"`
    return {
      size: obj.size,
      metaData: obj.metaData,
      lastModified: obj.lastModified,
      etag,
    }
  }

  __debug_listBucket(bucket: string): Array<{ key: string; size: number; contentType: string }> {
    const out: Array<{ key: string; size: number; contentType: string }> = []
    const entries = this.buckets.get(bucket)
    if (!entries) return out
    for (const [key, obj] of entries.entries()) {
      out.push({ key, size: obj.size, contentType: obj.contentType })
    }
    return out
  }

  __debug_reset(): void {
    this.buckets.clear()
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Singleton accessor — tests share one mock so seed/verify span helpers
// ────────────────────────────────────────────────────────────────────────────

let _mock: InMemoryMinIO | null = null

/**
 * Return the shared in-memory mock instance. The same instance is returned
 * across calls within a test process so that one helper can seed an object
 * and another helper can assert on it.
 *
 * Call `getMockMinIO().__debug_reset()` in `afterEach` to clear buckets
 * between tests.
 */
export function getMockMinIO(): MockMinIOClient {
  if (!_mock) _mock = new InMemoryMinIO()
  return _mock
}

/**
 * Test-only: clear the singleton (forces a fresh mock on next call). Use
 * when tests need a guaranteed-clean mock isolated from sibling tests.
 */
export function resetMockMinIO(): void {
  _mock = null
}
