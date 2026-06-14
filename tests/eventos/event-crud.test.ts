// FB_EVENTOS — Event CRUD tests (Phase 1, Plan 01-02 — Task 1).
//
// Five load-bearing cases (ORG-01 vertical slice):
//
//   1. createEvent inside tenant A creates a row; listEvents in tenant A
//      returns it.
//   2. createEvent inside tenant A; listEvents in tenant B returns 0 rows
//      (RLS isolation proof).
//   3. updateEvent on tenant A's event while operating in tenant B's context
//      returns null (RLS — UPDATE silently affects 0 rows cross-tenant).
//   4. eventCreateSchema rejects payload when starts_at >= ends_at.
//   5. createEvent records an audit_log row with action='event.created'.
//
// All tests use the pure business helpers (createEventInTenant,
// updateEventInTenant, listEventsInTenant) so we exercise the RLS contract
// without needing a Better Auth session round-trip.

import { and, eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { pool } from '@/db'
import { auditLog } from '@/db/schema/audit'
import { withTenant } from '@/db/with-tenant'
import {
  createEventInTenant,
  getEventByIdInTenant,
  listEventsInTenant,
  updateEventInTenant,
} from '@/lib/actions/eventos'
import { eventCreateSchema } from '@/lib/validators/event'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'

let tenantAId = ''
let tenantBId = ''
let userId = ''

beforeEach(async () => {
  const stamp = Date.now()
  tenantAId = await createTenant(`tenant-a-${stamp}`, 'Tenant A — Acme')
  tenantBId = await createTenant(`tenant-b-${stamp}`, 'Tenant B — Beta')
  userId = await insertUser(`org-actor-${stamp}@example.test`, 'Org Actor')
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

describe('event CRUD — tenant isolation + audit (Plan 01-02 Task 1)', () => {
  test('createEvent inside tenant A; listEvents in tenant A returns it', async () => {
    const created = await withTenant(tenantAId, async (db) => {
      return createEventInTenant(
        db,
        tenantAId,
        {
          name: 'Festa A — 2026',
          startsAt: new Date('2026-07-01T08:00:00Z'),
          endsAt: new Date('2026-07-10T22:00:00Z'),
          placeName: 'Santuário A',
          placeAddress: 'Rua A, 100 — Acme/GO',
          capacity: 50000,
          timezone: 'America/Sao_Paulo',
          currency: 'BRL',
        },
        userId,
      )
    })

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.tenantId).toBe(tenantAId)
    expect(created.name).toBe('Festa A — 2026')

    const items = await withTenant(tenantAId, async (db) => {
      return listEventsInTenant(db, tenantAId)
    })

    expect(items.length).toBe(1)
    expect(items[0]?.id).toBe(created.id)
    // No planta uploaded → plantaUrl is null
    expect(items[0]?.plantaUrl).toBeNull()
  })

  test('cross-tenant SELECT isolation: tenant B listEvents returns 0 rows for tenant A events (RLS proof)', async () => {
    // Tenant A creates an event.
    const aEvent = await withTenant(tenantAId, async (db) => {
      return createEventInTenant(
        db,
        tenantAId,
        {
          name: 'Festa A — RLS Test',
          startsAt: new Date('2026-08-01T08:00:00Z'),
          endsAt: new Date('2026-08-02T22:00:00Z'),
          placeName: 'Santuário A',
          placeAddress: 'Endereço Tenant A',
          capacity: 1000,
          timezone: 'America/Sao_Paulo',
          currency: 'BRL',
        },
        userId,
      )
    })
    expect(aEvent.tenantId).toBe(tenantAId)

    // Tenant B lists events — must NOT see tenant A's row.
    const tenantBItems = await withTenant(tenantBId, async (db) => {
      return listEventsInTenant(db, tenantBId)
    })
    expect(tenantBItems.length).toBe(0)

    // Tenant B getEventById on tenant A's id returns null (RLS default-deny).
    const xenoLookup = await withTenant(tenantBId, async (db) => {
      return getEventByIdInTenant(db, aEvent.id)
    })
    expect(xenoLookup).toBeNull()
  })

  test('cross-tenant UPDATE isolation: updateEvent in tenant B context against tenant A event returns null', async () => {
    // Tenant A owns the event.
    const aEvent = await withTenant(tenantAId, async (db) => {
      return createEventInTenant(
        db,
        tenantAId,
        {
          name: 'Festa A — Original',
          startsAt: new Date('2026-09-01T08:00:00Z'),
          endsAt: new Date('2026-09-02T22:00:00Z'),
          placeName: 'Santuário A',
          placeAddress: 'Endereço A',
          capacity: 2000,
          timezone: 'America/Sao_Paulo',
          currency: 'BRL',
        },
        userId,
      )
    })

    // Tenant B tries to update — RLS hides the row, UPDATE affects 0 rows,
    // the helper returns null. No error is thrown — silent default-deny.
    const updated = await withTenant(tenantBId, async (db) => {
      return updateEventInTenant(
        db,
        { id: aEvent.id, name: 'Festa A — Hacked by Tenant B' },
        userId,
      )
    })
    expect(updated).toBeNull()

    // Verify tenant A's row is untouched.
    const aReadback = await withTenant(tenantAId, async (db) => {
      return getEventByIdInTenant(db, aEvent.id)
    })
    expect(aReadback?.name).toBe('Festa A — Original')
  })

  test('eventCreateSchema rejects payload when startsAt >= endsAt (Zod cross-field refine)', async () => {
    const start = new Date('2026-10-01T08:00:00Z')
    const sameAsStart = new Date('2026-10-01T08:00:00Z')
    const beforeStart = new Date('2026-09-30T08:00:00Z')

    const sameResult = eventCreateSchema.safeParse({
      name: 'Boundary test',
      startsAt: start.toISOString(),
      endsAt: sameAsStart.toISOString(),
      placeName: 'Local',
      placeAddress: 'Endereço',
      capacity: 100,
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    })
    expect(sameResult.success).toBe(false)
    if (!sameResult.success) {
      expect(sameResult.error.issues.some((i) => i.path.includes('endsAt'))).toBe(true)
    }

    const beforeResult = eventCreateSchema.safeParse({
      name: 'Inverted dates',
      startsAt: start.toISOString(),
      endsAt: beforeStart.toISOString(),
      placeName: 'Local',
      placeAddress: 'Endereço',
      capacity: 100,
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    })
    expect(beforeResult.success).toBe(false)

    // Sanity: endsAt > startsAt parses fine.
    const okResult = eventCreateSchema.safeParse({
      name: 'OK',
      startsAt: start.toISOString(),
      endsAt: new Date('2026-10-02T08:00:00Z').toISOString(),
      placeName: 'Local',
      placeAddress: 'Endereço',
      capacity: 100,
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
    })
    expect(okResult.success).toBe(true)
  })

  test('createEvent emits an audit_log row with action="event.created" tied to the event id', async () => {
    const created = await withTenant(tenantAId, async (db) => {
      return createEventInTenant(
        db,
        tenantAId,
        {
          name: 'Festa A — Audit Test',
          startsAt: new Date('2026-11-01T08:00:00Z'),
          endsAt: new Date('2026-11-02T22:00:00Z'),
          placeName: 'Santuário A',
          placeAddress: 'Endereço A',
          capacity: 3000,
          timezone: 'America/Sao_Paulo',
          currency: 'BRL',
        },
        userId,
      )
    })

    const auditRows = await withTenant(tenantAId, async (db) => {
      return db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          userId: auditLog.userId,
        })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, created.id), eq(auditLog.action, 'event.created')))
    })

    expect(auditRows.length).toBe(1)
    expect(auditRows[0]?.entity).toBe('event')
    expect(auditRows[0]?.userId).toBe(userId)

    // updateEvent also emits an audit row with action='event.updated'.
    const updated = await withTenant(tenantAId, async (db) => {
      return updateEventInTenant(db, { id: created.id, capacity: 5000 }, userId)
    })
    expect(updated).not.toBeNull()
    expect(updated?.capacity).toBe(5000)

    const updateAudit = await withTenant(tenantAId, async (db) => {
      return db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, created.id), eq(auditLog.action, 'event.updated')))
    })
    expect(updateAudit.length).toBe(1)
  })
})
