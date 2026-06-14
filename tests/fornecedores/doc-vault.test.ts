// FB_EVENTOS — Vendor doc cofre tests (Phase 1, Plan 01-04 — Task 3).
//
// Five load-bearing cases (ORG-15):
//
//   1. Upload + confirm round-trip stores the doc row AND statObject verifies
//      content-type + size match.
//   2. Pre-signed PUT URL TTL — the helper returns expiresAt = now + 5min
//      (D-05) and the URL embeds the per-vendor key prefix.
//   3. EVERY download generates an audit_log row carrying actor + doc + ip.
//   4. Content-type mismatch (e.g., .exe disguised as .pdf) is rejected and
//      the orphan object is deleted.
//   5. Tenant B cannot download tenant A's doc (RLS cross-tenant proof).

import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import {
  confirmVendorDocUploadInTenant,
  deleteVendorDocInTenant,
  listVendorDocsInTenant,
  mintVendorDocDownloadUrlInTenant,
  mintVendorDocUploadUrlInTenant,
  VENDOR_DOC_GET_TTL_SECONDS,
  VENDOR_DOC_MAX_BYTES,
  VENDOR_DOC_PUT_TTL_SECONDS,
} from '@/lib/actions/vendor-docs'
import { resetMinIOClient, setMinIOClientForTests } from '@/lib/storage/minio'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'
import { makeVendor } from '@/test/factories/vendor-factory'
import { getMockMinIO, resetMockMinIO } from '@/test/minio-test'

const PDF_HEADER = Buffer.from('%PDF-1.4 minimal test content')

let tenantAId = ''
let tenantBId = ''
let userId = ''
let vendorAId = ''

beforeEach(async () => {
  resetMockMinIO()
  setMinIOClientForTests(getMockMinIO())

  const stamp = Date.now()
  tenantAId = await createTenant(`vdoc-a-${stamp}`, 'Vendor-Doc Tenant A')
  tenantBId = await createTenant(`vdoc-b-${stamp}`, 'Vendor-Doc Tenant B')
  userId = await insertUser(`vdoc-actor-${stamp}@example.test`, 'Vendor Doc Actor')

  const vendor = await makeVendor(tenantAId, { status: 'approved' })
  vendorAId = vendor.id
})

afterAll(async () => {
  resetMinIOClient()
  resetMockMinIO()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

describe('vendor doc cofre — upload + confirm (Plan 01-04 Task 3)', () => {
  test('mintVendorDocUploadUrl returns pre-signed URL with per-vendor key prefix + 5min TTL', async () => {
    const result = await withTenant(tenantAId, async (db) =>
      mintVendorDocUploadUrlInTenant(db, tenantAId, {
        vendorId: vendorAId,
        fileName: 'contrato-social.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      }),
    )

    expect(result.bucket).toMatch(/^vdoc-a-.*-uploads$/)
    expect(result.key).toMatch(
      new RegExp(`^vendor-docs/${vendorAId}/[0-9a-f]{16}-contrato-social\\.pdf$`),
    )
    expect(result.contentType).toBe('application/pdf')
    expect(result.sizeMaxBytes).toBe(VENDOR_DOC_MAX_BYTES)
    expect(result.url).toContain('test-sig=PUT')

    // TTL = now + 5min (within a 5s tolerance band).
    const expiresAt = new Date(result.expiresAt).getTime()
    const expectedExpiry = Date.now() + VENDOR_DOC_PUT_TTL_SECONDS * 1000
    expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(5_000)
  })

  test('confirmVendorDocUpload on a valid PDF stores the doc row + audit', async () => {
    const minted = await withTenant(tenantAId, async (db) =>
      mintVendorDocUploadUrlInTenant(db, tenantAId, {
        vendorId: vendorAId,
        fileName: 'rg.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF_HEADER.length,
      }),
    )

    const mock = getMockMinIO()
    await mock.putObject(minted.bucket, minted.key, PDF_HEADER, PDF_HEADER.length, {
      'content-type': 'application/pdf',
    })

    const confirmed = await withTenant(tenantAId, async (db) =>
      confirmVendorDocUploadInTenant(
        db,
        tenantAId,
        { vendorId: vendorAId, key: minted.key, docType: 'rg' },
        userId,
      ),
    )
    expect(confirmed.ok).toBe(true)
    expect(confirmed.key).toBe(minted.key)
    expect(confirmed.contentType).toBe('application/pdf')

    // Row persisted via listVendorDocs.
    const docs = await withTenant(tenantAId, async (db) =>
      listVendorDocsInTenant(db, { vendorId: vendorAId }),
    )
    expect(docs).toHaveLength(1)
    expect(docs[0]?.docType).toBe('rg')
    expect(docs[0]?.minioKey).toBe(minted.key)

    // Audit row written.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE entity = 'vendor_document' AND entity_id = ${confirmed.docId}
      `
    })
    expect(audits.map((a) => a.action)).toContain('vendor.doc_uploaded')
  })
})

describe('vendor doc cofre — download audit + RLS (Plan 01-04 Task 3)', () => {
  async function seedDoc(): Promise<string> {
    const minted = await withTenant(tenantAId, async (db) =>
      mintVendorDocUploadUrlInTenant(db, tenantAId, {
        vendorId: vendorAId,
        fileName: 'comprovante.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF_HEADER.length,
      }),
    )
    const mock = getMockMinIO()
    await mock.putObject(minted.bucket, minted.key, PDF_HEADER, PDF_HEADER.length, {
      'content-type': 'application/pdf',
    })
    const confirmed = await withTenant(tenantAId, async (db) =>
      confirmVendorDocUploadInTenant(
        db,
        tenantAId,
        { vendorId: vendorAId, key: minted.key, docType: 'comprovante_endereco' },
        userId,
      ),
    )
    return confirmed.docId
  }

  test('mintVendorDocDownloadUrl writes audit row with actor + doc + ip on EVERY call', async () => {
    const docId = await seedDoc()

    const first = await withTenant(tenantAId, async (db) =>
      mintVendorDocDownloadUrlInTenant(db, tenantAId, { docId }, userId, '203.0.113.10'),
    )
    expect(first.url).toContain('test-sig=GET')
    const expiry = new Date(first.expiresAt).getTime()
    expect(Math.abs(expiry - (Date.now() + VENDOR_DOC_GET_TTL_SECONDS * 1000))).toBeLessThan(5_000)

    // Second download → second audit row (LGPD: each access logged).
    await withTenant(tenantAId, async (db) =>
      mintVendorDocDownloadUrlInTenant(db, tenantAId, { docId }, userId, '203.0.113.11'),
    )

    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ action: string; ip_address: string | null }>>`
        SELECT action, ip_address FROM audit_log
        WHERE entity = 'vendor_document' AND entity_id = ${docId}
          AND action = 'vendor.doc_downloaded'
        ORDER BY created_at ASC
      `
    })
    expect(audits).toHaveLength(2)
    expect(audits.map((a) => a.ip_address)).toEqual(['203.0.113.10', '203.0.113.11'])
  })

  test('cross-tenant: tenant B cannot download tenant A doc (RLS)', async () => {
    const docId = await seedDoc()

    await expect(
      withTenant(tenantBId, async (db) =>
        mintVendorDocDownloadUrlInTenant(db, tenantBId, { docId }, userId, '203.0.113.99'),
      ),
    ).rejects.toThrow(/não encontrado|inacessível/i)

    // Audit log carries NO row from the cross-tenant attempt (we threw before
    // recordAudit). LGPD requirement: don't pollute tenant B's audit_log
    // with cross-tenant access attempts.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantBId}, true)`
      return tx<Array<{ id: string }>>`
        SELECT id FROM audit_log WHERE entity_id = ${docId}
      `
    })
    expect(audits).toHaveLength(0)
  })
})

describe('vendor doc cofre — content-type mismatch + delete (Plan 01-04 Task 3)', () => {
  test('content-type mismatch (.exe disguised as .pdf) rejected + orphan deleted', async () => {
    const minted = await withTenant(tenantAId, async (db) =>
      mintVendorDocUploadUrlInTenant(db, tenantAId, {
        vendorId: vendorAId,
        fileName: 'evil.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      }),
    )

    const mock = getMockMinIO()
    await mock.putObject(minted.bucket, minted.key, Buffer.from('MZ-evil'), 1024, {
      'content-type': 'application/octet-stream',
    })
    expect(mock.__debug_listBucket(minted.bucket).length).toBe(1)

    await expect(
      withTenant(tenantAId, async (db) =>
        confirmVendorDocUploadInTenant(
          db,
          tenantAId,
          { vendorId: vendorAId, key: minted.key, docType: 'rg' },
          userId,
        ),
      ),
    ).rejects.toThrow(/Tipo de conteúdo inválido/)

    // Orphan removed.
    expect(mock.__debug_listBucket(minted.bucket).length).toBe(0)

    // No DB row persisted.
    const docs = await withTenant(tenantAId, async (db) =>
      listVendorDocsInTenant(db, { vendorId: vendorAId }),
    )
    expect(docs).toHaveLength(0)
  })

  test('deleteVendorDoc soft-deletes the row + audit', async () => {
    const minted = await withTenant(tenantAId, async (db) =>
      mintVendorDocUploadUrlInTenant(db, tenantAId, {
        vendorId: vendorAId,
        fileName: 'temp.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF_HEADER.length,
      }),
    )
    const mock = getMockMinIO()
    await mock.putObject(minted.bucket, minted.key, PDF_HEADER, PDF_HEADER.length, {
      'content-type': 'application/pdf',
    })
    const confirmed = await withTenant(tenantAId, async (db) =>
      confirmVendorDocUploadInTenant(
        db,
        tenantAId,
        { vendorId: vendorAId, key: minted.key, docType: 'rg' },
        userId,
      ),
    )

    const ok = await withTenant(tenantAId, async (db) =>
      deleteVendorDocInTenant(db, { docId: confirmed.docId }, userId),
    )
    expect(ok).toBe(true)

    // Not visible in list.
    const docs = await withTenant(tenantAId, async (db) =>
      listVendorDocsInTenant(db, { vendorId: vendorAId }),
    )
    expect(docs).toHaveLength(0)

    // Audit captured deletion.
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log
        WHERE entity = 'vendor_document' AND entity_id = ${confirmed.docId}
        ORDER BY created_at ASC
      `
    })
    const actions = audits.map((a) => a.action)
    expect(actions).toContain('vendor.doc_uploaded')
    expect(actions).toContain('vendor.doc_deleted')
  })
})
