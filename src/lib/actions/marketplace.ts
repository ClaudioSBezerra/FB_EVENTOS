// FB_EVENTOS — Marketplace Server Actions (Phase 2, Plan 02-02).
//
// Two helpers for the tenant-scoped marketplace at /[slug]/marketplace:
//
//   - listOpenEventsInTenant — SELECT published events (status='published',
//       deleted_at IS NULL). Never leaks draft events to fornecedores.
//   - getOpenEventByIdInTenant — SELECT one published event by id.
//       Returns null for drafts or cross-tenant (RLS).
//
// These functions are NOT wrapped in withTenantAction because the caller
// (marketplace/page.tsx Server Component) already calls withTenant() in its
// Pattern S9 boilerplate (analog: src/app/[slug]/eventos/page.tsx).
//
// MarketplaceEvent narrowly exposes only columns the marketplace UI needs —
// avoids leaking internal columns like planta_minio_key or financial data.
//
// REFERENCES:
//   - 02-02-PLAN.md Task 2 <action>
//   - 02-CONTEXT.md FORN-02
//   - src/lib/actions/eventos.ts (listEventsInTenant analog)

'use server'

import { and, asc, eq, isNull } from 'drizzle-orm'

import { events } from '@/db/schema/events'
import type { TenantDb } from '@/db/with-tenant'

// ────────────────────────────────────────────────────────────────────────────
// Narrow public row type (no internal keys exposed to marketplace)
// ────────────────────────────────────────────────────────────────────────────

export interface MarketplaceEvent {
  id: string
  tenantId: string
  name: string
  startsAt: Date
  endsAt: Date
  placeName: string
  capacity: number | null
  timezone: string
  status: string
}

function toMarketplaceEvent(row: typeof events.$inferSelect): MarketplaceEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    placeName: row.placeName,
    capacity: row.capacity,
    timezone: row.timezone,
    status: row.status,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (tests call these inside withTenant directly)
// ────────────────────────────────────────────────────────────────────────────

/**
 * List all published, non-deleted events for the current tenant (via RLS).
 * Ordered by start date ascending (upcoming events first for marketplace UX).
 *
 * The RLS policy on `events` ensures this query never returns cross-tenant rows,
 * even without an explicit `WHERE tenant_id = ?` clause.
 */
export async function listOpenEventsInTenant(
  db: TenantDb,
  _tenantId: string,
): Promise<MarketplaceEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.status, 'published'), isNull(events.deletedAt)))
    .orderBy(asc(events.startsAt))

  return rows.map(toMarketplaceEvent)
}

/**
 * Fetch a single published event by id (RLS-scoped to current tenant).
 * Returns null if the event doesn't exist, is a draft, is deleted, or belongs
 * to a different tenant (FORCE RLS returns 0 rows for cross-tenant attempts).
 */
export async function getOpenEventByIdInTenant(
  db: TenantDb,
  _tenantId: string,
  eventId: string,
): Promise<MarketplaceEvent | null> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.status, 'published'), isNull(events.deletedAt)))
    .limit(1)

  return rows[0] ? toMarketplaceEvent(rows[0]) : null
}
