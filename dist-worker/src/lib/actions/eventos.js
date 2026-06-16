"use strict";
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
'use server';
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEventById = exports.listEvents = exports.updateEvent = exports.createEvent = void 0;
exports.createEventInTenant = createEventInTenant;
exports.updateEventInTenant = updateEventInTenant;
exports.listEventsInTenant = listEventsInTenant;
exports.getEventByIdInTenant = getEventByIdInTenant;
const drizzle_orm_1 = require("drizzle-orm");
const cache_1 = require("next/cache");
const zod_1 = require("zod");
const db_1 = require("@/db");
const events_1 = require("@/db/schema/events");
const tenants_1 = require("@/db/schema/tenants");
const safe_action_1 = require("@/lib/actions/safe-action");
const audit_1 = require("@/lib/audit");
const minio_1 = require("@/lib/storage/minio");
const event_1 = require("@/lib/validators/event");
// ────────────────────────────────────────────────────────────────────────────
// Tenant-slug lookup (global table, no RLS — safe outside withTenant)
// ────────────────────────────────────────────────────────────────────────────
async function resolveTenantSlug(tenantId) {
    const rows = await db_1.db
        .select({ slug: tenants_1.tenants.slug })
        .from(tenants_1.tenants)
        .where((0, drizzle_orm_1.eq)(tenants_1.tenants.id, tenantId))
        .limit(1);
    return rows[0]?.slug ?? null;
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
async function createEventInTenant(db, tenantId, input, userId) {
    const rows = await db
        .insert(events_1.events)
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
        .returning();
    const row = rows[0];
    if (!row)
        throw new Error('createEventInTenant: insert returned no row');
    await (0, audit_1.recordAudit)(db, {
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
    });
    return toPersistedEvent(row);
}
/**
 * Update an existing event by id. Returns null if no row was updated (either
 * the id doesn't exist, OR — by RLS — the row belongs to a different tenant).
 * The caller MUST check the return value: a cross-tenant attempt is silent
 * (0 rows updated, no error) by design of FORCE RLS.
 */
async function updateEventInTenant(db, input, userId) {
    const patch = {};
    if (input.name !== undefined)
        patch.name = input.name;
    if (input.startsAt !== undefined)
        patch.startsAt = input.startsAt;
    if (input.endsAt !== undefined)
        patch.endsAt = input.endsAt;
    if (input.placeName !== undefined)
        patch.placeName = input.placeName;
    if (input.placeAddress !== undefined)
        patch.placeAddress = input.placeAddress;
    if (input.capacity !== undefined)
        patch.capacity = input.capacity;
    if (input.timezone !== undefined)
        patch.timezone = input.timezone;
    if (input.currency !== undefined)
        patch.currency = input.currency;
    patch.updatedAt = new Date();
    const rows = await db
        .update(events_1.events)
        .set(patch)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(events_1.events.id, input.id), (0, drizzle_orm_1.isNull)(events_1.events.deletedAt)))
        .returning();
    const row = rows[0];
    if (!row)
        return null;
    await (0, audit_1.recordAudit)(db, {
        action: 'event.updated',
        entity: 'event',
        entityId: row.id,
        userId,
        payload: {
            changes: Object.keys(patch).filter((k) => k !== 'updatedAt'),
        },
    });
    return toPersistedEvent(row);
}
/**
 * List all non-deleted events for the current tenant, ordered by start date
 * (most-recent first — UX shows upcoming events at the top). If a planta is
 * uploaded, mint a pre-signed GET URL (TTL 900s) and attach it as
 * `plantaUrl`. The tenant slug is needed for the bucket name; we resolve it
 * via the global tenants table OUTSIDE the RLS-scoped section.
 */
async function listEventsInTenant(db, tenantId) {
    const rows = await db
        .select()
        .from(events_1.events)
        .where((0, drizzle_orm_1.isNull)(events_1.events.deletedAt))
        .orderBy((0, drizzle_orm_1.desc)(events_1.events.startsAt));
    // Resolve tenant slug once for all events (cheap — single PK lookup).
    const tenantSlug = await resolveTenantSlug(tenantId);
    const items = [];
    for (const row of rows) {
        let plantaUrl = null;
        if (row.plantaMinioKey && tenantSlug) {
            try {
                const result = await (0, minio_1.mintPresignedGet)(tenantSlug, row.plantaMinioKey, 900);
                plantaUrl = result.url;
            }
            catch {
                // Transient MinIO blip — degrade to null thumbnail rather than 500.
                plantaUrl = null;
            }
        }
        items.push({ ...toPersistedEvent(row), plantaUrl });
    }
    return items;
}
/**
 * Fetch a single event by id (current tenant via RLS). Returns null if not
 * found OR cross-tenant.
 */
async function getEventByIdInTenant(db, id) {
    const rows = await db
        .select()
        .from(events_1.events)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(events_1.events.id, id), (0, drizzle_orm_1.isNull)(events_1.events.deletedAt)))
        .limit(1);
    return rows[0] ? toPersistedEvent(rows[0]) : null;
}
function toPersistedEvent(row) {
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
    };
}
// ────────────────────────────────────────────────────────────────────────────
// Server Actions (next-safe-action v8) — wrap the helpers
// ────────────────────────────────────────────────────────────────────────────
exports.createEvent = safe_action_1.withTenantAction
    .inputSchema(event_1.eventCreateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await createEventInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId);
    (0, cache_1.revalidatePath)('/[slug]/eventos', 'page');
    return row;
});
exports.updateEvent = safe_action_1.withTenantAction
    .inputSchema(event_1.eventUpdateSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await updateEventInTenant(ctx.db, parsedInput, ctx.userId);
    if (!row) {
        throw new Error('Evento não encontrado ou inacessível');
    }
    (0, cache_1.revalidatePath)('/[slug]/eventos', 'page');
    (0, cache_1.revalidatePath)(`/[slug]/eventos/${row.id}`, 'page');
    return row;
});
exports.listEvents = safe_action_1.withTenantAction.inputSchema(zod_1.z.object({})).action(async ({ ctx }) => {
    return listEventsInTenant(ctx.db, ctx.tenantId);
});
exports.getEventById = safe_action_1.withTenantAction
    .inputSchema(event_1.eventIdSchema)
    .action(async ({ ctx, parsedInput }) => {
    const row = await getEventByIdInTenant(ctx.db, parsedInput.id);
    if (!row) {
        throw new Error('Evento não encontrado');
    }
    return row;
});
