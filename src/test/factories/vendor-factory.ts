// FB_EVENTOS — Vendor factory (Phase 1, Plan 01-01 — Wave 0 test infra).
//
// Builds a `vendors` row with a valid stub CNPJ (matches the CNPJ used by
// the external-mocks BrasilAPI happy-path response so the BrasilAPI test
// path resolves to "ACTIVE" by default).
//
// FORCE RLS on `vendors` blocks the migrator path the original Plan 01-01
// docstring assumed; we use appPool inside a SET LOCAL transaction (same
// pattern as `insertOrganization` in test/db.ts and lot-category-factory).
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (vendors schema)
//   - src/test/external-mocks.ts (BRASILAPI_CNPJ_ACTIVE.cnpj)
//   - src/test/db.ts (appPool + SET LOCAL pattern)

import { appPool } from '@/test/db'

/**
 * Default stub CNPJ — matches `BRASILAPI_CNPJ_ACTIVE.cnpj` in external-mocks
 * so tests that hit BrasilAPI through MSW receive ACTIVE status by default.
 */
export const STUB_CNPJ = '12345678000190'

export interface VendorOverrides {
  cnpj?: string
  legalName?: string
  tradeName?: string | null
  email?: string
  phone?: string | null
  status?: 'pending' | 'approved' | 'rejected'
  cnpjVerified?: boolean
  approvalReason?: string | null
}

export interface PersistedVendor {
  id: string
  tenantId: string
  cnpj: string
  legalName: string
  tradeName: string | null
  email: string
  phone: string | null
  status: string
  cnpjVerified: boolean
  approvalReason: string | null
}

/**
 * Build + persist a vendor row for `tenantId`. By default the CNPJ matches
 * the BrasilAPI happy-path mock so subsequent BrasilAPI lookups return
 * ACTIVE (situacao_cadastral=2). Override `cnpj` to test 404 / 5xx / BAIXADA
 * paths in conjunction with `mocks.brasilapiReturn(...)`.
 */
export async function makeVendor(
  tenantId: string,
  overrides: VendorOverrides = {},
): Promise<PersistedVendor> {
  const suffix = Date.now()
  const defaults = {
    cnpj: overrides.cnpj ?? STUB_CNPJ,
    legalName: overrides.legalName ?? `Empresa Teste ${suffix} LTDA`,
    tradeName: overrides.tradeName ?? `Empresa Teste ${suffix}`,
    email: overrides.email ?? `vendor-${suffix}@example.com`,
    phone: overrides.phone ?? '+5562999990000',
    status: overrides.status ?? 'pending',
    cnpjVerified: overrides.cnpjVerified ?? false,
    approvalReason: overrides.approvalReason ?? null,
  }

  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<
      Array<{
        id: string
        tenant_id: string
        cnpj: string
        legal_name: string
        trade_name: string | null
        email: string
        phone: string | null
        status: string
        cnpj_verified: boolean
        approval_reason: string | null
      }>
    >`
      INSERT INTO vendors (
        tenant_id, cnpj, legal_name, trade_name, email, phone, status,
        cnpj_verified, approval_reason
      ) VALUES (
        ${tenantId}, ${defaults.cnpj}, ${defaults.legalName}, ${defaults.tradeName},
        ${defaults.email}, ${defaults.phone}, ${defaults.status},
        ${defaults.cnpjVerified}, ${defaults.approvalReason}
      )
      RETURNING id, tenant_id, cnpj, legal_name, trade_name, email, phone,
                status, cnpj_verified, approval_reason
    `
  })

  if (!rows[0]) throw new Error('makeVendor: no row returned')
  const r = rows[0]
  return {
    id: r.id,
    tenantId: r.tenant_id,
    cnpj: r.cnpj,
    legalName: r.legal_name,
    tradeName: r.trade_name,
    email: r.email,
    phone: r.phone,
    status: r.status,
    cnpjVerified: r.cnpj_verified,
    approvalReason: r.approval_reason,
  }
}
