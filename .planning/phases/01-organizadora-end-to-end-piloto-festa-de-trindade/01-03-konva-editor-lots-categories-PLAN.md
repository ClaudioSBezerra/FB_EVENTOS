---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 03
type: execute
wave: 3
depends_on:
  - "01-02"
autonomous: true
requirements:
  - ORG-03
  - ORG-04
  - ORG-05
  - ORG-06
  - ORG-09
requirements_addressed:
  - ORG-03
  - ORG-04
  - ORG-05
  - ORG-06
  - ORG-09
tags:
  - konva
  - editor
  - lots
  - categories
  - jsonb
  - auto-save
  - adr
must_haves:
  truths:
    - "Konva editor at /[slug]/eventos/[eventId]/planta renders the planta image (PDF rendered to canvas via pdf.js OR raw PNG/JPG) as background layer and lets organizadora draw polygons (Konva.Line closed) as lots"
    - "Each lot persists geometry as jsonb {\"version\":1,\"type\":\"polygon2d\",\"points\":[[x,y]...],\"z_index\":N} validated by Zod; planner-mvp 3D upgrade path preserved (version:2/type:extrude3d coexists without ALTER TABLE)"
    - "Auto-save fires per-lote on debounce 1s via Server Action UPDATE lots SET geometry=? WHERE id=? inside withTenant — no whole-plant snapshots"
    - "Konva Transformer allows move/resize/delete; new-lot tool draws polygon click-by-click then closes"
    - "Lot categories CRUD with base_fixed (R$) + per_sqm_rate (R$/m²) — both NOT NULL DEFAULT 0; lot price computed as base_fixed + area_m² × per_sqm_rate (aditivo D-09); ADR-0003 documents the model"
    - "Lot assignment: organizadora picks a fornecedor (status='approved' from 01-04 — may be stub in this plan if 01-04 not yet merged; integration tests use vendor factory) and assigns to a lot; assignments stored in lot_assignments (UNIQUE on lot_id) with audit row"
files_modified:
  - src/app/[slug]/eventos/[eventId]/planta/page.tsx
  - src/app/[slug]/eventos/[eventId]/categorias/page.tsx
  - src/components/eventos/planta-editor.tsx
  - src/components/eventos/planta-toolbar.tsx
  - src/components/eventos/lot-category-form.tsx
  - src/components/eventos/lot-assignment-dialog.tsx
  - src/lib/actions/lots.ts
  - src/lib/actions/lot-categories.ts
  - src/lib/actions/lot-assignments.ts
  - src/lib/validators/geometry.ts
  - src/lib/validators/lot.ts
  - tests/lotes/geometry-validation.test.ts
  - tests/lotes/auto-save.test.ts
  - tests/lotes/categories.test.ts
  - tests/lotes/assignment.test.ts
  - tests/e2e/planta-editor.spec.ts
  - docs/adr/0003-pricing-model.md
  - package.json
  - pnpm-lock.yaml
---

<objective>
Vertical slice 2 of Phase 1. Organizadora opens the planta editor, draws polygons as lots, configures lot categories with the aditivo pricing model, and assigns lots to approved fornecedores. Auto-save persists geometry per-lot on every change with 1s debounce. Delivers ORG-03, ORG-04, ORG-05, ORG-06, ORG-09 + ADR-0003.
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md (D-09 aditivo pricing; D-10 jsonb shape; D-11 auto-save per-lot 1s)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Konva polygon2d shape + §Transformer pitfalls + §pdf.js render
- src/db/schema/lots.ts (Plan 01-01)
- src/lib/storage/minio.ts (for downloading planta image as Konva background)
- src/lib/actions/safe-action.ts
</files_to_read>

<task id="1" name="Install Konva + pdf.js + geometry validator + lot CRUD with auto-save">
<action>
Install: `pnpm add konva@~10.3.x react-konva@~19.2.x pdfjs-dist@~4.x`.

Create `src/lib/validators/geometry.ts` with Zod:
```ts
export const polygon2dV1Schema = z.object({
  version: z.literal(1),
  type: z.literal('polygon2d'),
  points: z.array(z.tuple([z.number(), z.number()])).min(3),
  z_index: z.number().int().default(0),
  extrude_height: z.number().optional() // forward-compat for v2 3D
})
export const geometrySchema = z.discriminatedUnion('type', [polygon2dV1Schema /* v2 added later */])
```

Create `src/lib/validators/lot.ts` — Zod schemas for lot create/update with code, area_m2 (computed from polygon area via shoelace formula on server before persist), category_id, geometry, status.

Create `src/lib/actions/lots.ts` with `withTenantAction`:
- `createLot({eventId, categoryId, geometry, code})` — Zod parse; compute area_m2 from polygon points (shoelace); INSERT; recordAudit
- `updateLotGeometry({lotId, geometry})` — Zod parse; recompute area_m2; UPDATE; recordAudit (NO audit on each debounce frame — only the final flush per task spec uses debounce on client; server still records every persisted update)
- `deleteLot({lotId})` — soft-delete (deleted_at) + recordAudit
- `listEventLots({eventId})` — RLS-scoped SELECT for the editor + dashboard

Write `tests/lotes/geometry-validation.test.ts`:
1. Valid polygon2d v1 (3+ points) passes
2. Polygon with 2 points fails (min 3)
3. Wrong version (v2 with v1 type) fails
4. Computed area_m2 matches expected for known rectangles + triangles

Write `tests/lotes/auto-save.test.ts`:
1. updateLotGeometry persists new geometry
2. Two consecutive updates produce two audit rows
3. Tenant B cannot update tenant A's lot (RLS)
4. Concurrent updates on different lots within same event don't conflict (per-lot scoping)

Commit: `feat(01-03): Konva + pdf.js + lot CRUD with per-lot auto-save Server Actions`
</action>
<read_first>
- src/db/schema/lots.ts (Plan 01-01 — geometry column constraint)
- src/test/factories/lot-factory.ts (Plan 01-01)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Konva (Line closed + Transformer + event delegation)
</read_first>
<acceptance_criteria>
- `pnpm test tests/lotes/geometry-validation.test.ts tests/lotes/auto-save.test.ts` → 8+ tests pass
- `pnpm tsc --noEmit && pnpm lint` exit 0
- `package.json` includes konva, react-konva, pdfjs-dist at the pinned versions
- area_m2 computation is unit-tested (shoelace) to within 0.01 m² for known polygons
</acceptance_criteria>
</task>

<task id="2" name="Planta editor UI — Konva canvas + transformer + toolbar + auto-save client">
<action>
Create `src/components/eventos/planta-editor.tsx` — client component (`'use client'`):
- Loads planta via pre-signed GET (mintEventPlantaDownloadUrl from 01-02)
- If PDF: use pdfjs-dist to render page 1 to an offscreen canvas, then feed the canvas to `<Konva.Image>` as background layer
- If PNG/JPG: load via `<img>` and feed to `<Konva.Image>`
- Konva.Stage with zoom/pan (mouse wheel zoom, drag stage with shift)
- Layer for lots: each lot renders as `<Konva.Line closed fill={category.color}+'40' stroke={'#000'} draggable />` with name label
- Toolbar (`src/components/eventos/planta-toolbar.tsx`): "New polygon" button enters draw mode (click points, double-click to close), "Select" mode shows Transformer on selected lot, "Delete" removes selected
- On any geometry mutation (drag end / transformer end / vertex add / delete): debounce 1s, then call updateLotGeometry Server Action
- Visual indicator of save state (idle / saving / saved / error)

Create page `src/app/[slug]/eventos/[eventId]/planta/page.tsx` — Server Component that loads the event + lots inside withTenant, passes them to PlantaEditor.

Write `tests/e2e/planta-editor.spec.ts` (Playwright):
- Navigate to `/trindade/eventos/{seedEventId}/planta`
- Assert canvas present, toolbar visible
- Click "New polygon" → click 4 points → double-click → polygon visible
- Drag the polygon → assert auto-save fires (intercept fetch to Server Action) within 1.5s
- Refresh page → polygon still present with new position

Commit: `feat(01-03): Konva planta editor with pdf.js background + Transformer + 1s debounce auto-save`
</action>
<read_first>
- src/components/eventos/planta-uploader.tsx (Plan 01-02 — pre-signed URL pattern reference)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Konva (event delegation, Transformer anchor pitfalls, zoom/pan)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §pdf.js (worker path + canvas rendering)
</read_first>
<acceptance_criteria>
- `pnpm test:e2e tests/e2e/planta-editor.spec.ts` passes
- Manual smoke: drawing 5 polygons + moving them works smoothly (≤100ms perceived latency)
- Auto-save indicator transitions idle→saving→saved within ~1.2s of last mutation
- Refresh restores all lots with the latest geometry
- `pnpm tsc --noEmit && pnpm lint` exit 0
</acceptance_criteria>
</task>

<task id="3" name="Lot categories + aditivo pricing + lot assignment + ADR-0003">
<action>
Create `src/lib/actions/lot-categories.ts` — withTenantAction CRUD on lot_categories (name, base_fixed numeric, per_sqm_rate numeric, color).

Create `src/lib/actions/lot-assignments.ts` — withTenantAction:
- `assignLotToVendor({lotId, vendorId})` — checks vendor.status='approved' (throws if not), INSERTs lot_assignments (UNIQUE on lot_id), recordAudit
- `unassignLot({lotId})` — soft-deletes assignment, recordAudit
- `listAssignedLots({eventId})` — for the dashboard 01-07

Create `src/components/eventos/lot-category-form.tsx` (RHF + zodResolver) and a category list page `/[slug]/eventos/[eventId]/categorias`.

Create `src/components/eventos/lot-assignment-dialog.tsx` — opens from PlantaEditor "Atribuir fornecedor" action on a selected lot; shows approved vendor picker (combobox); calls assignLotToVendor.

Add a `computeLotPrice(category, lot)` pure helper in `src/lib/lots/price.ts`:
```ts
export const computeLotPrice = (cat: LotCategory, lot: { area_m2: number }) =>
  Number(cat.base_fixed) + Number(lot.area_m2) * Number(cat.per_sqm_rate)
```
And unit-test it (`tests/lotes/categories.test.ts`):
1. base=0 + per_sqm=R$50/m² + area=4m² → R$200
2. base=R$1000 + per_sqm=0 → R$1000
3. base=R$500 + per_sqm=R$30 + area=10m² → R$800
4. Categories CRUD round-trip
5. Lot assignment requires vendor.status='approved' (uses vendor factory with explicit pending status → assertion throws)

Write `tests/lotes/assignment.test.ts`:
1. Assign approved vendor to lot succeeds + creates audit row
2. Assign pending vendor to lot rejects with descriptive error
3. Two assignments to same lot rejects (UNIQUE)
4. Tenant B cannot assign tenant A's lot (RLS)

Write `docs/adr/0003-pricing-model.md` ratifying the aditivo model:
- Decision: aditivo `lot.price = category.base_fixed + lot.area_m² × category.per_sqm_rate`
- Status: Accepted
- Context: CONTEXT.md D-09; alternatives considered: excludente, ad-hoc
- Consequences: simple math, both columns NOT NULL DEFAULT 0 allows fixed-only or per-sqm-only, schema migration-stable
- References: CONTEXT.md, RESEARCH.md §Pricing Model

Commit: `feat(01-03): lot categories + aditivo pricing + lot assignment + ADR-0003`
</action>
<read_first>
- src/db/schema/lots.ts (lot_categories + lot_assignments)
- src/test/factories/{vendor-factory,lot-factory}.ts (Plan 01-01)
- src/lib/audit.ts
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md D-09 (aditivo formula)
</read_first>
<acceptance_criteria>
- `pnpm test tests/lotes/categories.test.ts tests/lotes/assignment.test.ts` → 9+ tests pass
- `docs/adr/0003-pricing-model.md` exists with Accepted status
- Manual smoke: create category "Stand 4m²" (base R$200, per_sqm 0), draw lot, see price R$200 in lot detail panel
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
- All Phase 0 + Plans 01-01 + 01-02 tests still pass
</acceptance_criteria>
</task>

<verification>
After all 3 tasks: full test suite green; manual smoke from organizadora signup → event create → planta upload → draw 3 polygons → set categories → assign approved vendor to lot. Plan 01-04 (fornecedores) can be merged in parallel-logically because it depends only on 01-02 events schema, not on 01-03 lot-specific code.
</verification>
