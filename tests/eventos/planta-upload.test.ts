// FB_EVENTOS — Planta upload tests (Phase 1, Plan 01-02 — Task 2).
//
// Five load-bearing cases (ORG-02 vertical slice):
//
//   1. mintEventPlantaUploadUrl returns a pre-signed URL with the right
//      bucket prefix + per-event key prefix.
//   2. confirmEventPlantaUpload rejects when statObject's content-type
//      mismatches the original PUT lock — AND deletes the orphan object.
//   3. confirmEventPlantaUpload rejects when statObject's size > 25 MB
//      (seeded via the in-memory mock) — AND deletes the orphan.
//   4. confirmEventPlantaUpload on a valid object updates
//      events.planta_minio_key + planta_content_type.
//   5. Tenant B cannot confirm tenant A's event upload (RLS cross-tenant
//      proof — confirm throws "Evento não encontrado").
//
// Tests inject the in-memory MinIO mock via setMinIOClientForTests so they
// never need a running MinIO container.

import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { events } from '@/db/schema/events'
import { withTenant } from '@/db/with-tenant'
import { createEventInTenant } from '@/lib/actions/eventos'
import {
  confirmEventPlantaUploadInTenant,
  mintEventPlantaUploadUrlInTenant,
} from '@/lib/actions/minio-presign'
import { PLANTA_MAX_BYTES } from '@/lib/actions/minio-presign.shared'
import { resetMinIOClient, setMinIOClientForTests } from '@/lib/storage/minio'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'
import { getMockMinIO, resetMockMinIO } from '@/test/minio-test'

const PDF_HEADER = Buffer.from('%PDF-1.4 minimal test content')

let tenantAId = ''
let tenantASlug = ''
let tenantBId = ''
let tenantBSlug = ''
let userId = ''
let eventAId = ''

beforeEach(async () => {
  resetMockMinIO()
  setMinIOClientForTests(getMockMinIO())

  const stamp = Date.now()
  tenantASlug = `planta-a-${stamp}`
  tenantBSlug = `planta-b-${stamp}`
  tenantAId = await createTenant(tenantASlug, 'Planta Tenant A')
  tenantBId = await createTenant(tenantBSlug, 'Planta Tenant B')
  userId = await insertUser(`planta-actor-${stamp}@example.test`, 'Planta Actor')

  // Seed: tenant A owns an event we'll attach a planta to.
  const a = await withTenant(tenantAId, async (db) => {
    return createEventInTenant(
      db,
      tenantAId,
      {
        name: 'Festa A — Planta Test',
        startsAt: new Date('2026-09-01T08:00:00Z'),
        endsAt: new Date('2026-09-02T22:00:00Z'),
        placeName: 'Santuário A',
        placeAddress: 'Endereço A',
        capacity: 5000,
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
      },
      userId,
    )
  })
  eventAId = a.id
})

afterAll(async () => {
  resetMinIOClient()
  resetMockMinIO()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

describe('planta upload — pre-signed PUT + statObject verification (Plan 01-02 Task 2)', () => {
  test('mintEventPlantaUploadUrl returns a pre-signed URL with the right tenant bucket + per-event key prefix', async () => {
    const result = await withTenant(tenantAId, async (db) => {
      return mintEventPlantaUploadUrlInTenant(db, tenantAId, {
        eventId: eventAId,
        fileName: 'planta-trindade.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1_024 * 100,
      })
    })

    expect(result.bucket).toBe(`${tenantASlug}-uploads`)
    expect(result.key).toMatch(
      new RegExp(`^plantas/${eventAId}/[0-9a-f]{16}-planta-trindade\\.pdf$`),
    )
    expect(result.contentType).toBe('application/pdf')
    expect(result.sizeMaxBytes).toBe(PLANTA_MAX_BYTES)
    expect(result.url).toContain(result.bucket)
    expect(result.url).toContain('test-sig=PUT')

    // expiresAt is a future ISO timestamp.
    const expiresAt = new Date(result.expiresAt)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('confirmEventPlantaUpload rejects content-type mismatch AND deletes the orphan object', async () => {
    // Step 1: mint URL claiming PDF.
    const minted = await withTenant(tenantAId, async (db) => {
      return mintEventPlantaUploadUrlInTenant(db, tenantAId, {
        eventId: eventAId,
        fileName: 'evil.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      })
    })

    // Step 2: simulate the browser uploading with the WRONG content-type
    // (e.g., an .exe renamed .pdf — the browser sends application/octet-stream).
    const mock = getMockMinIO()
    await mock.putObject(minted.bucket, minted.key, PDF_HEADER, PDF_HEADER.length, {
      'content-type': 'application/octet-stream',
    })
    // Sanity: the object exists pre-confirm.
    expect(mock.__debug_listBucket(minted.bucket).length).toBe(1)

    // Step 3: confirm must reject + delete.
    await expect(
      withTenant(tenantAId, async (db) => {
        return confirmEventPlantaUploadInTenant(
          db,
          tenantAId,
          { eventId: eventAId, key: minted.key },
          userId,
        )
      }),
    ).rejects.toThrow(/Tipo de conteúdo inválido/)

    // Orphan was deleted.
    expect(mock.__debug_listBucket(minted.bucket).length).toBe(0)

    // events.planta_minio_key remains null.
    const ev = await withTenant(tenantAId, async (db) => {
      return db.select().from(events).where(eq(events.id, eventAId))
    })
    expect(ev[0]?.plantaMinioKey).toBeNull()
  })

  test('confirmEventPlantaUpload rejects oversized object (> 25 MB) AND deletes the orphan', async () => {
    const minted = await withTenant(tenantAId, async (db) => {
      return mintEventPlantaUploadUrlInTenant(db, tenantAId, {
        eventId: eventAId,
        fileName: 'big.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
      })
    })

    // Seed an oversized stub directly into the mock (the production flow
    // would block this client-side; the test verifies the server-side
    // statObject + size check is the LAST LINE OF DEFENSE).
    const mock = getMockMinIO()
    const oversizedTag = Buffer.from('oversized-stub')
    await mock.putObject(
      minted.bucket,
      minted.key,
      oversizedTag,
      PLANTA_MAX_BYTES + 1, // size override → statObject reports > limit
      { 'content-type': 'application/pdf' },
    )

    await expect(
      withTenant(tenantAId, async (db) => {
        return confirmEventPlantaUploadInTenant(
          db,
          tenantAId,
          { eventId: eventAId, key: minted.key },
          userId,
        )
      }),
    ).rejects.toThrow(/excede o limite/)

    expect(mock.__debug_listBucket(minted.bucket).length).toBe(0)

    const ev = await withTenant(tenantAId, async (db) => {
      return db.select().from(events).where(eq(events.id, eventAId))
    })
    expect(ev[0]?.plantaMinioKey).toBeNull()
  })

  test('confirmEventPlantaUpload on a valid PDF stamps planta_minio_key + planta_content_type', async () => {
    const minted = await withTenant(tenantAId, async (db) => {
      return mintEventPlantaUploadUrlInTenant(db, tenantAId, {
        eventId: eventAId,
        fileName: 'planta-oficial.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF_HEADER.length,
      })
    })

    // Simulate the browser PUT — matching content-type + size in bounds.
    const mock = getMockMinIO()
    await mock.putObject(minted.bucket, minted.key, PDF_HEADER, PDF_HEADER.length, {
      'content-type': 'application/pdf',
    })

    const confirmed = await withTenant(tenantAId, async (db) => {
      return confirmEventPlantaUploadInTenant(
        db,
        tenantAId,
        { eventId: eventAId, key: minted.key },
        userId,
      )
    })

    expect(confirmed.ok).toBe(true)
    expect(confirmed.key).toBe(minted.key)
    expect(confirmed.contentType).toBe('application/pdf')
    expect(confirmed.size).toBe(PDF_HEADER.length)

    const ev = await withTenant(tenantAId, async (db) => {
      return db.select().from(events).where(eq(events.id, eventAId))
    })
    expect(ev[0]?.plantaMinioKey).toBe(minted.key)
    expect(ev[0]?.plantaContentType).toBe('application/pdf')
  })

  test('cross-tenant: tenant B cannot mint or confirm a planta upload for tenant A event (RLS isolation)', async () => {
    // Tenant B tries to mint an upload URL for tenant A's event → throws.
    await expect(
      withTenant(tenantBId, async (db) => {
        return mintEventPlantaUploadUrlInTenant(db, tenantBId, {
          eventId: eventAId,
          fileName: 'attack.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
        })
      }),
    ).rejects.toThrow(/Evento não encontrado/)

    // Even if tenant B SOMEHOW knew tenant A's key prefix, the confirm
    // step must also reject — the RLS check inside the helper goes through
    // getEventByIdInTenant which returns null cross-tenant.
    const fakeKey = `plantas/${eventAId}/aaaaaaaaaaaaaaaa-attack.pdf`
    await expect(
      withTenant(tenantBId, async (db) => {
        return confirmEventPlantaUploadInTenant(
          db,
          tenantBId,
          { eventId: eventAId, key: fakeKey },
          userId,
        )
      }),
    ).rejects.toThrow(/Evento não encontrado/)

    // Sanity: tenant A's event still has planta_minio_key=null (no leak).
    const ev = await withTenant(tenantAId, async (db) => {
      return db.select().from(events).where(eq(events.id, eventAId))
    })
    expect(ev[0]?.plantaMinioKey).toBeNull()
  })
})
