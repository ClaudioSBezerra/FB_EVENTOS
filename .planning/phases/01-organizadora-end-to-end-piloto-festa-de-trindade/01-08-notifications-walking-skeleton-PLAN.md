---
phase: 01-organizadora-end-to-end-piloto-festa-de-trindade
plan: 08
type: execute
wave: 6
depends_on:
  - "01-05"
  - "01-06"
  - "01-07"
autonomous: false
requirements:
  - ORG-17
requirements_addressed:
  - ORG-17
tags:
  - resend
  - email
  - notifications
  - templates
  - walking-skeleton
  - e2e
  - d14-gate
must_haves:
  truths:
    - "6 pt-BR text-only Resend templates exist as TS modules: signup_fornecedor, aprovacao_fornecedor, rejeicao_fornecedor, contrato_emitido, contrato_assinado, pagamento_recebido — each returns {subject, text, html} with links absolute to https://eventos.fbtax.cloud"
    - "Graphile-Worker task 'email.send-status-update' processes the jobs enqueued from 01-04, 01-05, 01-06; resolves recipient email + name from tenant/vendor/contract context (RLS-no-worker via withTenant(payload.tenant_id))"
    - "Walking-skeleton E2E tests/e2e/walking-skeleton.spec.ts EXTENDED with the D-14 4-step gate: (1) signup organizadora + setActiveOrg, (2) create event + upload planta + draw 1 lot, (3) emit contract for assigned lot + sandbox sign both signers + verify status='signed', (4) create PIX charge + simulate sandbox payment + verify status='paid'. All 4 steps green = the phase ships"
    - "Test in sandbox mode by default; production env vars (PAGARME_ENV=production + ZAPSIGN_ENV=production) flip ONLY after the gate passes — documented in docs/RUNBOOK.md as the operator checklist"
    - "Email sends are observable via Resend dashboard (or mailpit in dev); audit_log captures every email send with template + recipient"
files_modified:
  - src/lib/email/templates/signup-fornecedor.ts
  - src/lib/email/templates/aprovacao-fornecedor.ts
  - src/lib/email/templates/rejeicao-fornecedor.ts
  - src/lib/email/templates/contrato-emitido.ts
  - src/lib/email/templates/contrato-assinado.ts
  - src/lib/email/templates/pagamento-recebido.ts
  - src/lib/email/templates/index.ts
  - src/jobs/tasks/email-send-status-update.ts
  - src/jobs/tasks/index.ts
  - tests/email/templates.test.ts
  - tests/email/send-status-update.test.ts
  - tests/e2e/walking-skeleton.spec.ts
  - tests/e2e/fixtures/d14-gate-fixtures.ts
  - docs/RUNBOOK.md
---

<objective>
Close Phase 1. Deliver ORG-17 (Resend notifications for 5 status events + 1 payment event) and extend the Phase 0 walking-skeleton E2E with the D-14 sandbox→production gate (4 steps that prove the entire vertical stack works). This is the proof artifact that makes the piloto Festa de Trindade ready to flip to production env vars.
</objective>

<files_to_read>
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md (D-14 gate definition; D-15 5 pt-BR templates)
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md §Resend pt-BR templates + §Walking-Skeleton extension
- .planning/phases/00-foundation-stack-lock-anti-pitfall-hardening/00-07-SUMMARY.md (existing walking-skeleton spec + fixtures)
- src/lib/email.ts (Phase 0 — sendEmail wrapper Resend/mailpit/in-memory)
- src/jobs/tasks/echo.ts (Phase 0 — task pattern)
- /home/claudio/.claude/projects/-home-claudio-projetos-FB-EVENTOS/memory/fb-eventos-domain.md (domain canonical: eventos.fbtax.cloud)
</files_to_read>

<task id="1" name="6 pt-BR Resend templates + email.send-status-update Graphile-Worker task">
<action>
Create 6 template files under `src/lib/email/templates/`:

```ts
// signup-fornecedor.ts
export const signupFornecedor = (data: { vendorName: string, tenantName: string, dashboardUrl: string }) => ({
  subject: `[${data.tenantName}] Cadastro de fornecedor recebido`,
  text: `Olá ${data.vendorName},\n\nRecebemos seu cadastro como fornecedor no ${data.tenantName}. Vamos analisar seus dados e retornar em breve.\n\nAcesse: ${data.dashboardUrl}\n\n— Equipe FB_EVENTOS`,
  html: undefined as string | undefined
})
```

Similar for:
- `aprovacao-fornecedor.ts` — "Você foi aprovado como fornecedor no [tenant]. Próximos passos: ..."
- `rejeicao-fornecedor.ts` — "Seu cadastro não foi aprovado. Motivo: [reason]. Você pode atualizar seus dados em: [link]"
- `contrato-emitido.ts` — "Um contrato foi emitido para você. Acesse o link do ZapSign para assinar: [link]"
- `contrato-assinado.ts` — "Todas as partes assinaram o contrato. Faça o download em: [link]" (sent to BOTH organizadora and fornecedor)
- `pagamento-recebido.ts` — "Recebemos o pagamento do contrato [reference]. Comprovante: [link]" (sent to BOTH organizadora and fornecedor)

All links use the canonical domain `https://eventos.fbtax.cloud/{slug}/...`. Strings in pt-BR formal-mas-humano per CONTEXT.md.

Create `src/lib/email/templates/index.ts` — registry: `{ signup_fornecedor: signupFornecedor, aprovacao_fornecedor: aprovacaoFornecedor, ... }`. Typed by union of event names.

Create `src/jobs/tasks/email-send-status-update.ts` — Graphile-Worker task:
- Payload: `{ tenant_id, event: 'signup_fornecedor' | 'aprovacao_fornecedor' | 'rejeicao_fornecedor' | 'contrato_emitido' | 'contrato_assinado' | 'pagamento_recebido', vendor_id?, contract_id?, payment_id?, reason? }`
- Wrap in `withTenant(payload.tenant_id, ...)`
- Resolve recipient(s) based on event:
  - signup/aprovacao/rejeicao → vendor.email (and tenant org email if signup)
  - contrato_emitido → vendor.email
  - contrato_assinado → vendor.email + organizadora user email
  - pagamento_recebido → vendor.email + organizadora user email
- Resolve template data (vendorName, tenantName, links to /{slug}/...)
- Call template function → get {subject, text, html?}
- Call sendEmail({to, from, subject, text, html, replyTo})
- recordAudit('email.sent', {template: event, recipient_email_hash, message_id})

Register the task in `src/jobs/tasks/index.ts`.

Write `tests/email/templates.test.ts`:
1. Each of 6 templates renders without error for a valid payload
2. Subject + text are non-empty pt-BR strings
3. All links use eventos.fbtax.cloud domain (regex assertion)
4. rejeicao-fornecedor template includes the reason text in the body

Write `tests/email/send-status-update.test.ts`:
1. signup_fornecedor event → sendEmail called once with vendor.email + correct template
2. aprovacao_fornecedor → vendor.email recipient + aprovacao template
3. rejeicao_fornecedor → vendor.email + reason included
4. contrato_assinado → 2 recipients (vendor + organizadora)
5. pagamento_recebido → 2 recipients
6. Worker without withTenant returns no vendor → throws (RLS-no-worker proof)
7. recordAudit captures every send

Commit: `feat(01-08): 6 pt-BR Resend templates + email.send-status-update task`
</action>
<read_first>
- src/lib/email.ts (Phase 0 — sendEmail signature)
- src/jobs/tasks/index.ts (registration pattern)
- src/db/with-tenant.ts
- .planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md D-15 (5 templates list — note: 6 here because pagamento_recebido is the 6th implicit from ORG-12)
</read_first>
<acceptance_criteria>
- `pnpm test tests/email/templates.test.ts tests/email/send-status-update.test.ts` → 11+ tests pass
- All template links match regex `https://eventos\.fbtax\.cloud/[^"\\s)]+`
- Manual: trigger an approval flow → mailpit (dev) shows the rendered email with valid subject + body
- `pnpm tsc -p tsconfig.worker.json --noEmit` exits 0 (worker-safe templates — no DOM)
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
</acceptance_criteria>
</task>

<task id="2" name="Walking-skeleton E2E extension — D-14 4-step gate" autonomous="false">
<action>
EXTEND the existing `tests/e2e/walking-skeleton.spec.ts` (created in Phase 0 Plan 00-07) with a new top-level test block `describe('D-14 gate — Phase 1 piloto Trindade', () => { ... })` containing 4 sequential test cases that must run in order:

**Step 1 — Signup organizadora + active org**
- Navigate to `/signup`
- Fill form with `organizadora-trindade@example.com` + LGPD consent
- Submit; navigate to `/verify-email` (Phase 0 in-memory transport)
- Click verify link → land on `/login`; login
- Create organization 'Festa de Trindade' (Better Auth org plugin form); slug='trindade'
- Call setActiveOrganization → assert session.tenant_id is now the trindade tenant
- Land on `/trindade/dashboard`; assert tenant name visible

**Step 2 — Create event + upload planta + draw 1 lot**
- Navigate `/trindade/eventos/novo`; submit event "Festa de Trindade 2026 — Piloto" with future dates
- Navigate to event detail; upload a fixture planta PDF (`tests/e2e/fixtures/planta-trindade-sample.pdf`, < 1 MB) — verify upload + statObject confirmation
- Create lot category "Stand 4m²" with base_fixed=R$200, per_sqm_rate=0
- Navigate to planta editor; draw a 4m² polygon; assert auto-save fires + DB has 1 lot
- Assign the lot to a fixture vendor (pre-seeded in `tests/e2e/fixtures/d14-gate-fixtures.ts` with status='approved')

**Step 3 — Emit contract + sandbox sign both signers**
- From the lot detail / assignment panel, click "Emitir contrato"
- Assert contracts row inserted with status='draft'; Graphile-Worker job runs (poll until task complete)
- Assert PDF generated + uploaded to MinIO (statObject check)
- Assert ZapSign sandbox call succeeded (MSW intercept OR sandbox API real call — use `ZAPSIGN_E2E_TOKEN` env var if present to hit sandbox; otherwise mock)
- Simulate ZapSign sandbox webhook: signed event for organizadora signer (order_group=1) → assert status='awaiting_fornecedor'
- Simulate ZapSign sandbox webhook: signed event for fornecedor signer (order_group=2) → assert status='signed' + signed_pdf_minio_key populated

**Step 4 — Create PIX charge + sandbox payment + verify paid**
- From contract detail (status='signed'), click "Criar cobrança PIX"
- Assert createCharge called Pagar.me sandbox; payments row inserted with status='pending'; PIX QR + copia-cola returned
- Simulate Pagar.me sandbox webhook: order.paid → re-fetch returns paid → assert payments.status='paid' + paid_at populated
- Assert pagamento_recebido email enqueued for both organizadora and fornecedor

Create `tests/e2e/fixtures/d14-gate-fixtures.ts` — pre-seeds a trindade tenant + approved vendor in the test DB before the spec runs; seeds the mailpit/in-memory transport; sets sandbox env vars; provides a sample planta PDF fixture.

Add to `playwright.config.ts` a new project `d14-gate` that uses sandbox env vars by default; the existing `walking-skeleton` project remains unchanged.

Update `docs/RUNBOOK.md` (Phase 0 created the file) with a new section "Phase 1 — D-14 Gate Sandbox→Production Flip":
- Pre-conditions: all 4 D-14 steps green in CI walking-skeleton run
- Operator checklist (numbered): (1) verify Resend production API key in Coolify env, (2) flip `PAGARME_ENV=production` + `PAGARME_SECRET_KEY=...`, (3) flip `ZAPSIGN_ENV=production` + `ZAPSIGN_TOKEN=...`, (4) run a single low-value smoke charge against the real Pagar.me production endpoint with a test card, (5) confirm rollback procedure (env var revert)
- Audit trail: this flip MUST land a manual audit_log row tagged 'd14_gate.production_flip' with operator identity + timestamp

**CHECKPOINT (autonomous=false):** Before considering this task complete, the executor MUST present the human operator with:
1. Snapshot of E2E test output (4/4 green)
2. The exact env var diff that would flip the staging container to production
3. Explicit "approve flip" confirmation
The operator approves; executor applies the flip; executor verifies a real smoke charge (low value) completes; THEN the task is done.

Commit: `feat(01-08): walking-skeleton D-14 gate extension + RUNBOOK operator checklist`
</action>
<read_first>
- tests/e2e/walking-skeleton.spec.ts (Phase 0 — existing structure to extend)
- tests/e2e/fixtures/two-tenants.ts (Phase 0 — existing fixture pattern)
- docs/RUNBOOK.md (Phase 0 — existing structure)
- playwright.config.ts (Phase 0 — project config to extend)
- All prior Phase 1 plans 01-02..01-07 (the spec exercises everything they built)
</read_first>
<acceptance_criteria>
- `pnpm test:e2e --project=d14-gate` → 4/4 tests pass (in sandbox mode)
- `pnpm test:e2e --project=walking-skeleton` → still passes (Phase 0 regression)
- `docs/RUNBOOK.md` has new "Phase 1 — D-14 Gate" section
- `tests/e2e/fixtures/d14-gate-fixtures.ts` seeds + tears down cleanly (no leftover trindade tenant after suite)
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` exit 0
- CHECKPOINT: operator approval received + production flip verified with real smoke charge (manual step; tracked in audit_log)
- All 17 ORG REQ-IDs now satisfied; Phase 1 done-done
</acceptance_criteria>
</task>

<verification>
After both tasks: 
- `pnpm test --run` all green (≈90+ tests including Phase 0 + all Phase 1)
- `pnpm test:e2e` both projects green
- `pnpm tsc --noEmit && pnpm lint && pnpm check:all` all green
- D-14 4-step gate green in sandbox = Phase 1 ready for production flip
- Operator approves flip via CHECKPOINT (autonomous=false)
- Real production smoke charge succeeds → Phase 1 CLOSED with VERIFICATION.md status='passed'

This plan is the proof artifact for Phase 1. Until 4/4 E2E steps are green in sandbox AND operator approves the flip, Phase 1 is NOT done.
</verification>
