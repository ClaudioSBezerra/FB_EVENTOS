// FB_EVENTOS — email.send-status-update task tests
// (Phase 1, Plan 01-08 — ORG-17).
//
// Seven assertions covering the full vendor + organizadora notification
// matrix plus the load-bearing RLS-no-worker contract:
//
//   1. signup_fornecedor → 1 send to vendor.email
//   2. aprovacao_fornecedor → 1 send to vendor.email
//   3. rejecao_fornecedor → 1 send + reason embedded
//   4. contrato_assinado → 2 sends (vendor + organizadora user)
//   5. pagamento_recebido → 2 sends (vendor + organizadora user)
//   6. RLS-no-worker — handler called without proper tenant context (we
//      simulate by passing a bogus tenant_id that has no matching tenant
//      row) → throws — proving silent no-op is impossible.
//   7. recordAudit captures every send (audit_log row count grows).
//
// The handler under test is INVOKED DIRECTLY (no graphile-worker run loop)
// because Plan 01-04 already pinned the enqueue-contract via
// tests/fornecedores/notifications.test.ts. This file is the rendering /
// delivery side of the contract.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import {
  type EmailSendStatusUpdatePayload,
  emailSendStatusUpdate,
} from '@/jobs/tasks/email-send-status-update'
import { __emails, sendEmail as _unused_sendEmail } from '@/lib/email'
import { appPool, createTenant, insertOrganization, insertUser, migratorPool } from '@/test/db'
import { setupExternalMocks } from '@/test/external-mocks'
import { makeContract } from '@/test/factories/contract-factory'
import { makeEvent } from '@/test/factories/event-factory'
import { makeLotCategory } from '@/test/factories/lot-category-factory'
import { makeLot } from '@/test/factories/lot-factory'
import { makeVendor } from '@/test/factories/vendor-factory'

// keep static import for type-graph; sendEmail is used implicitly via the
// task — we only read back via __emails.
void _unused_sendEmail

const mocks = setupExternalMocks()

beforeAll(() => {
  mocks.listen()
})

afterAll(async () => {
  mocks.close()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

beforeEach(() => {
  mocks.resetHandlers()
  __emails.reset()
})

afterEach(async () => {
  // audit_log is FORCE RLS even for the migrator role owner — DELETE
  // requires tenant context. For test cleanup we drop the policy briefly,
  // then re-enable. Simpler: leak rows across tests; the count probes use
  // per-test tenant UUIDs so the per-tenant counts stay deterministic.
})

// Stub Graphile-Worker helpers shape — only `job.id` is read by the handler.
const stubHelpers = {
  job: { id: 1, task_identifier: 'email.send-status-update' },
  // biome-ignore lint/suspicious/noExplicitAny: minimal stub for handler under test
} as any

async function setupTenantWithVendor(slug: string, name: string) {
  const tenantId = await createTenant(slug, name)
  const userId = await insertUser(`actor-${slug}@example.test`, `Org Owner ${slug}`)
  // Organizadora user is the eventual recipient of the cross-recipient
  // events. We seed an organization row + membership so resolveRecipients
  // can find the owner.
  const orgId = await insertOrganization(tenantId, `${slug}-org`, `${name} Org`)
  await insertMember(tenantId, orgId, userId)
  const vendor = await makeVendor(tenantId, {
    legalName: `Vendor ${slug} LTDA`,
    email: `vendor-${slug}@example.test`,
    status: 'approved',
  })
  return { tenantId, userId, orgId, vendor }
}

async function insertMember(tenantId: string, orgId: string, userId: string): Promise<void> {
  // member is FORCE RLS so even migratorPool gets default-deny on write.
  // Same pattern as insertOrganization — appPool + SET LOCAL.
  await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    await tx`
      INSERT INTO member (organization_id, user_id, role, tenant_id, created_at)
      VALUES (${orgId}, ${userId}, 'owner', ${tenantId}, NOW())
    `
  })
}

async function setupFullContract(slug: string, name: string) {
  const ctx = await setupTenantWithVendor(slug, name)
  const event = await makeEvent(ctx.tenantId)
  const category = await makeLotCategory(ctx.tenantId, event.id)
  const lot = await makeLot(ctx.tenantId, event.id, category.id)
  const contract = await makeContract(ctx.tenantId, ctx.vendor.id, lot.id, event.id, {})
  return { ...ctx, event, lot, contract }
}

describe('email.send-status-update — render + dispatch (Plan 01-08 Task 1)', () => {
  test('signup_fornecedor: 1 email to vendor.email with the right template', async () => {
    const { tenantId, vendor } = await setupTenantWithVendor(
      `sig-${Date.now().toString(36)}`,
      'Festa de Trindade — Signup',
    )
    const payload: EmailSendStatusUpdatePayload = {
      tenant_id: tenantId,
      event: 'signup_fornecedor',
      vendor_id: vendor.id,
      legal_name: vendor.legalName,
      email: vendor.email,
    }
    await emailSendStatusUpdate(payload, stubHelpers)

    const list = __emails.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.to).toBe(vendor.email)
    expect(list[0]?.subject).toMatch(/Cadastro de fornecedor/i)
    expect(list[0]?.subject).toContain('Festa de Trindade — Signup')
  })

  test('aprovacao_fornecedor: 1 email to vendor.email with approval template', async () => {
    const { tenantId, vendor } = await setupTenantWithVendor(
      `apr-${Date.now().toString(36)}`,
      'Festa de Trindade — Approval',
    )
    await emailSendStatusUpdate(
      {
        tenant_id: tenantId,
        event: 'aprovacao_fornecedor',
        vendor_id: vendor.id,
        legal_name: vendor.legalName,
        email: vendor.email,
      },
      stubHelpers,
    )
    const list = __emails.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.to).toBe(vendor.email)
    expect(list[0]?.subject).toMatch(/aprovado/i)
  })

  test('rejecao_fornecedor: reason text appears in the body', async () => {
    const { tenantId, vendor } = await setupTenantWithVendor(
      `rej-${Date.now().toString(36)}`,
      'Festa de Trindade — Rejection',
    )
    const reason = 'CNPJ irregular junto à Receita Federal'
    await emailSendStatusUpdate(
      {
        tenant_id: tenantId,
        event: 'rejecao_fornecedor',
        vendor_id: vendor.id,
        legal_name: vendor.legalName,
        email: vendor.email,
        reason,
      },
      stubHelpers,
    )
    const list = __emails.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.to).toBe(vendor.email)
    // The HTML body carries the reason — sendEmail in test mode captures html.
    expect(list[0]?.html).toContain('Receita Federal')
  })

  test('contrato_assinado: 2 emails (vendor + organizadora user)', async () => {
    const { tenantId, contract, vendor, userId } = await setupFullContract(
      `cas-${Date.now().toString(36)}`,
      'Festa de Trindade — Signed',
    )
    void userId
    await emailSendStatusUpdate(
      {
        tenant_id: tenantId,
        event: 'contrato_assinado',
        contract_id: contract.id,
      },
      stubHelpers,
    )
    const list = __emails.list()
    expect(list).toHaveLength(2)
    const recipients = list.map((m) => m.to).sort()
    expect(recipients).toContain(vendor.email)
    expect(recipients.some((to) => to.startsWith('actor-'))).toBe(true)
  })

  test('pagamento_recebido: 2 emails (vendor + organizadora user)', async () => {
    const { tenantId, contract, vendor } = await setupFullContract(
      `pag-${Date.now().toString(36)}`,
      'Festa de Trindade — Paid',
    )
    // We need a payment row referencing the contract — payments has FORCE
    // RLS so use appPool + SET LOCAL.
    const paymentRows = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ id: string }>>`
        INSERT INTO payments (
          tenant_id, contract_id, gateway, amount_brl_cents, method, status
        ) VALUES (
          ${tenantId}, ${contract.id}, 'pagarme', 20000, 'pix', 'paid'
        ) RETURNING id
      `
    })
    const paymentId = paymentRows[0]?.id
    expect(paymentId).toBeDefined()

    await emailSendStatusUpdate(
      {
        tenant_id: tenantId,
        event: 'pagamento_recebido',
        payment_id: paymentId!,
        contract_id: contract.id,
      },
      stubHelpers,
    )
    const list = __emails.list()
    expect(list).toHaveLength(2)
    const recipients = list.map((m) => m.to).sort()
    expect(recipients).toContain(vendor.email)
  })

  test('handler with a non-existent tenant_id THROWS (RLS-no-worker contract)', async () => {
    // The handler resolves tenant first; a bogus uuid → tenant row not
    // found inside withTenant → throw. This is the worker-process safety
    // net documented in tests/jobs/worker-without-with-tenant.test.ts.
    // (Use a valid-format v4 UUID that almost certainly doesn't exist.)
    const fakeTenantId = 'deadbeef-1111-4222-8333-444455556666'
    await expect(
      emailSendStatusUpdate(
        {
          tenant_id: fakeTenantId,
          event: 'signup_fornecedor',
          email: 'who@example.test',
          legal_name: 'Who LTDA',
        },
        stubHelpers,
      ),
    ).rejects.toThrow(/tenant .* not found/)
  })

  test('audit_log row inserted per email send (LGPD-04 trace)', async () => {
    const { tenantId, vendor } = await setupTenantWithVendor(
      `aud-${Date.now().toString(36)}`,
      'Festa de Trindade — Audit',
    )
    const before = await countAuditEmailRows(tenantId)
    await emailSendStatusUpdate(
      {
        tenant_id: tenantId,
        event: 'aprovacao_fornecedor',
        vendor_id: vendor.id,
        legal_name: vendor.legalName,
        email: vendor.email,
      },
      stubHelpers,
    )
    const after = await countAuditEmailRows(tenantId)
    expect(after).toBe(before + 1)
    // Sanity: payload contains hashed email, NEVER raw PII.
    const rows = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ payload: Record<string, unknown> }>>`
        SELECT payload FROM audit_log
        WHERE action = 'email.sent' AND tenant_id = ${tenantId}::uuid
        ORDER BY created_at DESC LIMIT 1
      `
    })
    expect(rows[0]?.payload?.recipient_email_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]?.payload?.template).toBe('aprovacao_fornecedor')
    // Raw email MUST NOT appear in payload — only the hash.
    const payloadStr = JSON.stringify(rows[0]?.payload ?? {})
    expect(payloadStr).not.toContain(vendor.email)
  })
})

async function countAuditEmailRows(tenantId: string): Promise<number> {
  // audit_log is FORCE RLS even for the migrator owner — must set tenant
  // context to read. Use appPool + SET LOCAL (same shape as withTenant).
  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'email.sent' AND tenant_id = ${tenantId}::uuid
    `
  })
  return rows[0]?.n ?? 0
}
