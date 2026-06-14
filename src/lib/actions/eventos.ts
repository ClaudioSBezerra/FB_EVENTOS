// FB_EVENTOS — Event CRUD Server Actions (Phase 1, Plan 01-02 — Task 1).
//
// Three Server Actions wrapped in `withTenantAction`:
//
//   - createEvent — INSERT a new event row + recordAudit('event.created')
//   - updateEvent — UPDATE an existing event row + recordAudit('event.updated')
//   - listEvents  — SELECT all non-deleted events for the active tenant;
//                   if planta_minio_key is set, mint a pre-signed GET URL
//                   (TTL 900s) and expose it as `planta_url`.
//
// SHAPE (testability):
//   Each Server Action is a thin wrapper around a pure business helper that
//   takes (db: TenantDb, input, ctx) — the helpers are exported so tests can
//   call them inside `withTenant(tid, async (db) => ...)` without needing a
//   full Better Auth session round-trip. The Server Actions layer adds:
//     - Zod input parsing (next-safe-action v8 `.inputSchema(...)`)
//     - withTenantAction middleware → session + tenant + scoped db handle
//     - recordAudit at the boundary
//     - revalidatePath on writes (so Next.js cache invalidates)
//
// RLS CONTRACT:
//   Every query goes through `ctx.db` (the TenantDb handle from withTenant).
//   FORCE RLS on `events` ensures UPDATE/SELECT only sees rows where
//   tenant_id = current_setting('app.current_tenant_id'). updateEvent's
//   WHERE id = ? + tenant_id mismatch = 0 rows returned, no error — the
//   caller must check the return value to detect cross-tenant attempts.
//
// PLANTA URL RESOLUTION:
//   listEvents resolves the tenant slug via the global tenants table (no RLS)
//   then mints a pre-signed GET via getMinIOClient().presignedGetObject().
//   Errors during URL minting are caught per-row and downgrade to
//   `planta_url: null` rather than failing the whole list — this is the
//   right UX: a transient MinIO blip should not 500 the events page.

'use server'

import { and, desc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as singletonDb } from '@/db'
import { events } from '@/db/schema/events'
import { tenants } from '@/db/schema/tenants'
import type { TenantDb } from '@/db/with-tenant'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import { mintPresignedGet } from '@/lib/storage/minio'
import {
  type EventCreateInput,
  type EventUpdateInput,
  eventCreateSchema,
  eventIdSchema,
  eventUpdateSchema,
} from '@/lib/validators/event'

// ────────────────────────────────────────────────────────────────────────────
// Persisted row shape (returned by the helpers + actions)
// ────────────────────────────────────────────────────────────────────────────

export interface PersistedEventRow {
  id: string
  tenantId: string
  name: string
  startsAt: Date
  endsAt: Date
  placeName: string
  placeAddress: string | null
  capacity: number | null
  timezone: string
  currency: string
  status: string
  plantaMinioKey: string | null
  plantaContentType: string | null
  createdAt: Date
  updatedAt: Date
}

export interface EventListItem extends PersistedEventRow {
  /** Pre-signed GET URL (TTL 900s) if the event has a planta uploaded. */
  plantaUrl: string | null
}

// ────────────────────────────────────────────────────────────────────────────
// Tenant-slug lookup (global table, no RLS — safe outside withTenant)
// ────────────────────────────────────────────────────────────────────────────

async function resolveTenantSlug(tenantId: string): Promise<string | null> {
  const rows = await singletonDb
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
  return rows[0]?.slug ?? null
}

// ────────────────────────────────────────────────────────────────────────────
// Pure business helpers (tests call these inside withTenant directly)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Insert a new event row scoped to the current tenant context. The caller
 * MUST already be inside a withTenant() block (the `db` handle is the
 * transaction-scoped Drizzle TenantDb). RLS' WITH CHECK clause enforces
 * `tenant_id = current_setting(...)` — the `tenantId` parameter must match.
 */
export async function createEventInTenant(
  db: TenantDb,
  tenantId: string,
  input: EventCreateInput,
  userId: string,
): Promise<PersistedEventRow> {
  const rows = await db
    .insert(events)
    .values({
      tenantId,
      name: input.name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      placeName: input.placeName,
      placeAddress: input.placeAddress,
      capacity: input.capacity,
      timezone: input.timezone,
      currency: input.currency,
      // status defaults to 'draft' at the catalog
    })
    .returning()

  const row = rows[0]
  if (!row) throw new Error('createEventInTenant: insert returned no row')

  await recordAudit(db, {
    action: 'event.created',
    entity: 'event',
    entityId: row.id,
    userId,
    payload: {
      name: row.name,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      placeName: row.placeName,
      capacity: row.capacity,
    },
  })

  return toPersistedEvent(row)
}

/**
 * Update an existing event by id. Returns null if no row was updated (either
 * the id doesn't exist, OR — by RLS — the row belongs to a different tenant).
 * The caller MUST check the return value: a cross-tenant attempt is silent
 * (0 rows updated, no error) by design of FORCE RLS.
 */
export async function updateEventInTenant(
  db: TenantDb,
  input: EventUpdateInput,
  userId: string,
): Promise<PersistedEventRow | null> {
  const patch: Partial<typeof events.$inferInsert> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt
  if (input.endsAt !== undefined) patch.endsAt = input.endsAt
  if (input.placeName !== undefined) patch.placeName = input.placeName
  if (input.placeAddress !== undefined) patch.placeAddress = input.placeAddress
  if (input.capacity !== undefined) patch.capacity = input.capacity
  if (input.timezone !== undefined) patch.timezone = input.timezone
  if (input.currency !== undefined) patch.currency = input.currency
  patch.updatedAt = new Date()

  const rows = await db
    .update(events)
    .set(patch)
    .where(and(eq(events.id, input.id), isNull(events.deletedAt)))
    .returning()

  const row = rows[0]
  if (!row) return null

  await recordAudit(db, {
    action: 'event.updated',
    entity: 'event',
    entityId: row.id,
    userId,
    payload: {
      changes: Object.keys(patch).filter((k) => k !== 'updatedAt'),
    },
  })

  return toPersistedEvent(row)
}

/**
 * List all non-deleted events for the current tenant, ordered by start date
 * (most-recent first — UX shows upcoming events at the top). If a planta is
 * uploaded, mint a pre-signed GET URL (TTL 900s) and attach it as
 * `plantaUrl`. The tenant slug is needed for the bucket name; we resolve it
 * via the global tenants table OUTSIDE the RLS-scoped section.
 */
export async function listEventsInTenant(db: TenantDb, tenantId: string): Promise<EventListItem[]> {
  const rows = await db
    .select()
    .from(events)
    .where(isNull(events.deletedAt))
    .orderBy(desc(events.startsAt))

  // Resolve tenant slug once for all events (cheap — single PK lookup).
  const tenantSlug = await resolveTenantSlug(tenantId)

  const items: EventListItem[] = []
  for (const row of rows) {
    let plantaUrl: string | null = null
    if (row.plantaMinioKey && tenantSlug) {
      try {
        const result = await mintPresignedGet(tenantSlug, row.plantaMinioKey, 900)
        plantaUrl = result.url
      } catch {
        // Transient MinIO blip — degrade to null thumbnail rather than 500.
        plantaUrl = null
      }
    }
    items.push({ ...toPersistedEvent(row), plantaUrl })
  }
  return items
}

/**
 * Fetch a single event by id (current tenant via RLS). Returns null if not
 * found OR cross-tenant.
 */
export async function getEventByIdInTenant(
  db: TenantDb,
  id: string,
): Promise<PersistedEventRow | null> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1)
  return rows[0] ? toPersistedEvent(rows[0]) : null
}

function toPersistedEvent(row: typeof events.$inferSelect): PersistedEventRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    placeName: row.placeName,
    placeAddress: row.placeAddress,
    capacity: row.capacity,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status,
    plantaMinioKey: row.plantaMinioKey,
    plantaContentType: row.plantaContentType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8) — wrap the helpers
// ────────────────────────────────────────────────────────────────────────────

export const createEvent = withTenantAction
  .inputSchema(eventCreateSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await createEventInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath('/[slug]/eventos', 'page')
    return row
  })

export const updateEvent = withTenantAction
  .inputSchema(eventUpdateSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await updateEventInTenant(ctx.db, parsedInput, ctx.userId)
    if (!row) {
      throw new Error('Evento não encontrado ou inacessível')
    }
    revalidatePath('/[slug]/eventos', 'page')
    revalidatePath(`/[slug]/eventos/${row.id}`, 'page')
    return row
  })

export const listEvents = withTenantAction.inputSchema(z.object({})).action(async ({ ctx }) => {
  return listEventsInTenant(ctx.db, ctx.tenantId)
})

export const getEventById = withTenantAction
  .inputSchema(eventIdSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await getEventByIdInTenant(ctx.db, parsedInput.id)
    if (!row) {
      throw new Error('Evento não encontrado')
    }
    return row
  })
