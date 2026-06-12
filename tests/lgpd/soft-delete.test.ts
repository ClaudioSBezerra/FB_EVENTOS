// FB_EVENTOS — soft-delete semantics (Phase 0, Plan 05 — LGPD-05).
//
// Assertions on the `organization` table (which carries no deleted_at by
// default — we ADD ONE here via a temporary ALTER TABLE in the test to
// avoid mutating production schema; alternative: pivot to `tenants` which
// has deleted_at by design).
//
// Actually use `tenants` since it has deleted_at from Plan 03. Verifies:
//   - softDelete(db, tenants, id) sets deleted_at to a non-null timestamp.
//   - Query WITHOUT notDeleted() sees the row (with deleted_at non-null).
//   - Query WITH notDeleted() filter hides the row.

import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { db } from '@/db'
import { tenants } from '@/db/schema/tenants'
import { notDeleted, softDelete } from '@/lib/soft-delete'
import { appPool, createTenant, migratorPool } from '@/test/db'

describe('soft-delete helpers (LGPD-05)', () => {
  afterAll(async () => {
    await appPool.end({ timeout: 5 })
  })

  test('softDelete sets deleted_at; notDeleted() filter excludes the row', async () => {
    const tid = await createTenant(`soft-${Date.now()}`, 'Soft Co')

    // tenants is a GLOBAL lookup table — no RLS policy, no tenant_isolation.
    // softDelete works against the singleton `db` directly.
    await softDelete(db, tenants, tid)

    // Read via migratorPool (tenants is unrestricted; either pool would work).
    // Without notDeleted filter — row still visible with deleted_at set.
    const allRows = await migratorPool<{ id: string; deletedAt: Date | null }[]>`
      SELECT id, deleted_at AS "deletedAt" FROM tenants WHERE id = ${tid}
    `
    expect(allRows.length).toBe(1)
    expect(allRows[0]?.deletedAt).not.toBeNull()

    // With notDeleted filter — row hidden.
    const liveRows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, tid), notDeleted(tenants)))

    expect(liveRows.length).toBe(0)

    // Sanity: without the filter, row is visible via the singleton db too.
    const allViaDb = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tid))
    expect(allViaDb.length).toBe(1)
  })

  test('notDeleted helper returns isNull(deletedAt) predicate (smoke)', async () => {
    // Two tenants: one live, one soft-deleted.
    const liveId = await createTenant(`live-${Date.now()}`, 'Live Co')
    const deadId = await createTenant(`dead-${Date.now()}`, 'Dead Co')
    await softDelete(db, tenants, deadId)

    const live = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(notDeleted(tenants))

    const liveIds = live.map((r) => r.id)
    expect(liveIds).toContain(liveId)
    expect(liveIds).not.toContain(deadId)
  })
})
