"use strict";
// FB_EVENTOS — cnpj_lookup_cache table (Phase 1, Plan 01-04 — Task 1).
//
// Global (cross-tenant) cache of successful BrasilAPI /cnpj/v1/:cnpj
// responses. BrasilAPI data is PUBLIC (Receita Federal), so no RLS is
// applied — the cache is shared across all tenants.
//
// CACHE POLICY:
//   - cached_at < 7 days  → cache hit, return payload + source='cache'
//   - cached_at ≥ 7 days  → cache miss, refresh via BrasilAPI
//   - Only SUCCESSFUL ATIVA (situacao_cadastral=2) responses are cached.
//     Inactive / 404 / 5xx responses are NEVER persisted (status may change,
//     and we want to re-attempt on the next request).
//
// PUBLIC DATA RATIONALE:
//   CNPJ + razão social + endereço + CNAE are all public data from
//   Receita Federal. Caching them is not a privacy concern — and serving
//   them cross-tenant amortizes the BrasilAPI free-tier budget across
//   the entire SaaS.
//
// REFERENCES:
//   - 01-CONTEXT.md D-16 (BrasilAPI degrade strategy)
//   - 01-RESEARCH.md §A3 / §A10 (BrasilAPI shape + no published SLA)
//   - src/db/migrations/0012_cnpj_lookup_cache.sql
Object.defineProperty(exports, "__esModule", { value: true });
exports.cnpjLookupCache = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.cnpjLookupCache = (0, pg_core_1.pgTable)('cnpj_lookup_cache', {
    /** Normalized 14-digit CNPJ (no formatting). */
    cnpj: (0, pg_core_1.text)('cnpj').primaryKey(),
    /** Verbatim BrasilAPI JSON response (or a subset projected at write time). */
    payload: (0, pg_core_1.jsonb)('payload').notNull(),
    /** Timestamp of the API call that produced this row — drives 7-day TTL. */
    cachedAt: (0, pg_core_1.timestamp)('cached_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    /** Index on cached_at supports periodic cleanup of stale rows. */
    (0, pg_core_1.index)('cnpj_lookup_cache_cached_at_idx').on(table.cachedAt),
]);
// NO `.enableRLS()` — this is a global cache of public data, by design.
