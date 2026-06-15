---
phase: 02-fornecedor-self-service-checkout-pix-cartao
plan: "04"
subsystem: api
tags: [sse, postgres, pg_notify, listen-notify, real-time, graphile-worker, drizzle, better-auth]

# Dependency graph
requires:
  - phase: 02-03
    provides: emitOutboxEvent + emitOutboxEventAndNotify (same-tx pg_notify), reservation.expire task
  - phase: 02-01
    provides: withTenant, fetchTenantIdForOrg, Better Auth session
provides:
  - GET /api/sse/events/[eventId]/lots — SSE Route Handler (text/event-stream, heartbeat, LISTEN/NOTIFY)
  - reservePgListenConnection() — dedicated max:1 postgres.js LISTEN connection factory
  - LOT_NOTIFY_CHANNEL_TASK (lot.notify-channel) — outbox-drain handler for cross-tx pg_notify fan-out
  - 9 integration tests for FORN-07 SSE real-time flow
affects:
  - 02-05
  - 02-06
  - 02-07
  - any plan consuming SSE or lot status fan-out

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SSE ReadableStream with AbortSignal cleanup (req.signal.addEventListener('abort', ...))"
    - "Dedicated max:1 idle_timeout:0 postgres.js LISTEN connection per SSE client"
    - "Session-first tenant derivation: fetchTenantIdForOrg(activeOrganizationId) before withTenant"
    - "conn.listen() returns { state, unlisten } — capture unlistenFn for cleanup"
    - "Array.from(result as Iterable<T>) for Drizzle db.execute() with postgres.js driver"
    - "SSE_HEARTBEAT_MS env read lazily per-request (not at module load) for test overridability"
    - "trackedController() + afterEach abort pattern to prevent LISTEN connection leaks in tests"
    - "RFC 4122 valid UUIDs in tests required by Zod 4 z.string().uuid() variant-bit check"

key-files:
  created:
    - src/app/api/sse/events/[eventId]/lots/route.ts
    - src/lib/sse/listen-pool.ts
    - src/jobs/tasks/lot-notify-channel.ts
  modified:
    - src/jobs/tasks/index.ts
    - tests/sse/route.test.ts

key-decisions:
  - "Session-first tenant derivation instead of migratorPool direct events query (events table has FORCE RLS, fb_migrator has no bypass policy)"
  - "Cross-tenant attempt returns 404 not 403 — RLS makes event invisible; not distinguishable from not-found without BYPASSRLS (tighter security)"
  - "SSE_HEARTBEAT_MS env variable read lazily per request so tests can override without module reload"
  - "conn.listen() return value captures unlisten function — not a method on Sql directly"
  - "beforeEach (not beforeAll) for tenant + event creation — global afterEach truncates tenants table"
  - "trackedController() + afterEach abort ensures LISTEN connections close even when tests abort early"

patterns-established:
  - "SSE handler pattern: auth → fetchTenantIdForOrg → withTenant event check → ReadableStream"
  - "LISTEN connection factory: postgres(url, { max: 1, idle_timeout: 0 }) with activeCount cap"
  - "Abort cleanup pattern: unlisten() → conn.end() → controller.close() all guarded with try/catch"

requirements-completed:
  - FORN-07

# Metrics
duration: 240min
completed: 2026-06-15
---

# Phase 02 Plan 04: SSE Fan-out Summary

**Real-time lot status SSE stream via dedicated postgres.js LISTEN connections, session-first tenant guard, and outbox-drain lot.notify-channel task — closes FORN-07**

## Performance

- **Duration:** ~240 min (multi-session; cross-context from prior conversation)
- **Started:** 2026-06-15T14:00:00Z
- **Completed:** 2026-06-15T20:46:56Z
- **Tasks:** 3 (RED test commit, GREEN implementation commit, docs commit)
- **Files modified:** 5

## Accomplishments
- `GET /api/sse/events/[eventId]/lots` Route Handler: auth guard, tenant derivation, event existence check via RLS, `ReadableStream` with 30s heartbeat and `pg_notify` LISTEN, `AbortSignal` cleanup — closes FORN-07
- `reservePgListenConnection()`: dedicated `max:1, idle_timeout:0` postgres.js client per SSE client with `MAX_SSE_CONN` cap (200) and Pino observability
- `LOT_NOTIFY_CHANNEL_TASK`: Graphile-Worker outbox-drain handler that fires `pg_notify` for lot status changes that occurred outside the originating transaction (e.g. `payment.paid` → `lot.sold` cascade)
- 9 integration tests passing; full suite now at 216 tests (was 207)

## Task Commits

1. **RED: failing SSE integration tests** - `9fabccc` (test)
2. **GREEN: SSE route + listen-pool + lot-notify-channel** - `c9751c6` (feat)
3. **Docs: SUMMARY** - (this commit)

## Files Created/Modified

- `src/app/api/sse/events/[eventId]/lots/route.ts` — SSE Route Handler with auth, tenant guard, ReadableStream, heartbeat, LISTEN/NOTIFY, AbortSignal cleanup
- `src/lib/sse/listen-pool.ts` — `reservePgListenConnection()` factory with capacity cap and Pino logging
- `src/jobs/tasks/lot-notify-channel.ts` — `LOT_NOTIFY_CHANNEL_TASK` handler: Zod 4 payload validation + `migratorPool` pg_notify
- `src/jobs/tasks/index.ts` — registered `[LOT_NOTIFY_CHANNEL_TASK]: lotNotifyChannel`
- `tests/sse/route.test.ts` — 9 integration tests covering all FORN-07 behaviors (headers, data, auth, cross-tenant, heartbeat, cleanup, same-tx notify, outbox task fan-out)

## Decisions Made

- **Session-first tenant derivation**: The plan specified `migratorPool SELECT tenant_id FROM events WHERE id = ?` but the `events` table has `FORCE ROW LEVEL SECURITY` with only an `fb_eventos_app`-targeted policy. `fb_migrator` has no bypass policy on `events` (unlike `lot_reservations` which has explicit migrator policies). Changed to: derive `tenantId` from `session.activeOrganizationId` via `fetchTenantIdForOrg` (queries `tenants` table — no RLS), then use `withTenant(tenantId)` to verify event existence in RLS scope.

- **Cross-tenant returns 404 not 403**: RLS makes cross-tenant events invisible (returns empty result set); the handler cannot distinguish "event in other tenant" from "event not found" without BYPASSRLS. Returning 404 is more secure (prevents tenant data ownership disclosure). Test updated to accept `[403, 404]`.

- **SSE_HEARTBEAT_MS env read lazily**: Must be read per-request (not at module load) so tests can override `process.env.SSE_HEARTBEAT_MS = '100'` without requiring a module reload.

- **conn.listen() return value pattern**: postgres.js `sql.listen(channel, cb)` returns `{ state, unlisten }` — the `unlisten` function is on the return object, not directly on the `Sql` instance. Captured as `unlistenFn = listenResult.unlisten`.

- **beforeEach for tenant creation**: Global `afterEach` in `src/test/setup.ts` truncates the `tenants` table. Any tenant created in `beforeAll` is wiped after the first test. All test state must be created in `beforeEach`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FORCE RLS on events table blocks migratorPool**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** Plan specified `migratorPool\`SELECT tenant_id FROM events WHERE id = ?\`` for event existence check, but `events` table has `FORCE ROW LEVEL SECURITY` with only an `fb_eventos_app` role policy. `fb_migrator` has no BYPASSRLS on this table (unlike `lot_reservations` which has explicit migrator-read policies). Query returned empty result even for valid events → happy path returned 404.
- **Fix:** Changed to session-first flow: `fetchTenantIdForOrg(activeOrganizationId)` (tenants table has no RLS) then `withTenant(tenantId, db => db.execute(SELECT 1 FROM events...))` which runs under the app role with `SET LOCAL app.current_tenant_id`.
- **Files modified:** `src/app/api/sse/events/[eventId]/lots/route.ts`
- **Verification:** Test 1 happy path passes; cross-tenant test passes
- **Committed in:** `c9751c6`

**2. [Rule 1 - Bug] Drizzle db.execute() returns iterable, not { rows: [...] }**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** `result.rows.length` TypeError — postgres.js through Drizzle returns a `postgres.RowList` iterable, not `{ rows: [...] }`.
- **Fix:** `const rows = Array.from(result as Iterable<{ found: number }>); eventExists = rows.length > 0`
- **Files modified:** `src/app/api/sse/events/[eventId]/lots/route.ts`
- **Verification:** TypeScript compiles; test passes
- **Committed in:** `c9751c6`

**3. [Rule 1 - Bug] postgres.js unlisten API — method is on listen() return value**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** `conn.unlisten(channel)` does not exist on `Sql<{}>`. TypeScript error TS2551.
- **Fix:** `const listenResult = await conn.listen(channel, cb); unlistenFn = listenResult.unlisten`
- **Files modified:** `src/app/api/sse/events/[eventId]/lots/route.ts`
- **Verification:** TypeScript compiles; Test 5 cleanup spy passes
- **Committed in:** `c9751c6`

**4. [Rule 1 - Bug] childLogger type accepts only { requestId?, tenantId?, userId? }**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** `childLogger({ module: 'sse:listen-pool' })` TypeScript error TS2353 — the project's `childLogger` helper has a narrower type than `logger.child()`.
- **Fix:** Changed to `logger.child({ module: 'sse:listen-pool' })` in `listen-pool.ts` and `logger.child({ task: LOT_NOTIFY_CHANNEL_TASK })` in `lot-notify-channel.ts`.
- **Files modified:** `src/lib/sse/listen-pool.ts`, `src/jobs/tasks/lot-notify-channel.ts`
- **Verification:** TypeScript compiles cleanly
- **Committed in:** `c9751c6`

**5. [Rule 1 - Bug] Test setup: vi.useFakeTimers() blocks postgres.js async I/O**
- **Found during:** Task 1 (RED tests) + Task 2 (GREEN verification)
- **Issue:** Fake timers interfere with postgres.js connection setup and LISTEN state machine, causing Test 4 (heartbeat) to time out.
- **Fix:** Use real timers; expose `SSE_HEARTBEAT_MS` env for test override so heartbeat fires at 100ms without fake timers.
- **Files modified:** `tests/sse/route.test.ts`, `src/app/api/sse/events/[eventId]/lots/route.ts`
- **Verification:** Test 4 passes within 10s timeout
- **Committed in:** `c9751c6`

**6. [Rule 1 - Bug] LISTEN connection leak in test suite (beforeEach timeout)**
- **Found during:** Task 2 (GREEN verification)
- **Issue:** Tests opened LISTEN connections but didn't reliably close them on abort, exhausting Postgres connection slots and causing subsequent `beforeEach` hooks to block.
- **Fix:** Added `trackedController()` function + `openControllers: AbortController[]` array; `afterEach` aborts all unclosed controllers and waits 100ms for cleanup.
- **Files modified:** `tests/sse/route.test.ts`
- **Verification:** All 9 tests run sequentially without timeout; activeCount logs show clean decrement
- **Committed in:** `c9751c6`

**7. [Rule 1 - Bug] Zod 4 z.string().uuid() requires RFC 4122 variant bits**
- **Found during:** Task 2 (GREEN verification — Test 7)
- **Issue:** Test lot IDs `'00000000-0000-0000-aaaa-000000000001'` fail Zod 4's UUID validator — requires variant bits `0x80xx` in the 3rd octet of the 4th group (bit pattern `10xxxxxx`).
- **Fix:** Changed to RFC 4122 valid IDs: `'00000000-0000-4000-8000-000000000001'` and `'00000000-0000-4000-8000-000000000002'`.
- **Files modified:** `tests/sse/route.test.ts`
- **Verification:** Test 7 (lot.notify-channel fan-out) passes
- **Committed in:** `c9751c6`

**8. [Rule 1 - Bug] createTenant in beforeAll wiped by global afterEach**
- **Found during:** Task 2 (GREEN verification)
- **Issue:** `src/test/setup.ts` global `afterEach` truncates `tenants` table; tenants created in `beforeAll` are wiped after the first test. Tests 2+ received 403/null tenant.
- **Fix:** Moved `createTenant` + `makeEvent` calls from `beforeAll` to `beforeEach`.
- **Files modified:** `tests/sse/route.test.ts`
- **Verification:** All 9 tests pass independently; each has fresh tenant + event
- **Committed in:** `c9751c6`

---

**Total deviations:** 8 auto-fixed (all Rule 1 — bugs discovered during GREEN implementation)
**Impact on plan:** All fixes necessary for correctness. Most significant architectural change: session-first tenant derivation (vs plan's migratorPool approach) due to FORCE RLS on events table. The fix is more secure (no direct migrator access to events needed). No scope creep.

## Issues Encountered

- TypeScript pre-commit hook blocks RED commit if test imports non-existent modules. Resolution: created stub files returning 501/throwing "Not implemented" to satisfy TypeScript, committed as RED, then replaced with real implementation in GREEN commit.
- `fb_eventos_sysreader` has BYPASSRLS but it is NOT inheritable — `fb_migrator` cannot bypass RLS via role membership. Postgres BYPASSRLS is a non-inheritable privilege.

## Known Stubs

None. All implementation is complete and tested.

## Threat Flags

None. No new network endpoints or auth paths introduced beyond what the plan specified. The SSE handler enforces the same auth + tenant guard chain as other protected routes.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- FORN-07 closed: lot status fan-out infrastructure is complete
- Plan 02-05 can wire the PlantaEditor buyer-mode to consume this SSE endpoint
- Plan 02-06 (outbox drain) can use `LOT_NOTIFY_CHANNEL_TASK` as the outbox handler for `lot.status_changed` events
- `emitOutboxEventAndNotify` same-tx path (Test 6) verified working end-to-end

---
*Phase: 02-fornecedor-self-service-checkout-pix-cartao*
*Completed: 2026-06-15*
