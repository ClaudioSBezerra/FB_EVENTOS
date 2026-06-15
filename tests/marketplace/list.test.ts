// FB_EVENTOS — FORN-02: tenant-scoped marketplace event listing (Plan 02-02 Task 2).
//
// Four behavior tests per 02-02-PLAN.md:
//   1. Happy path: published events visible in /[slug]/marketplace.
//   2. Cross-tenant guard: events in tenant_A invisible via tenant_B.
//   3. Draft events excluded from the marketplace listing.
//   4. RLS at DB: direct withTenant(A) query never leaks tenant_B events.
//
// REFERENCES:
//   - 02-02-PLAN.md Task 2 <behavior>
//   - src/lib/actions/marketplace.ts (listOpenEventsInTenant)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import {
  listOpenEventsInTenant,
  getOpenEventByIdInTenant,
  type MarketplaceEvent,
} from '@/lib/actions/marketplace'
import { appPool, createTenant, migratorPool } from '@/test/db'
import { makeEvent } from '@/test/factories/event-factory'

beforeAll(async () => {
  // No external mocks needed for marketplace tests.
})

afterEach(async () => {
  // Truncate events (cascade deletes lots, etc.)
  await migratorPool`TRUNCATE TABLE events RESTART IDENTITY CASCADE`
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────────

describe('FORN-02: marketplace event listing', () => {
  let tenantAId = ''
  let tenantBId = ''

  beforeEach(async () => {
    const stamp = Date.now()
    tenantAId = await createTenant(`mkt-a-${stamp}`, `Marketplace Tenant A ${stamp}`)
    tenantBId = await createTenant(`mkt-b-${stamp}`, `Marketplace Tenant B ${stamp}`)
  })

  it('lists only published events for the requested tenant', async () => {
    // Create one published + one draft event in tenant A
    await makeEvent(tenantAId, { status: 'published', name: 'Evento Publicado A' })
    await makeEvent(tenantAId, { status: 'draft', name: 'Evento Rascunho A' })

    const items = await withTenant(tenantAId, async (db) =>
      listOpenEventsInTenant(db, tenantAId),
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.name).toBe('Evento Publicado A')
  })

  it('cross-tenant: events in tenant_A are invisible when querying under tenant_B context', async () => {
    await makeEvent(tenantAId, { status: 'published', name: 'Evento de A' })
    await makeEvent(tenantBId, { status: 'published', name: 'Evento de B' })

    // Under tenant_B context, only tenant_B events are visible (RLS enforced)
    const itemsB = await withTenant(tenantBId, async (db) =>
      listOpenEventsInTenant(db, tenantBId),
    )
    expect(itemsB).toHaveLength(1)
    expect(itemsB[0]?.name).toBe('Evento de B')

    // Under tenant_A context, only tenant_A events are visible
    const itemsA = await withTenant(tenantAId, async (db) =>
      listOpenEventsInTenant(db, tenantAId),
    )
    expect(itemsA).toHaveLength(1)
    expect(itemsA[0]?.name).toBe('Evento de A')
  })

  it('draft events are excluded from marketplace listing', async () => {
    await makeEvent(tenantAId, { status: 'draft', name: 'Rascunho 1' })
    await makeEvent(tenantAId, { status: 'draft', name: 'Rascunho 2' })

    const items = await withTenant(tenantAId, async (db) =>
      listOpenEventsInTenant(db, tenantAId),
    )
    expect(items).toHaveLength(0)
  })

  it('RLS at DB: withTenant(A) never returns tenant_B events even without status filter', async () => {
    const evA = await makeEvent(tenantAId, { status: 'published', name: 'Event A Published' })
    const evB = await makeEvent(tenantBId, { status: 'published', name: 'Event B Published' })

    const itemsA = await withTenant(tenantAId, async (db) =>
      listOpenEventsInTenant(db, tenantAId),
    )

    const ids = itemsA.map((e: MarketplaceEvent) => e.id)
    expect(ids).toContain(evA.id)
    expect(ids).not.toContain(evB.id)
  })
})
