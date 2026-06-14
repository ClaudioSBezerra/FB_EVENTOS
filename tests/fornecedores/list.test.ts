// FB_EVENTOS — listVendors RLS-scoped SELECT + filter + search
// (Phase 1, Plan 01-04 — Task 2).
//
// Three load-bearing cases:
//
//   1. RLS isolation — listVendors in tenant A returns ONLY tenant A vendors;
//      tenant B sees its own set.
//   2. Status filter — pending / approved / rejected filters return the
//      right subset.
//   3. Search — case-insensitive substring match on trade_name AND digit
//      substring match on cnpj.

import { afterAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { withTenant } from '@/db/with-tenant'
import { listVendorsInTenant } from '@/lib/actions/fornecedores'
import { appPool, createTenant, insertUser, migratorPool } from '@/test/db'
import { makeVendor } from '@/test/factories/vendor-factory'

let tenantAId = ''
let tenantBId = ''
let userId = ''

beforeEach(async () => {
  const stamp = Date.now()
  tenantAId = await createTenant(`vlist-a-${stamp}`, 'Vendor-List Tenant A')
  tenantBId = await createTenant(`vlist-b-${stamp}`, 'Vendor-List Tenant B')
  userId = await insertUser(`vlist-actor-${stamp}@example.test`, 'Vendor List Actor')
})

afterAll(async () => {
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

describe('listVendors — RLS + filter + search (Plan 01-04 Task 2)', () => {
  test('RLS isolation: tenant A list returns ONLY tenant A vendors', async () => {
    // Seed: tenant A gets 2 vendors, tenant B gets 1 — proves cross-tenant
    // isolation even when both tenants are populated.
    await makeVendor(tenantAId, { legalName: 'Aprovado A LTDA', status: 'approved' })
    await makeVendor(tenantAId, { legalName: 'Pendente A LTDA', status: 'pending' })
    await makeVendor(tenantBId, { legalName: 'Tenant B Vendor LTDA', status: 'approved' })

    const aRows = await withTenant(tenantAId, async (db) => listVendorsInTenant(db, {}))
    expect(aRows).toHaveLength(2)
    for (const v of aRows) {
      expect(v.tenantId).toBe(tenantAId)
    }

    const bRows = await withTenant(tenantBId, async (db) => listVendorsInTenant(db, {}))
    expect(bRows).toHaveLength(1)
    expect(bRows[0]?.tenantId).toBe(tenantBId)
    expect(bRows[0]?.legalName).toBe('Tenant B Vendor LTDA')
  })

  test('status filter returns only matching rows', async () => {
    await makeVendor(tenantAId, { legalName: 'Pendente 1', status: 'pending' })
    await makeVendor(tenantAId, { legalName: 'Pendente 2', status: 'pending' })
    await makeVendor(tenantAId, { legalName: 'Aprovado 1', status: 'approved' })
    await makeVendor(tenantAId, {
      legalName: 'Rejeitado 1',
      status: 'rejected',
      approvalReason: 'Docs faltando',
    })

    const pending = await withTenant(tenantAId, async (db) =>
      listVendorsInTenant(db, { status: 'pending' }),
    )
    expect(pending).toHaveLength(2)
    for (const v of pending) {
      expect(v.status).toBe('pending')
    }

    const approved = await withTenant(tenantAId, async (db) =>
      listVendorsInTenant(db, { status: 'approved' }),
    )
    expect(approved).toHaveLength(1)
    expect(approved[0]?.legalName).toBe('Aprovado 1')

    const rejected = await withTenant(tenantAId, async (db) =>
      listVendorsInTenant(db, { status: 'rejected' }),
    )
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.approvalReason).toBe('Docs faltando')
  })

  test('search matches trade_name (case-insensitive substring) AND cnpj (digit substring)', async () => {
    await makeVendor(tenantAId, {
      legalName: 'Alpha Indústrias LTDA',
      tradeName: 'Alpha Stands',
      cnpj: '11222333000181',
      status: 'approved',
    })
    await makeVendor(tenantAId, {
      legalName: 'Beta Foods LTDA',
      tradeName: 'Beta Bebidas',
      cnpj: '22333444000170',
      status: 'pending',
    })
    await makeVendor(tenantAId, {
      legalName: 'Gama Serviços ME',
      tradeName: null,
      cnpj: '33444555000169',
      status: 'pending',
    })

    // Trade name match.
    const stands = await withTenant(tenantAId, async (db) =>
      listVendorsInTenant(db, { search: 'stands' }),
    )
    expect(stands).toHaveLength(1)
    expect(stands[0]?.tradeName).toBe('Alpha Stands')

    // Legal name match (case-insensitive).
    const beta = await withTenant(tenantAId, async (db) =>
      listVendorsInTenant(db, { search: 'foods' }),
    )
    expect(beta).toHaveLength(1)
    expect(beta[0]?.legalName).toBe('Beta Foods LTDA')

    // CNPJ digit substring match.
    const byCnpj = await withTenant(tenantAId, async (db) =>
      listVendorsInTenant(db, { search: '11222333' }),
    )
    expect(byCnpj).toHaveLength(1)
    expect(byCnpj[0]?.cnpj).toBe('11222333000181')

    // Search across formatted CNPJ — digits are normalized before ilike.
    const byFormattedCnpj = await withTenant(tenantAId, async (db) =>
      listVendorsInTenant(db, { search: '22.333.444' }),
    )
    expect(byFormattedCnpj).toHaveLength(1)
    expect(byFormattedCnpj[0]?.cnpj).toBe('22333444000170')
  })
})
