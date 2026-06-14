---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 02
subsystem: events + planta upload (organizadora vertical slice 1)
tags: [events, planta, minio, pre-signed-put, rls, audit, vertical-slice, org-01, org-02]

# Dependency graph
requires:
  - phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
    plan: 01
    provides: [events table with planta_minio_key, MinIO server wrapper, in-memory MinIO mock, event-factory, withTenant boundary]
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides: [withTenantAction chain, recordAudit helper, FORCE RLS contract, Better Auth session.tenant_id]
provides:
  - "Server Action layer for tenant-scoped event CRUD (createEvent, updateEvent, listEvents, getEventById)"
  - "Pure helpers (createEventInTenant, updateEventInTenant, listEventsInTenant, getEventByIdInTenant) so tests exercise RLS without a Better Auth session"
  - "Pre-signed PUT planta upload pipeline (mintEventPlantaUploadUrl + confirmEventPlantaUpload) with statObject content-type + size verification + orphan delete"
  - "Pre-signed GET helper (mintEventPlantaDownloadUrl) for planta download/thumbnail"
  - "Zod validators for event create/update with cross-field starts_at < ends_at refine"
  - "RHF + zodResolver event form + Server Component event list with planta thumbnails"
  - "PlantaUploader client component (browser → MinIO direct PUT → confirm round-trip)"
  - "removeObject in MinIOClientLike + MockMinIOClient (enables orphan-delete test assertions)"
affects: [01-03, 01-04, 01-05, 01-06, 01-07, 01-08]

# Tech tracking
tech-stack:
  added: []  # All deps were already pinned in Plan 01-01
  patterns:
    - "Pure-helper / thin-action split: Server Actions are thin wrappers around (db: TenantDb, input, userId) helpers. Helpers can be tested directly inside withTenant() without a Better Auth session round-trip. Reuse across Phase 1 plans (fornecedores, contratos, cobrancas)."
    - "Cross-field Zod refine on the parent schema (not the field) for date ordering — keeps the field-level errors clean and surfaces the conflict on endsAt via path: ['endsAt']."
    - "Form-input shape via z.input<typeof schema> instead of z.infer so HTML5 datetime-local strings bind cleanly to RHF; the schema's .transform() coerces to Date on parse server-side."
    - "Content-type lock via key-extension contract: mint-time forces the file extension to match the declared content-type; confirm-time re-derives expected content-type from the key extension. Mismatched browser content-type → statObject reports actual → confirm rejects + orphan-deletes."
    - "statObject as the LAST line of defense after the browser's PUT — client size/extension check is FIRST line. A browser dev-tools bypass of the client check still fails server-side."
    - "Tenant-slug resolution OUTSIDE the withTenant block: the tenants table is global (no RLS) and the bucket name needs the slug, so resolve once via the singleton db, then operate inside withTenant."
    - "Audit-row emission inside the same withTenant transaction that mutates the row — append-only GRANT layer keeps the audit_log immutable; recordAudit's tenant_id comes from current_setting() so the policy WITH CHECK is satisfied by construction."

key-files:
  created:
    - src/lib/validators/event.ts
    - src/lib/actions/eventos.ts
    - src/lib/actions/minio-presign.ts
    - src/components/eventos/event-form.tsx
    - src/components/eventos/event-list.tsx
    - src/components/eventos/planta-uploader.tsx
    - src/app/[slug]/eventos/page.tsx
    - src/app/[slug]/eventos/novo/page.tsx
    - src/app/[slug]/eventos/[eventId]/page.tsx
    - tests/eventos/event-crud.test.ts
    - tests/eventos/planta-upload.test.ts
  modified:
    - src/lib/storage/minio.ts                # Added removeObject to MinIOClientLike
    - src/test/minio-test.ts                  # Added removeObject to MockMinIOClient

key-decisions:
  - "Pure-helper testing pattern over wrapping the Server Action with a session mock — Server Actions' next-safe-action v8 middleware chain requires a real Better Auth session; rewriting all of Phase 1 tests to round-trip through that chain would be slow and tightly coupled. Helpers exported alongside the actions let tests exercise the RLS contract directly inside withTenant() with the same code paths the actions execute."
  - "Content-type lock via extension-derived expectation (not a transient lock table) — Phase 1 simplification. The server picks the key extension based on declared content-type at mint time; confirm-time re-derives the expected content-type from the extension. A browser sneaking the wrong content-type fails statObject → orphan-delete + reject. Phase 2 may add a planta_upload_intents table for multi-content-type-per-extension binding, but the pilot doesn't need it."
  - "Form values shape uses z.input<schema> (string-typed dates) rather than z.infer<schema> (Date-typed) — HTML5 datetime-local inputs bind to strings. The schema's .transform() coerces to Date on parse, so the Server Action receives proper Date values."
  - "Orphan deletion is best-effort, not guarded by withTenant — removeObject runs on the singleton MinIO client because cross-tenant key access is already gated by the bucket prefix (plantas/{eventId}/...) and the RLS check that runs BEFORE the delete. Production MinIO Lifecycle policies sweep any leaked orphans as a backstop."
  - "Tests inject the in-memory MockMinIOClient via setMinIOClientForTests(getMockMinIO()) in beforeEach + resetMockMinIO() to clear state — preserves the Plan 01-01 ~30s test budget."

patterns-established:
  - "Pattern: pure-helper/thin-action split for tenant-scoped Server Actions — every tenant-scoped Server Action in Phase 1+ should export a `<actionName>InTenant(db: TenantDb, ..., userId)` helper alongside the next-safe-action wrapper. Tests call the helper inside withTenant; the wrapper handles the Better Auth + Zod + revalidatePath cake."
  - "Pattern: extension-locked pre-signed PUT for fixed-content-type uploads — when the upload's expected content-type is known at mint time, force the key's extension to match. confirm-time re-derives the expected type from the extension. No transient lock table needed."

requirements-completed:
  - ORG-01  # Event CRUD scoped to tenant (create + list + update + detail)
  - ORG-02  # Planta upload via pre-signed PUT to MinIO + statObject verification

# Metrics
duration: ~55m
completed: 2026-06-13
---

# Phase 1 Plan 02: Event CRUD + Planta Upload Summary

**Vertical slice 1 of Phase 1 — organizadora can sign up → pick active org → create an event → upload a planta directly browser→MinIO → see the event card with thumbnail. Delivers ORG-01 + ORG-02.**

## Performance

- **Duration:** ~55 minutes (after retry-from-clean)
- **Started:** 2026-06-13T21:31Z
- **Completed:** 2026-06-13T21:57Z (Task 2 commit)
- **Tasks:** 2
- **Files changed:** 13 (2,133 insertions, 6 deletions)

## Accomplishments

- Event CRUD layer: Zod validators, 4 Server Actions (create/update/list/get), 4 pure helpers tests exercise directly inside withTenant().
- Planta upload pipeline: pre-signed PUT mint (TTL 5min, 25 MB cap, content-type lock) + statObject confirmation + orphan delete on mismatch + audit row.
- Tenant-scoped page hierarchy at `/[slug]/eventos`, `/[slug]/eventos/novo`, `/[slug]/eventos/[eventId]` — all guarded by session + tenant + activeOrg check, all data reads inside `withTenant(tenant.id, ...)`.
- RHF + zodResolver event form with HTML5 datetime-local inputs that round-trip via ISO strings.
- Server Component event list with pre-signed GET (TTL 900s) per row for thumbnails.
- PlantaUploader client component handles the full browser → MinIO direct upload + confirm round-trip with progress + error UX.
- `removeObject` added to MinIOClientLike + MockMinIOClient so orphan-delete is observable in tests.
- 10 new tests (5 event-crud + 5 planta-upload); 78/78 total tests PASSING.

## Task Commits

Each task committed atomically with passing tests:

1. **Task 1: Event schema validator + Server Action CRUD + form** — `76c5de5` (feat)
2. **Task 2: Planta upload — pre-signed PUT + statObject verification + audit** — `85d2717` (feat)

## Files Created/Modified

### Validators + Server Actions
- `src/lib/validators/event.ts` — eventCreateSchema, eventUpdateSchema, eventIdSchema (cross-field date refine, BRL currency lock, America/Sao_Paulo default).
- `src/lib/actions/eventos.ts` — createEvent/updateEvent/listEvents/getEventById Server Actions + pure helpers + listEvents pre-signed GET thumbnail resolution + audit emissions.
- `src/lib/actions/minio-presign.ts` — mintEventPlantaUploadUrl + mintEventPlantaDownloadUrl + confirmEventPlantaUpload Server Actions + helpers + content-type lock semantics + orphan delete.

### Components
- `src/components/eventos/event-form.tsx` — RHF + zodResolver with z.input<schema> form values; datetime-local inputs that emit ISO strings.
- `src/components/eventos/event-list.tsx` — Server Component grid view with shadcn Card + Next/Image (unoptimized for pre-signed URLs) thumbnails.
- `src/components/eventos/planta-uploader.tsx` — Client Component file picker → mint → fetch(PUT) → confirm round-trip with progress + error UI.

### Pages
- `src/app/[slug]/eventos/page.tsx` — list view, guard + withTenant.
- `src/app/[slug]/eventos/novo/page.tsx` — create form, guard.
- `src/app/[slug]/eventos/[eventId]/page.tsx` — detail view + planta preview + uploader, guard + withTenant.

### Test Infrastructure (modifications)
- `src/lib/storage/minio.ts` — added `removeObject(bucket, key)` to MinIOClientLike.
- `src/test/minio-test.ts` — added `removeObject(bucket, key)` to MockMinIOClient + InMemoryMinIO.
- `tests/eventos/event-crud.test.ts` — 5 cases (tenant isolation SELECT, tenant isolation UPDATE, cross-field Zod, audit emission).
- `tests/eventos/planta-upload.test.ts` — 5 cases (mint URL shape, content-type mismatch + orphan delete, oversize + orphan delete, happy path stamps planta_minio_key, cross-tenant RLS).

## Decisions Made

1. **Pure-helper / thin-action split** — every tenant-scoped Server Action in Phase 1+ should export a `<actionName>InTenant(db, ..., userId)` helper alongside the next-safe-action wrapper. Tests call the helper inside `withTenant(tid, async (db) => ...)`; the wrapper layer handles Better Auth + Zod + revalidatePath. This dodges the 2-3× test slowdown of round-tripping through the session middleware and surfaces RLS misconfigurations during test setup, not at runtime.

2. **Content-type lock via extension-derived expectation** — Phase 1 simplifies the content-type lock by binding the key extension to the declared content-type at mint time, then re-deriving the expectation from the extension at confirm time. A browser sneaking the wrong content-type fails statObject → orphan-delete + reject. Phase 2 may add a `planta_upload_intents(tenant_id, key, content_type, size_max, expires_at)` table for multi-content-type-per-extension binding, but the pilot's 3 content types (PDF/PNG/JPG) each map to a unique extension, so the simpler scheme is adequate.

3. **Form values use z.input<schema>, not z.infer<schema>** — HTML5 datetime-local inputs bind to strings, not Dates. Using the schema's INPUT shape (string-or-Date for dates) keeps the RHF + Zod + React harmony intact; the .transform() in the schema coerces on parse. Server Action receives proper Date values via the schema parse.

4. **Orphan deletion is best-effort (no withTenant guard)** — `removeObject` runs on the singleton MinIO client. Cross-tenant key access is already gated by the bucket prefix (`plantas/{eventId}/...`) AND the RLS check that runs before the delete (`getEventByIdInTenant` returns null cross-tenant, so the confirm path that triggers delete cannot reach across tenants). Production MinIO Lifecycle policies sweep any leaked orphans as a backstop.

5. **Detail page mints its own planta GET URL** — the events list mints per-row, but the detail page also needs a higher-quality preview. Both call `mintPresignedGet` independently (TTL 900s each) — small redundancy that keeps each page self-contained. If the perf budget tightens later, a route-level cache (revalidate=300) collapses the redundancy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type drift] React Hook Form + Zod resolver mismatch on Date-coerced fields**
- **Found during:** Task 1 typecheck after wiring zodResolver(eventCreateSchema) to useForm
- **Issue:** The schema's INPUT type uses `string | Date` for date fields (so HTML5 datetime-local strings parse), but the OUTPUT type uses `Date`. RHF's `useForm<T>` expects ONE type; using EventCreateInput (output) made the resolver/control types incompatible because RHF sees the field as `Date` but the form internally holds strings during typing.
- **Fix:** Switched to `z.input<typeof eventCreateSchema>` for the form values type, kept the resolver but cast it via `as any` with a biome-ignore comment because the resolver's generic does the coercion correctly at runtime but TS can't unify the input/output generics.
- **Files modified:** `src/components/eventos/event-form.tsx`
- **Verification:** `pnpm tsc --noEmit && pnpm lint && pnpm test` all green.
- **Committed in:** `76c5de5` (Task 1 commit)

**2. [Rule 2 - Missing API surface] removeObject was not in MinIOClientLike**
- **Found during:** Task 2 (writing confirmEventPlantaUpload — the orphan-delete path needs to call removeObject)
- **Issue:** Plan 01-01's MinIOClientLike only exposed presignedPutObject, presignedGetObject, putObject, statObject, makeBucket, bucketExists. The Task 2 plan calls for an orphan-delete on content-type mismatch — this requires `removeObject(bucket, key)`. Adding it is essential to the security contract (orphan reaper).
- **Fix:** Added `removeObject(bucket, key): Promise<void>` to MinIOClientLike (production client gets it free from minio-js v8); added the matching method to MockMinIOClient + InMemoryMinIO (deletes the key from the in-memory bucket map).
- **Files modified:** `src/lib/storage/minio.ts`, `src/test/minio-test.ts`
- **Verification:** Test case 2 of planta-upload.test.ts asserts the orphan is removed from `__debug_listBucket`.
- **Committed in:** `85d2717` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 type drift, 1 missing API surface).
**Impact on plan:** Both auto-fixes were essential to the plan as written; neither introduces scope creep — they harden the contract the plan already mandates.

## Issues Encountered

- **None blocking.** The retry-from-clean was successful: no residual state from the discarded WIP, all files created fresh, all tests passed on first run after typecheck/lint fixes.
- **Pre-commit `gitleaks` warning is benign** — local binary not installed; CI enforces the gate. Same pattern as Plan 01-01.

## User Setup Required

None for local development.

For production (Coolify) — same as Plan 01-01:
- Run `bash scripts/db/setup-roles.sh` once to ensure `fb_eventos_sysreader` exists.
- Run `bash scripts/minio/setup-buckets.sh --tenant trindade` (or per-tenant) once to provision the bucket with Lifecycle + CORS + anonymous-deny.
- Configure `MINIO_PUBLIC_ENDPOINT` so pre-signed URLs use the browser-facing hostname (different from MINIO_ENDPOINT inside Coolify networking).

## Next Phase Readiness

This plan delivers ORG-01 + ORG-02. The events table is now the authoritative anchor that Phase 1 Plans 03-08 hang off:

- **01-03 (Konva editor + lots):** can attach lots to `events.id`; reuses the `plantas/{eventId}/...` keyspace for editor background.
- **01-04 (fornecedores):** vendor records have no event coupling yet, but vendor_applications.event_id will reference events created here.
- **01-05 / 06 / 07 / 08:** all downstream business flows (contracts, payments, dashboards) anchor on event_id.

The pure-helper / thin-action split is now established as a Phase 1 pattern — every subsequent Server Action should follow it for consistent RLS contract testing.

## Self-Check: PASSED

All 11 claimed files present on disk. All 2 task commits present in git history.

- Task 1 (76c5de5): 9 files (3 pages + 3 components + 1 validator + 1 action + 1 test)
- Task 2 (85d2717): 5 files (1 action + 1 test + planta-uploader.tsx full impl + 2 mock additions)

All 78 tests pass (68 Phase 0 + 10 Phase 1-02). `pnpm tsc --noEmit`, `pnpm lint`, `pnpm check:all` all green.

---
*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Completed: 2026-06-13*
