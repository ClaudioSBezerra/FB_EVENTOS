---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 02
type: execute
wave: 2
depends_on:
  - "01-01"
autonomous: true
requirements:
  - ORG-01
  - ORG-02
requirements_addressed:
  - ORG-01
  - ORG-02
tags:
  - events
  - planta
  - minio
  - pre-signed-put
  - vertical-slice
must_haves:
  truths:
    - "Organizadora can create an event via /[slug]/eventos/novo form with name, dates, place, capacity, timezone (default America/Sao_Paulo), currency (default BRL) — all fields validated by Zod"
    - "Organizadora can upload a planta (PDF/PNG/JPG, ≤25 MB) via pre-signed PUT direct browser → MinIO; Server Action mints URL with content-type lock + size cap + TTL 5min"
    - "After upload, Server Action verifies the object via statObject (content-type matches, size ≤ 25 MB) and stores minio_key on events.planta_minio_key"
    - "Events list at /[slug]/eventos shows all tenant events with planta thumbnail (pre-signed GET TTL 15min); tenant isolation proven by integration test"
    - "Vertical slice complete: organizadora signs up → picks active org → creates event → uploads planta → sees event in list with planta thumbnail"
files_modified:
  - src/app/[slug]/eventos/page.tsx
  - src/app/[slug]/eventos/novo/page.tsx
  - src/app/[slug]/eventos/[eventId]/page.tsx
  - src/components/eventos/event-form.tsx
  - src/components/eventos/event-list.tsx
  - src/components/eventos/planta-uploader.tsx
  - src/lib/actions/eventos.ts
  - src/lib/actions/minio-presign.ts
  - src/lib/validators/event.ts
  - tests/eventos/event-crud.test.ts
  - tests/eventos/planta-upload.test.ts
---

<objective>
Vertical slice 1 of Phase 1. End-to-end: organizadora visits `/[slug]/eventos`, fills the event form (name + dates + place + capacity + timezone + BRL), uploads the planta via pre-signed PUT direct browser→MinIO, and sees the event appear in the list with a planta thumbnail. Delivers ORG-01 (event CRUD scoped to tenant) and ORG-02 (planta upload to MinIO).
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md (D-04, D-05, D-06 MinIO; D-13 tenant_trindade seed)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §MinIO Pre-signed Upload + §Pitfalls (CORS; public vs internal endpoint; statObject verification)
- src/db/schema/events.ts (Plan 01-01 created this)
- src/lib/storage/minio.ts (Plan 01-01 created the server wrapper)
- src/lib/actions/safe-action.ts (withTenantAction chain)
- src/app/[slug]/dashboard/page.tsx (Phase 0 pattern for tenant-scoped page)
- src/components/ui/{form,input,label,button,card}.tsx (existing shadcn primitives)
</files_to_read>

<task id="1" name="Event schema validator + Server Action CRUD + form">
<action>
Create `src/lib/validators/event.ts` with Zod schemas:
- `eventCreateSchema` — name (1..120 chars), starts_at (ISO datetime, future or today), ends_at (must be > starts_at), place_name (1..200), place_address (PII; 1..400), capacity (int 1..1_000_000), timezone (IANA string default 'America/Sao_Paulo'), currency (default 'BRL', enum: BRL only Phase 1)
- `eventUpdateSchema` — same but all fields optional; id required
- `eventIdSchema` — uuid

Create `src/lib/actions/eventos.ts` with three `withTenantAction`:
- `createEvent(input)` — Zod parse → INSERT into events → recordAudit('event.created', {event_id}) → returns the persisted row
- `updateEvent(input)` — Zod parse → UPDATE events SET ... WHERE id = ? → recordAudit('event.updated', {event_id, changes}) → return updated row
- `listEvents()` — SELECT * FROM events WHERE deleted_at IS NULL ORDER BY starts_at DESC; if planta_minio_key is set, generate pre-signed GET (TTL 900s) for each row's `planta_url`

Create `src/components/eventos/event-form.tsx` — React Hook Form + zodResolver(eventCreateSchema or eventUpdateSchema); fields rendered with shadcn primitives; submit calls Server Action.

Create `src/components/eventos/event-list.tsx` — Server Component that calls listEvents() inside withTenant context; renders shadcn Card per event with name, dates, place, capacity, and planta thumbnail (if planta_url available).

Create pages `src/app/[slug]/eventos/page.tsx` (list view), `src/app/[slug]/eventos/novo/page.tsx` (create form), `src/app/[slug]/eventos/[eventId]/page.tsx` (detail + edit). All wrap their data fetching in `withTenant(tenantId, ...)`.

Write `tests/eventos/event-crud.test.ts` (Vitest) — at least 5 cases:
1. createEvent inside tenant A creates row; listEvents in tenant A returns it
2. createEvent in tenant A; listEvents in tenant B returns 0 rows (RLS proof)
3. updateEvent on tenant A's event with tenant B context fails (RLS)
4. createEvent with starts_at > ends_at fails Zod
5. createEvent records audit_log row with action='event.created'

Commit: `feat(01-02): event CRUD with tenant-scoped Server Actions + RHF form + audit trail`
</action>
<read_first>
- src/db/schema/events.ts (Plan 01-01)
- src/lib/actions/safe-action.ts (withTenantAction usage)
- src/lib/audit.ts (recordAudit signature)
- src/test/factories/event-factory.ts (Plan 01-01 — use this in tests)
- src/components/auth/signup-form.tsx (Phase 0 RHF + zodResolver example)
</read_first>
<acceptance_criteria>
- `pnpm test tests/eventos/event-crud.test.ts` → 5 tests pass
- `grep "withTenantAction" src/lib/actions/eventos.ts` → 3 matches (createEvent, updateEvent, listEvents)
- `grep "recordAudit" src/lib/actions/eventos.ts` → ≥ 2 matches
- `pnpm tsc --noEmit && pnpm lint` exit 0
- Manual smoke: starting `pnpm dev`, navigate `/trindade/eventos/novo`, fill form, submit; row appears in `/trindade/eventos`
- All Phase 0 tests still pass
</acceptance_criteria>
</task>

<task id="2" name="Planta upload — pre-signed PUT Server Action + browser uploader + statObject verification">
<action>
Create `src/lib/actions/minio-presign.ts` — Server Action `mintEventPlantaUploadUrl(input)`:
1. Zod-validate input: `{ eventId: uuid, fileName: string, contentType: enum('application/pdf','image/png','image/jpeg'), sizeBytes: int ≤ 26_214_400 }`
2. Inside `withTenant`: verify the event belongs to current tenant (SELECT id FROM events WHERE id = ? — RLS does the tenant check)
3. Compute `key = \`plantas/${eventId}/${cryptoRandom(16)}-${sanitize(fileName)}\``
4. Call `mintPresignedPut(tenantSlug, key, contentType, sizeBytes, 300)` — TTL 5 min
5. Return `{ url, key, expiresAt }`

Create `mintEventPlantaDownloadUrl(input)` — input `{ eventId }`, returns `{ url, expiresAt }` for pre-signed GET TTL 900s. Tenant scope via RLS.

Create `confirmEventPlantaUpload(input)` — input `{ eventId, key }`:
1. Call `getMinIOClient().statObject(bucket, key)` → assert content-type matches the original PUT lock + size ≤ 25 MB. If mismatch, delete the object and throw.
2. UPDATE events SET planta_minio_key = ? WHERE id = ? (RLS enforces tenant)
3. recordAudit('event.planta_uploaded', {event_id, key, size, content_type})

Create `src/components/eventos/planta-uploader.tsx` — client component:
1. File input accepts PDF/PNG/JPG
2. On select: client-side checks file size ≤ 25 MB + extension match
3. Call `mintEventPlantaUploadUrl` → receive URL
4. `fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })`
5. On 200: call `confirmEventPlantaUpload({eventId, key})`
6. Show progress + success/failure UI

Update `src/components/eventos/event-form.tsx` (edit mode) to include the PlantaUploader after the event is saved.

Write `tests/eventos/planta-upload.test.ts` — at least 5 cases:
1. mintEventPlantaUploadUrl returns a valid pre-signed URL with the right bucket prefix
2. confirmEventPlantaUpload fails when statObject content-type mismatches the originally locked type (and deletes the orphan object)
3. confirmEventPlantaUpload fails when size > 25 MB (using the mock minio-test harness to seed a too-large stub)
4. confirmEventPlantaUpload on success updates events.planta_minio_key
5. Tenant B cannot confirm tenant A's event upload (RLS — minBrute tenant cross test)

Commit: `feat(01-02): planta upload via pre-signed PUT + statObject verification + audit`
</action>
<read_first>
- src/lib/storage/minio.ts (Plan 01-01 — mintPresignedPut signature)
- src/test/minio-test.ts (Plan 01-01 — mock harness for tests)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Pre-signed PUT pitfalls (CORS, content-type lock, statObject mandatory)
</read_first>
<acceptance_criteria>
- `pnpm test tests/eventos/planta-upload.test.ts` → 5 tests pass
- Manual smoke: `pnpm dev`, create event, upload a PDF planta (≤ 25 MB), reload /[slug]/eventos → thumbnail visible
- Upload a file > 25 MB → client blocks before PUT; even if browser dev tools bypass the check, statObject + size assertion in confirmEventPlantaUpload deletes the object and the events.planta_minio_key remains null
- Upload a `.exe` renamed `.pdf` → confirmEventPlantaUpload rejects on content-type mismatch
- `pnpm tsc --noEmit && pnpm lint` exit 0
- Audit log has rows action='event.planta_uploaded' after a successful upload
</acceptance_criteria>
</task>

<verification>
After both tasks:
- Run `pnpm test --run` → all tests pass (Phase 0 + new 10 tests for Plan 01-02)
- Run `pnpm test:e2e tests/e2e/walking-skeleton.spec.ts` if the Phase 0 baseline still applies (will be extended in 01-08)
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
- Manual: end-to-end smoke (signup organizadora → set active org → create event → upload planta → see event card with thumbnail)

This plan delivers ORG-01 + ORG-02. Plans 01-03 (Konva editor + lots) and 01-04 (fornecedores) build on the events table created here.
</verification>
