// FB_EVENTOS — consent_records versioning + RLS (Phase 0, Plan 05 — LGPD-01).
//
// Assertions:
//   - INSERT two consents for the same user with different versions; both
//     rows persist (versioning by INSERT, NOT upsert).
//   - Plan 04's recordConsentMetadata-style INSERT path still works after
//     the rename consent_ip → ip_address + new consent_text default.
//   - Reads via withTenant return rows in created_at order.

import { and, asc, eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { consentRecords } from '@/db/schema/consent'
import { withTenant } from '@/db/with-tenant'
import { appPool, createTenant, insertUser } from '@/test/db'

describe('consent_records versioning (LGPD-01)', () => {
  afterAll(async () => {
    await appPool.end({ timeout: 5 })
  })

  test('two consents with different versions for same user both persist', async () => {
    const tid = await createTenant(`tenant-consent-${Date.now()}`, 'Consent Co')
    const uid = await insertUser(`consent-${Date.now()}@example.test`)

    await withTenant(tid, async (db) => {
      await db.insert(consentRecords).values({
        userId: uid,
        tenantId: tid,
        consentVersion: '2026-06-01',
        consentText: 'I agree to terms v1.',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      })
    })

    // Slight delay so created_at ordering is deterministic.
    await new Promise((r) => setTimeout(r, 5))

    await withTenant(tid, async (db) => {
      await db.insert(consentRecords).values({
        userId: uid,
        tenantId: tid,
        consentVersion: '2026-07-01',
        consentText: 'I agree to terms v2.',
        ipAddress: '203.0.113.11',
        userAgent: 'vitest',
      })
    })

    const rows = await withTenant(tid, async (db) => {
      return db
        .select({
          id: consentRecords.id,
          consentVersion: consentRecords.consentVersion,
          consentText: consentRecords.consentText,
          consentAt: consentRecords.consentAt,
        })
        .from(consentRecords)
        .where(and(eq(consentRecords.userId, uid), eq(consentRecords.tenantId, tid)))
        .orderBy(asc(consentRecords.consentAt))
    })

    expect(rows.length).toBe(2)
    expect(rows[0]?.consentVersion).toBe('2026-06-01')
    expect(rows[1]?.consentVersion).toBe('2026-07-01')
    // Both consent_text snapshots preserved (LGPD Art. 8 evidence).
    expect(rows[0]?.consentText).toBe('I agree to terms v1.')
    expect(rows[1]?.consentText).toBe('I agree to terms v2.')
  })

  test('consent_text defaults to empty string when omitted (Plan 04 back-compat)', async () => {
    const tid = await createTenant(`tenant-default-${Date.now()}`, 'Default Co')
    const uid = await insertUser(`default-${Date.now()}@example.test`)

    // Plan 04's recordConsentMetadata does NOT pass consent_text; the DB
    // default of '' must keep that flow valid.
    await withTenant(tid, async (db) => {
      await db.insert(consentRecords).values({
        userId: uid,
        tenantId: tid,
        consentVersion: '2026-06-01',
        ipAddress: '203.0.113.20',
        userAgent: 'vitest',
        // consent_text intentionally omitted
      })
    })

    const rows = await withTenant(tid, async (db) => {
      return db
        .select({ consentText: consentRecords.consentText })
        .from(consentRecords)
        .where(and(eq(consentRecords.userId, uid), eq(consentRecords.tenantId, tid)))
    })

    expect(rows.length).toBe(1)
    expect(rows[0]?.consentText).toBe('')
  })
})
