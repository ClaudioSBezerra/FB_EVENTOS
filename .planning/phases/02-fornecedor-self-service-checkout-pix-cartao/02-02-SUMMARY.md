---
phase: 02-fornecedor-self-service-checkout-pix-cartao
plan: 02
type: execute
status: complete
completed: 2026-06-15
commits:
  - 53f5074 test(02-02): FORN-01 signup 5 RED tests (CNPJ, consents, D-22, LGPD)
  - 4dcea5b feat(02-02): FORN-01 signupFornecedorForTenant — D-21/22/23/24 implementation
  - 44f6120 test(02-02): FORN-02 marketplace listing 4 RED tests (RLS, cross-tenant, drafts)
  - d0e8c31 feat(02-02): FORN-02 listOpenEventsInTenant + getOpenEventByIdInTenant
  - 1eecdb8 feat(02-02): UI wiring — cadastro page, signup form, marketplace pages, event-card
requirements:
  - FORN-01
  - FORN-02
key-files:
  created:
    - src/lib/actions/signup-fornecedor.ts
    - src/lib/validators/signup-fornecedor.ts
    - src/lib/actions/marketplace.ts
    - src/app/[slug]/fornecedor/cadastro/page.tsx
    - src/app/[slug]/marketplace/page.tsx
    - src/app/[slug]/marketplace/[eventId]/page.tsx
    - src/components/fornecedor/signup-form.tsx
    - src/components/marketplace/event-card.tsx
  modified:
    - tests/fornecedor/signup.test.ts (it.todo scaffolds → 5 real tests)
    - tests/marketplace/list.test.ts (it.todo scaffolds → 4 real tests)
---

## What was built

End-to-end fornecedor onboarding doorway + marketplace discovery for Phase 2. After this plan, a real fornecedor can:

1. Visit `/{slug}/fornecedor/cadastro` (public — no session required)
2. Fill the form (CNPJ, legal/trade name, email, password, 3 LGPD consents)
3. Submit → become a Better Auth member of the tenant org + a `vendors` row with `status='pending'`, with 3 `vendor_consents` rows logged and a `signup_fornecedor` notification email enqueued
4. Visit `/{slug}/marketplace` (logged in) and see all of THIS tenant's published events (cross-tenant invisible per RLS)
5. Click an event → land on `/{slug}/marketplace/{eventId}` showing date range, place, capacity, and a "Ver planta" CTA (planta page itself lands in Plan 02-03)

**Backend (Tasks 1+2):**
- `signupFornecedorForTenant(input)` — pure helper resolves tenant by slug, calls `auth.api.addMember` on the tenant org (creating Better Auth user if needed), inserts `vendors` row inside `withTenant(tenant.id)`, calls `recordConsent` 3× (marketing/analytics/payment_data), enqueues `email.send-status-update` job with `event='signup_fornecedor'`. Pattern follows `payments.ts:404-414` `recordAuditOutOfBand` ordering — atomic business write inside the tenant transaction, side effects after.
- `signupFornecedor(slug, values)` — thin Server Action wrapper around the pure helper; validates with `signupFornecedorSchema`.
- `signupFornecedorSchema` — Zod schema; CNPJ via existing `cnpjSchema` from Phase 1 Plan 01-04; `payment_data` consent required via `z.literal(true)` per T-02-02-02.
- `listOpenEventsInTenant(db, tenantId)` — selects events WHERE `status='published'` AND `deleted_at IS NULL`, ordered by `starts_at ASC`. Pure helper called inside `withTenant` for FORCE-RLS-driven tenant scoping.
- `getOpenEventByIdInTenant(db, tenantId, eventId)` — single-event variant, returns `null` for drafts/soft-deleted/cross-tenant rows (RLS yields 0 rows for the last).

**UI (Task 1+2 wiring):**
- `cadastro/page.tsx` — public Server Component with tenant.name in header.
- `signup-form.tsx` — Client Component: react-hook-form + zodResolver, 3 LGPD checkboxes, reuses existing `CnpjInput` from `fornecedores/cnpj-input.tsx`, router.push to `/{slug}/portal` on success (portal lands in Plan 02-08).
- `marketplace/page.tsx` — Pattern S9 boilerplate: session → tenant resolve → activeOrg cross-tenant guard (T-02-02-03) → `withTenant` → renders `EventCard` grid (or empty-state, or 403).
- `marketplace/[eventId]/page.tsx` — event detail with "Ver planta" CTA + "Voltar".
- `event-card.tsx` — per-event card; date range via `Intl.DateTimeFormat('pt-BR')` (intentionally not date-fns since it's not in the lockfile — single-line dependency avoided).

## Tests added (9 new, both files turned from RED scaffolds to real assertions)

- `tests/fornecedor/signup.test.ts` (5): happy-path creates vendor+member+3 consents; cross-tenant invisibility; duplicate CNPJ same-tenant returns 409; same CNPJ on different tenants succeeds (D-22); LGPD consent records snapshot the consent_text + version
- `tests/marketplace/list.test.ts` (4): lists tenant's published events; cross-tenant invisible (RLS); drafts excluded; soft-deleted excluded

## Verification gate evidence

```
pnpm tsc --noEmit                                                 → exits 0
pnpm biome check --diagnostic-level=error src/                    → 0 errors
pnpm vitest run tests/fornecedor/signup.test.ts \
                tests/marketplace/list.test.ts                    → 9 passed
pnpm vitest run (full suite)                                      → 190 passed, 55 todo, 0 failed
```

Migration count unchanged (0001..0020 — no new schema this plan; just code wired into Plan 02-01's tables).

## Notable deviations

**Spawn-cap recovery (2nd time this phase).** Executor agent hit the "session limit · resets 1:10pm America/Recife" after ~51 minutes and 226 tool calls. Pattern per `MEMORY.md → Recovery pattern`:

- 4 commits landed on the worktree before cap (test+impl for FORN-01, test+impl for FORN-02 — backend complete with 9 green tests).
- The UI files (5: cadastro page, signup form, marketplace 2 pages, event-card) were on disk but uncommitted.
- The `event-card.tsx` was missing entirely — the marketplace page imported it.
- The orchestrator authored the missing `event-card.tsx` inline (using `Intl.DateTimeFormat` instead of date-fns since date-fns is not in the lockfile despite the CLAUDE.md stack table claim), ran biome --write to fix formatting, then committed the 5-file UI wiring as commit 1eecdb8.

**Worktree node_modules.** This run discovered that Claude Code's `isolation="worktree"` does NOT auto-populate `node_modules/` — the pre-commit hook (`pnpm biome check ...`) fails until the orchestrator symlinks the main checkout's `node_modules` into the worktree. The previous Plan 02-01 worktree apparently happened to have its own packages installed; this one did not. Worth automating a `ln -sfn ../../../node_modules node_modules` step in the executor agent prompt OR fixing the hook to traverse upward. Filed mentally as a follow-up TODO.

## Self-Check

- [x] All 2 tasks executed (backend via TDD RED/GREEN; UI wired inline by orchestrator)
- [x] Each task committed individually (5 commits total: 2 RED, 2 GREEN, 1 UI)
- [x] `tsc --noEmit` exits 0
- [x] `biome check` exits 0 (after orchestrator ran --write to fix imports/formatting)
- [x] Full vitest run: 190 passed + 55 todo, 0 failed
- [x] FORN-01 + FORN-02 covered (verified by passing test files mapping 1:1 to VALIDATION.md rows)
- [x] STATE.md / ROADMAP.md untouched (orchestrator owns those writes post-merge)
