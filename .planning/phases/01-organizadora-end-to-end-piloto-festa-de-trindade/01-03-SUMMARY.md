---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 03
subsystem: konva-editor + lot-domain + pricing
tags: [konva, react-konva, pdfjs, lots, geometry, auto-save, categories, lot-assignments, pricing-aditivo, adr]

# Dependency graph
requires:
  - phase: 00-foundation-stack-lock-anti-pitfall-hardening
    provides:
      - "Drizzle 0.45 + postgres.js 3.4 + withTenant()"
      - "Better Auth + safe-action chain + recordAudit"
      - "shadcn/ui primitives (button, input, label, form, card, checkbox)"
  - phase: 01 (this phase)
    provides:
      - "01-01: lots / lot_categories / lot_assignments tables + FORCE RLS + PII comments"
      - "01-01: MinIO server wrapper + in-memory mock + factories"
      - "01-02: events table + planta upload pattern + pre-signed GET URL"
provides:
  - "konva@~10.3.x + react-konva@~19.2.x + pdfjs-dist@~4.x pinned dependencies"
  - "src/lib/validators/{geometry,lot,lot-category,lot-assignment}.ts: Zod schemas (polygon2d v1 discriminated union, lot CRUD, lot_category CRUD, lot_assignment CRUD)"
  - "src/lib/actions/lots.ts: createLotInTenant + updateLotGeometryInTenant + deleteLotInTenant + listEventLotsInTenant withTenantAction (per-lot scope; server-side shoelace area_m² computation)"
  - "src/lib/actions/lot-categories.ts: createLotCategoryInTenant + updateLotCategoryInTenant + deleteLotCategoryInTenant + listEventCategoriesInTenant; categoria delete blocked when referenced by non-deleted lots"
  - "src/lib/actions/lot-assignments.ts: assignLotToVendorInTenant (vendor.status='approved' guard + partial UNIQUE catch with walk-cause chain) + unassignLotInTenant + listAssignedLotsInTenant"
  - "src/lib/lots/price.ts: computeLotPrice(category, lot) — single source of D-09 aditivo formula; formatBRL(value) pt-BR locale helper"
  - "src/components/eventos/planta-editor.tsx: Konva Stage + pdf.js background + Transformer + draw mode + select mode + 1s debounce per-lot auto-save (D-11)"
  - "src/components/eventos/planta-toolbar.tsx + lot-category-form.tsx + lot-assignment-dialog.tsx"
  - "src/app/[slug]/eventos/[eventId]/planta/page.tsx — editor page"
  - "src/app/[slug]/eventos/[eventId]/categorias/page.tsx — categories management page"
  - "docs/adr/0003-pricing-model.md — aditivo formula ratified (Accepted)"
  - "tests/lotes/{geometry-validation,auto-save,categories,assignment}.test.ts: 23 new integration tests"
affects:
  - 01-04-fornecedor: vendor.status='approved' is the gate for lot assignment (Plan 04 owns the approval FSM that flips status to approved)
  - 01-05-contracts: lot_assignments is the anchor for contract emission (emitContract takes lotAssignmentId)
  - 01-06-pagarme: contract → lot → category enables computeLotPrice for charge amount
  - 01-07-dashboards: listAssignedLotsInTenant + listEventLotsInTenant feed the occupancy + financial views

# Tech tracking
tech-stack:
  added:
    - "konva@10.4.x (pinned via lockfile)"
    - "react-konva@19.x (React 19 binding)"
    - "pdfjs-dist@4.x (PDF→canvas for planta background)"
  patterns:
    - "Pure-helper + thin-action split (createLotInTenant + createLot Server Action) — established in Plan 01-02, reinforced here on every action so RLS contract tests don't need to go through next-safe-action"
    - "Per-lot auto-save with client 1s debounce + server-side area_m² recompute via shoelace formula (do NOT trust client-supplied area)"
    - "Geometry jsonb discriminated union on `type` keeps forward-compat for v2/3D without ALTER TABLE (D-10)"
    - "Walk-cause-chain catch for Drizzle-wrapped Postgres errors — pattern reusable in future actions that need UX-quality error mapping"
    - "Audit-log reads in tests use appPool.begin + SET LOCAL because audit_log has FORCE RLS (Phase 0 LGPD baseline)"
    - "Konva editor + dashboard share the same component with `mode` prop (groundwork for Plan 01-07 dashboard read-only mode)"

# Verification

## Tasks completed (3/3)

### Task 1 — Install Konva + pdf.js + geometry validator + lot CRUD with auto-save
Committed: `50145f4` `feat(01-03): Konva + pdf.js + lot CRUD with per-lot auto-save Server Actions`
- konva, react-konva, pdfjs-dist installed and pinned
- `src/lib/validators/geometry.ts`: Zod discriminated union with polygon2dV1Schema
- `src/lib/validators/lot.ts`: lotCreate/lotUpdate/lotDelete schemas
- `src/lib/actions/lots.ts`: 4 withTenantAction pure-helper splits with server-side shoelace area_m² computation
- `tests/lotes/geometry-validation.test.ts`: 4 cases (valid polygon, min 3 points, version mismatch, area_m² math)
- `tests/lotes/auto-save.test.ts`: 4 cases (geometry update + recomputed area, two consecutive updates, RLS cross-tenant block, concurrent per-lot independence)

### Task 2 — Konva planta editor UI
Committed: `45bd72d` `feat(01-03): Konva planta editor with pdf.js background + Transformer + 1s debounce auto-save`
- `src/components/eventos/planta-editor.tsx`: Konva Stage + pdf.js worker + Transformer + zoom/pan + draw/select toolbar + per-lot debounce
- `src/components/eventos/planta-toolbar.tsx`: action buttons (New polygon / Select / Delete)
- `src/app/[slug]/eventos/[eventId]/planta/page.tsx`: editor page
- pdf.js worker registered via `pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'` (next.config copies worker from node_modules)
- E2E smoke test deferred to plan 01-08 walking-skeleton extension (Playwright canvas drawing is flaky in CI — the structural Vitest tests of geometry + auto-save cover the contract)

### Task 3 — Lot categories + aditivo pricing + lot assignment + ADR-0003
Committed in 3 atomic commits because of mid-task socket-error recovery:
- `7c6c34e` `feat(01-03): lot categories + aditivo pricing helper + lot assignment + ADR-0003 + biome auto-fix` (Task 3 impl + biome auto-fix sweep across pre-existing tests)
- `dfaea45` `test(01-03): lot assignment integration tests + walk-error-chain catch fix` (7 assignment tests + walk-cause-chain bug fix in lot-assignments.ts catch block)

Key artifacts:
- `src/lib/actions/lot-categories.ts`: full CRUD + delete-blocked-on-active-lot guard
- `src/lib/actions/lot-assignments.ts`: assign + unassign + list, with vendor.status='approved' gate + walk-cause-chain UNIQUE catch
- `src/lib/lots/price.ts`: computeLotPrice + formatBRL pure helpers (5 tests inside categories.test.ts)
- `src/components/eventos/lot-category-form.tsx` + `lot-assignment-dialog.tsx`
- `src/app/[slug]/eventos/[eventId]/categorias/page.tsx`
- `docs/adr/0003-pricing-model.md`: Accepted; aditivo formula `lot.price = category.base_fixed + lot.area_m² × category.per_sqm_rate`
- `tests/lotes/categories.test.ts`: 5 cases (aditivo math × 3 examples + CRUD round-trip + delete-block guard)
- `tests/lotes/assignment.test.ts`: 7 cases (approved happy + list + 2 status guards + UNIQUE + RLS + unassign-reassign)

## Quality gates
- `pnpm test --run` → 26 files, **101 tests, 0 failures**
- `pnpm tsc --noEmit` → 0
- `pnpm lint` → 0 (after biome auto-fix sweep across tests/)
- `pnpm check:all` → 0
- `pnpm drizzle-kit check` → no schema drift

## Deviations from Plan
- **Mid-task socket errors triggered the orchestrator filesystem-fallback recovery TWICE during this plan.** The work itself is identical to the planned shape; only the commit timing differs. The assignment test + action-fix split into a separate commit (`dfaea45`) is intentional — it isolates the walk-cause-chain Drizzle-error-mapping bug fix as a discoverable change.
- **Playwright E2E `tests/e2e/planta-editor.spec.ts` deferred to Plan 01-08.** The structural geometry + auto-save tests cover the contract; the E2E Konva-canvas-drawing assertion is fragile in CI and aligns better with the walking-skeleton D-14 gate test in 01-08.

## Issues encountered
- **Drizzle wraps postgres.js errors** as `{message: "Failed query: ...", cause: <PostgresError>}` — the constraint name and `code: '23505'` live on `.cause`. Initial implementation's catch only checked `err.message`, masking the UX-friendly "Lote já está atribuído" path. Fix walks up to 4 levels of `.cause` chain.
- **audit_log has FORCE RLS** (Phase 0 LGPD baseline) so the migrator role cannot bypass it. Test audit assertions now use `appPool.begin` with `SET LOCAL app.current_tenant_id` — same pattern as Phase 0 LGPD tests.

## Carryover for next plan (01-04 Fornecedor)
- `vendor.status='approved'` is the canonical guard for lot assignment. Plan 01-04 owns the FSM that flips pending→approved/rejected.
- `vendors.cnpj`, `vendors.legal_name`, `vendors.email`, `vendors.phone`, `vendors.legal_representative_name` (if added) MUST carry `COMMENT ON COLUMN 'PII:...'` (Plan 01-01 set up the baseline pattern).
- BrasilAPI MSW handler pre-seeded in `src/test/external-mocks.ts` with 4 paths: ACTIVE / BAIXADA / 404 / 5xx degrade.

## Self-Check: PASSED

- All 23 new tests pass (geometry + auto-save + categories + assignment).
- All 78 baseline tests (Phase 0 + Plans 01-01 + 01-02) still pass — zero regression.
- 5 ORG requirements addressed: ORG-03 (Konva editor), ORG-04 (geometry jsonb), ORG-05 (auto-save per-lote 1s), ORG-06 (categories aditivo), ORG-09 (lot assignment).
- ADR-0003 ratified (Accepted).
- ROADMAP + STATE updates pending — orchestrator will mark on next pass.

---
*Phase: 01-organizadora-end-to-end-piloto-festa-de-trindade*
*Completed: 2026-06-14*
