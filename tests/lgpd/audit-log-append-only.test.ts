// FB_EVENTOS — audit_log append-only contract (Phase 0, Plan 05 — LGPD-04).
//
// Load-bearing assertions:
//   - Happy path: recordAudit inside withTenant inserts a row scoped to the
//     active tenant.
//   - UPDATE attempt: fb_eventos_app has had UPDATE revoked (migration 0007);
//     attempting db.update(auditLog) inside withTenant must fail with a
//     "permission denied" error from Postgres.
//   - DELETE attempt: same as above for DELETE.
//   - SINGLETON-DB MISUSE (load-bearing for the plan's key_links audit):
//     calling recordAudit with the singleton db (outside any withTenant
//     block) must throw — either RLS rejection ("new row violates row-level
//     security policy") OR a CAST 22P02 (when current_setting returns '').
//     This proves the misuse is loud, not silent.
//
// Implementation note: Drizzle wraps the postgres.js PostgresError. The
// `cause` field carries the original — we inspect both .message and
// .cause.code / .cause.message via the extractPgError helper below.

interface PostgresLikeError {
  code?: string
  message?: string
  cause?: PostgresLikeError | unknown
}

function extractPgError(err: unknown): { code: string; message: string } {
  // Drill into err.cause chain to find an object with a Postgres SQLSTATE code.
  let cursor: unknown = err
  for (let i = 0; i < 5 && cursor; i++) {
    const obj = cursor as PostgresLikeError
    if (typeof obj.code === 'string' && /^[0-9A-Z]{5}$/.test(obj.code)) {
      return { code: obj.code, message: obj.message ?? '' }
    }
    cursor = obj.cause
  }
  // Fall back to the top-level message.
  return { code: '', message: String((err as Error | { message?: string })?.message ?? err) }
}

import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { db } from '@/db'
import { auditLog } from '@/db/schema/audit'
import { withTenant } from '@/db/with-tenant'
import { recordAudit } from '@/lib/audit'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'

describe('audit_log append-only contract (LGPD-04)', () => {
  afterAll(async () => {
    await appPool.end({ timeout: 5 })
  })

  test('happy path: recordAudit inside withTenant inserts a tenant-scoped row', async () => {
    const tid = await createTenant(`acme-${Date.now()}`, 'Acme Co')
    const uid = await insertUser(`alice-${Date.now()}@acme.test`)

    await withTenant(tid, async (scopedDb) => {
      await recordAudit(scopedDb, {
        action: 'user.signup',
        entity: 'user',
        entityId: uid,
        userId: uid,
        ipAddress: '203.0.113.7',
        userAgent: 'vitest/test-agent',
        payload: { source: 'integration-test' },
      })
    })

    // Read back via withTenant — RLS-scoped query returns the audit row.
    const rows = await withTenant(tid, async (scopedDb) => {
      return scopedDb
        .select({ id: auditLog.id, action: auditLog.action, userId: auditLog.userId })
        .from(auditLog)
        .where(and(eq(auditLog.userId, uid), eq(auditLog.action, 'user.signup')))
    })

    expect(rows.length).toBe(1)
    expect(rows[0]?.action).toBe('user.signup')
    expect(rows[0]?.userId).toBe(uid)
  })

  test('UPDATE on audit_log is rejected by GRANT layer (REVOKE UPDATE)', async () => {
    const tid = await createTenant(`acme-upd-${Date.now()}`, 'Acme Upd')
    const uid = await insertUser(`alice-upd-${Date.now()}@acme.test`)

    // Insert a row to attempt to update.
    await withTenant(tid, async (scopedDb) => {
      await recordAudit(scopedDb, {
        action: 'lot.reserved',
        entity: 'lot',
        userId: uid,
      })
    })

    // Attempt UPDATE — REVOKE UPDATE means this fails with "permission denied".
    let updateError: unknown = null
    try {
      await withTenant(tid, async (scopedDb) => {
        await scopedDb
          .update(auditLog)
          .set({ action: 'lot.tampered' })
          .where(eq(auditLog.userId, uid))
      })
    } catch (err) {
      updateError = err
    }

    expect(updateError).not.toBeNull()
    const pg = extractPgError(updateError)
    // Postgres error class 42501 ("insufficient_privilege") maps to
    // "permission denied" — the canonical GRANT-layer rejection. The
    // audit_log GRANT layer revoked UPDATE from fb_eventos_app, so the
    // runtime app role cannot tamper with the trail.
    expect(pg.code).toBe('42501')
    expect(pg.message.toLowerCase()).toMatch(/permission denied/)
  })

  test('DELETE on audit_log is rejected by GRANT layer (REVOKE DELETE)', async () => {
    const tid = await createTenant(`acme-del-${Date.now()}`, 'Acme Del')
    const uid = await insertUser(`alice-del-${Date.now()}@acme.test`)

    await withTenant(tid, async (scopedDb) => {
      await recordAudit(scopedDb, {
        action: 'event.created',
        entity: 'event',
        userId: uid,
      })
    })

    let deleteError: unknown = null
    try {
      await withTenant(tid, async (scopedDb) => {
        await scopedDb.delete(auditLog).where(eq(auditLog.userId, uid))
      })
    } catch (err) {
      deleteError = err
    }

    expect(deleteError).not.toBeNull()
    const pg = extractPgError(deleteError)
    expect(pg.code).toBe('42501')
    expect(pg.message.toLowerCase()).toMatch(/permission denied/)
  })

  test('SINGLETON-DB MISUSE: recordAudit outside withTenant is rejected (load-bearing for key_links audit)', async () => {
    // No withTenant — current_setting('app.current_tenant_id', true) returns ''
    // → the CAST '' AS uuid raises 22P02 OR the policy withCheck rejects.
    // Either outcome proves the misuse is LOUD, not silent.
    const uid = await insertUser(`misuse-${Date.now()}@example.test`)

    let err: unknown = null
    try {
      // Intentional type cast — recordAudit expects a TenantDb (transaction-
      // scoped); we pass the singleton on purpose to exercise the misuse
      // rejection path. The whole point of this test is that this call MUST
      // throw at runtime.
      // biome-ignore lint/suspicious/noExplicitAny: deliberate misuse test
      await recordAudit(db as any, {
        action: 'leak.attempt',
        entity: 'tenants',
        userId: uid,
      })
    } catch (e) {
      err = e
    }

    expect(err).not.toBeNull()
    const pg = extractPgError(err)
    // Two acceptable outcomes:
    //   - 22P02: invalid_text_representation (CAST '' AS uuid fails because
    //     current_setting returns '' outside a withTenant block).
    //   - 42501: insufficient_privilege (would apply if RLS reduced to GRANT).
    //   - 23514 / RLS-policy-violation message (less common with our policy
    //     because the CAST raises first; we accept it for resilience).
    // The CAST 22P02 path is the STRONGER security signal — it proves the
    // policy fired and the predicate raised before any row was touched.
    expect(['22P02', '42501']).toContain(pg.code)
    expect(pg.message.toLowerCase()).toMatch(
      /invalid input syntax for type uuid|row-level security|violates row-level security|permission denied/,
    )

    // Confirm no row leaked through the singleton db (read via migrator pool
    // bypassing the app role's RLS to look at the catalog state).
    const rows = await migratorPool<{ count: string }[]>`
      SELECT count(*)::text AS count FROM audit_log
      WHERE user_id = ${uid} AND action = 'leak.attempt'
    `
    expect(rows[0]?.count).toBe('0')
  })
})
