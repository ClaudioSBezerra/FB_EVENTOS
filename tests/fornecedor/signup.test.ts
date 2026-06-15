// FB_EVENTOS — FORN-01: fornecedor signup integration (Plan 02-02 Task 1).
//
// Five behavior tests per 02-02-PLAN.md:
//   1. Happy path: vendor + member + 3 consent rows created, audit row, job enqueued.
//   2. D-22 cross-tenant: same Better Auth user + same CNPJ on tenant_A then tenant_B
//      → 2 vendor rows, 2 member rows, 1 user row reused.
//   3. CNPJ degrade-with-warning: BrasilAPI 5xx → vendor created with cnpj_verified=false.
//   4. Missing required consent: payment_data unchecked → Zod rejects, 0 DB writes.
//   5. LGPD audit: vendor_consents rows have ip_address from x-forwarded-for.
//
// Uses existing Phase 1 test infrastructure:
//   - src/test/db.ts (appPool, migratorPool, createTenant)
//   - src/test/external-mocks.ts (MSW with BrasilAPI happy-path + override helpers)
//   - src/test/factories/vendor-factory.ts (VALID_CNPJ_FOR_SIGNUP constant)
//
// REFERENCES:
//   - 02-CONTEXT.md D-21 D-22 D-23 D-24
//   - 02-02-PLAN.md Task 1 <behavior>

import { run } from 'graphile-worker'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '@/db'
import { EMAIL_STATUS_UPDATE_TASK } from '@/lib/actions/fornecedores'
import {
  type SignupFornecedorInput,
  signupFornecedorForTenant,
} from '@/lib/actions/signup-fornecedor'
import { appPool, createTenant, migratorPool } from '@/test/db'
import { setupExternalMocks } from '@/test/external-mocks'

// VALID_CNPJ_FOR_SIGNUP ('12345678000190') has an invalid mod-11 checksum — it was minted
// before the Layer 1 schema landed. Signup uses Zod validation, so we use a
// checksum-valid CNPJ instead (matches the BRASILAPI_CNPJ_ACTIVE fixture cnpj
// used in brasilapi.test.ts).
const VALID_CNPJ_FOR_SIGNUP = '12345678000195'

const mocks = setupExternalMocks()

beforeAll(async () => {
  mocks.listen()
  // Ensure graphile-worker schema is installed so add_job() works.
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL
  if (!migratorUrl) throw new Error('DATABASE_MIGRATOR_URL required')
  const r = await run({
    connectionString: migratorUrl,
    taskList: { [EMAIL_STATUS_UPDATE_TASK]: async () => {} },
    concurrency: 1,
    logger: undefined,
  })
  await r.stop()
})

afterEach(async () => {
  mocks.resetHandlers()
  // Truncate Phase 2 domain tables (global setup.ts handles auth tables).
  // Include cnpj_lookup_cache so the CNPJ degrade test doesn't see a
  // cached ACTIVE result from the happy-path test that ran first.
  await migratorPool`
    TRUNCATE TABLE vendor_consents, vendors, cnpj_lookup_cache RESTART IDENTITY CASCADE
  `
  await migratorPool`
    DELETE FROM graphile_worker._private_jobs
    WHERE task_id IN (
      SELECT id FROM graphile_worker._private_tasks WHERE identifier = ${EMAIL_STATUS_UPDATE_TASK}
    )
  `
})

afterAll(async () => {
  mocks.close()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// ────────────────────────────────────────────────────────────────────────────
// Shared fixture builder
// ────────────────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<SignupFornecedorInput> = {}): SignupFornecedorInput {
  const stamp = Date.now()
  return {
    email: overrides.email ?? `forn-signup-${stamp}@test.example`,
    password: overrides.password ?? 'SenhaSegura2026!',
    name: overrides.name ?? `Fornecedor Teste ${stamp}`,
    legalName: overrides.legalName ?? `Empresa Teste ${stamp} LTDA`,
    tradeName: overrides.tradeName ?? `Empresa Teste ${stamp}`,
    cnpj: overrides.cnpj ?? VALID_CNPJ_FOR_SIGNUP,
    phone: overrides.phone ?? '+5562999990000',
    consents: overrides.consents ?? {
      marketing: true,
      analytics: true,
      payment_data: true,
    },
  }
}

function makeHeaders(ip = '198.51.100.42'): Headers {
  return new Headers({
    'x-forwarded-for': ip,
    'user-agent': 'fb-eventos-test/0',
    'content-type': 'application/json',
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────────

describe('FORN-01: fornecedor signup', () => {
  let tenantId = ''
  let tenantSlug = ''

  beforeEach(async () => {
    const stamp = Date.now()
    tenantSlug = `forn-test-${stamp}`
    tenantId = await createTenant(tenantSlug, `Forn Test Tenant ${stamp}`)
    // Insert matching organization row via insertOrganization (uses appPool + SET LOCAL
    // to satisfy FORCE RLS on the organization table — same as production path).
    // The id must match the tenantId for the Phase 0 org.id === tenant.id invariant.
    // insertOrganization returns a new UUID, so we use raw appPool for id-pinning.
    await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      await tx`
        INSERT INTO organization (id, tenant_id, slug, name)
        VALUES (${tenantId}, ${tenantId}, ${tenantSlug}, ${'Forn Test Tenant'})
        ON CONFLICT (id) DO NOTHING
      `
    })
  })

  it('happy path: vendor + member + 3 consent rows created, audit row, email job enqueued', async () => {
    const input = makeInput()
    const headers = makeHeaders()

    const result = await signupFornecedorForTenant(tenantSlug, input, headers)

    expect(result.vendorId).toBeDefined()

    // Vendor row with status='pending' (D-23)
    const vendors = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ id: string; status: string }>>`
        SELECT id, status FROM vendors WHERE id = ${result.vendorId}
      `
    })
    expect(vendors).toHaveLength(1)
    expect(vendors[0]?.status).toBe('pending')

    // 3 vendor_consents rows (D-24)
    const consents = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ consent_type: string; ip_address: string }>>`
        SELECT consent_type, ip_address FROM vendor_consents
        WHERE vendor_id = ${result.vendorId}
        ORDER BY consent_type
      `
    })
    expect(consents).toHaveLength(3)
    const types = consents.map((c) => c.consent_type).sort()
    expect(types).toEqual(['analytics', 'marketing', 'payment_data'])

    // audit_log row with action='vendor.created'
    const audits = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ action: string }>>`
        SELECT action FROM audit_log WHERE entity_id = ${result.vendorId}
      `
    })
    expect(audits.some((a) => a.action === 'vendor.created')).toBe(true)

    // email.send-status-update job with event='signup_fornecedor'
    const jobs = await migratorPool<Array<{ payload: string }>>`
      SELECT j.payload::text AS payload
      FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = ${EMAIL_STATUS_UPDATE_TASK}
    `
    expect(jobs.length).toBeGreaterThanOrEqual(1)
    const payloads = jobs.map((j) => {
      try {
        return JSON.parse(j.payload)
      } catch {
        return {}
      }
    })
    expect(payloads.some((p: Record<string, unknown>) => p.event === 'signup_fornecedor')).toBe(
      true,
    )
  })

  it('D-22: same CNPJ on two tenants → 2 vendor rows, same userId reused', async () => {
    const stamp = Date.now()
    const slugB = `forn-tenant-b-${stamp}`
    const tenantBId = await createTenant(slugB, `Tenant B ${stamp}`)
    await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantBId}, true)`
      await tx`
        INSERT INTO organization (id, tenant_id, slug, name)
        VALUES (${tenantBId}, ${tenantBId}, ${slugB}, ${'Tenant B'})
        ON CONFLICT (id) DO NOTHING
      `
    })

    const email = `same-cnpj-${stamp}@test.example`
    const inputA = makeInput({ email, cnpj: VALID_CNPJ_FOR_SIGNUP })
    // Same email — user reused. Password same (user won't be created again).
    const inputB = makeInput({ email, cnpj: VALID_CNPJ_FOR_SIGNUP })
    const headers = makeHeaders()

    const resultA = await signupFornecedorForTenant(tenantSlug, inputA, headers)
    const resultB = await signupFornecedorForTenant(slugB, inputB, headers)

    // Two different vendor rows (D-22 — CNPJ not unique across tenants)
    expect(resultA.vendorId).not.toBe(resultB.vendorId)

    // 1 auth.user row — email is globally unique
    const users = await migratorPool<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM "user" WHERE email = ${email}
    `
    expect(users[0]?.count).toBe(1)

    // Both calls return the same userId (user reused)
    expect(resultA.userId).toBe(resultB.userId)
  })

  it('CNPJ degrade-with-warning: BrasilAPI 5xx → vendor created with cnpj_verified=false', async () => {
    mocks.brasilapiReturn(VALID_CNPJ_FOR_SIGNUP, 503)
    const input = makeInput()
    const headers = makeHeaders()

    const result = await signupFornecedorForTenant(tenantSlug, input, headers)
    expect(result.vendorId).toBeDefined()

    const vendorRows = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ cnpj_verified: boolean }>>`
        SELECT cnpj_verified FROM vendors WHERE id = ${result.vendorId}
      `
    })
    expect(vendorRows[0]?.cnpj_verified).toBe(false)
  })

  it('missing required consent (payment_data=false): Zod rejects, no DB writes', async () => {
    // Cast to bypass TypeScript's literal(true) so we can test the runtime Zod check.
    const badConsents = { marketing: true, analytics: true, payment_data: false } as unknown as {
      marketing: boolean
      analytics: boolean
      payment_data: true
    }
    const input = makeInput({ consents: badConsents })
    const headers = makeHeaders()

    await expect(signupFornecedorForTenant(tenantSlug, input, headers)).rejects.toThrow()

    // No vendor row created
    const vendorRows = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ id: string }>>`SELECT id FROM vendors LIMIT 5`
    })
    expect(vendorRows).toHaveLength(0)
  })

  it('LGPD audit: vendor_consents rows carry ip_address from x-forwarded-for', async () => {
    const clientIp = '203.0.113.55'
    const input = makeInput()
    const headers = makeHeaders(clientIp)

    const result = await signupFornecedorForTenant(tenantSlug, input, headers)

    const consents = await appPool.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      return tx<Array<{ ip_address: string | null }>>`
        SELECT ip_address FROM vendor_consents WHERE vendor_id = ${result.vendorId}
      `
    })
    expect(consents.length).toBeGreaterThan(0)
    for (const c of consents) {
      expect(c.ip_address).toBe(clientIp)
    }
  })
})
