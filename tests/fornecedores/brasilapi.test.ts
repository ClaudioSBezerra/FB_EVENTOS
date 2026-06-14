// FB_EVENTOS — BrasilAPI CNPJ lookup tests (Phase 1, Plan 01-04 — Task 1).
//
// Six load-bearing cases (D-16 — 2-layer CNPJ validation + degradation):
//
//   1. ACTIVE CNPJ → verified=true, source='brasilapi', payload returned.
//   2. INACTIVE CNPJ (BAIXADA) → verified=false, source='brasilapi',
//      reason='inactive', payload NOT cached (status is volatile).
//   3. 404 → verified=false, reason='not_found'.
//   4. 5xx → verified=null, source='degraded'.
//   5. Timeout (>5s) → verified=null, source='degraded', reason='timeout'.
//   6. Cache hit on a previously-ACTIVE CNPJ: second call returns
//      source='cache' AND the BrasilAPI MSW handler is NOT re-hit
//      (proven by a request counter).
//
// All cases drive `lookupCNPJCore(rawCnpj)` directly (no Server Action
// wrapper) so the test isolates the cache + HTTP behavior.

import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { pool } from '@/db'
import { lookupCNPJCore } from '@/lib/actions/brasilapi'
import { appPool, migratorPool } from '@/test/db'
import { setupExternalMocks } from '@/test/external-mocks'

const mocks = setupExternalMocks()

beforeAll(() => mocks.listen())
afterAll(async () => {
  mocks.close()
  await appPool.end({ timeout: 5 })
  await migratorPool.end({ timeout: 5 })
  await pool.end({ timeout: 5 })
})

// Clear the cache between tests so each test exercises the fresh-call path
// unless it intentionally seeds the cache.
beforeEach(async () => {
  await migratorPool`DELETE FROM cnpj_lookup_cache`
})

afterEach(() => {
  mocks.resetHandlers()
})

// Valid mod-11 CNPJs (Receita Federal check-digit algorithm). The default
// BRASILAPI_CNPJ_ACTIVE.cnpj fixture (`12345678000190`) was minted before the
// Layer 1 schema landed and has an invalid checksum — we use checksum-valid
// values here and let MSW echo them back via brasilapiReturn().
const ACTIVE_CNPJ = '12345678000195' // valid mod-11
const SECOND_ACTIVE_CNPJ = '11222333000181' // valid mod-11

describe('lookupCNPJ — happy path (Plan 01-04 Task 1)', () => {
  test('ACTIVE CNPJ → verified=true, source=brasilapi, data returned', async () => {
    const result = await lookupCNPJCore(ACTIVE_CNPJ)

    expect(result.verified).toBe(true)
    expect(result.source).toBe('brasilapi')
    expect(result.cnpj).toBe(ACTIVE_CNPJ)
    if (result.verified === true) {
      expect(result.data.razao_social).toBe('EMPRESA TESTE LTDA')
    }

    // Cache row was persisted.
    const rows = await migratorPool<{ cnpj: string }[]>`
      SELECT cnpj FROM cnpj_lookup_cache WHERE cnpj = ${ACTIVE_CNPJ}
    `
    expect(rows).toHaveLength(1)
  })

  test('INACTIVE CNPJ (BAIXADA) → verified=false, NOT cached (status is volatile)', async () => {
    mocks.brasilapiReturn(ACTIVE_CNPJ, {
      situacao_cadastral: 8,
      descricao_situacao_cadastral: 'BAIXADA',
    })

    const result = await lookupCNPJCore(ACTIVE_CNPJ)

    expect(result.verified).toBe(false)
    expect(result.source).toBe('brasilapi')
    if (result.verified === false) {
      expect(result.reason).toBe('inactive')
      expect(result.situacao).toBe('BAIXADA')
    }

    // BAIXADA responses MUST NOT be cached (the CNPJ may become ATIVA again).
    const rows = await migratorPool<{ cnpj: string }[]>`
      SELECT cnpj FROM cnpj_lookup_cache WHERE cnpj = ${ACTIVE_CNPJ}
    `
    expect(rows).toHaveLength(0)
  })
})

describe('lookupCNPJ — error handling (Plan 01-04 Task 1)', () => {
  test('404 → verified=false, reason=not_found, NOT cached', async () => {
    mocks.brasilapiReturn(ACTIVE_CNPJ, 404)

    const result = await lookupCNPJCore(ACTIVE_CNPJ)

    expect(result.verified).toBe(false)
    expect(result.source).toBe('brasilapi')
    if (result.verified === false) {
      expect(result.reason).toBe('not_found')
    }

    const rows = await migratorPool<{ cnpj: string }[]>`
      SELECT cnpj FROM cnpj_lookup_cache WHERE cnpj = ${ACTIVE_CNPJ}
    `
    expect(rows).toHaveLength(0)
  })

  test('5xx → verified=null, source=degraded (caller may accept with cnpj_verified=false)', async () => {
    mocks.brasilapiReturn(ACTIVE_CNPJ, 503)

    const result = await lookupCNPJCore(ACTIVE_CNPJ)

    expect(result.verified).toBeNull()
    expect(result.source).toBe('degraded')
    if (result.source === 'degraded') {
      expect(result.reason).toMatch(/503/)
    }

    const rows = await migratorPool<{ cnpj: string }[]>`
      SELECT cnpj FROM cnpj_lookup_cache WHERE cnpj = ${ACTIVE_CNPJ}
    `
    expect(rows).toHaveLength(0)
  })

  test('timeout (>5s) → verified=null, source=degraded, reason=timeout', async () => {
    // Install a handler that never responds — AbortController fires before
    // the 30s vitest test-timeout, so the test resolves in ~5s.
    mocks.use(
      http.get('https://brasilapi.com.br/api/cnpj/v1/:cnpj', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_000))
        return HttpResponse.json({})
      }),
    )

    const result = await lookupCNPJCore(ACTIVE_CNPJ)

    expect(result.verified).toBeNull()
    expect(result.source).toBe('degraded')
    if (result.source === 'degraded') {
      expect(result.reason).toBe('timeout')
    }
  }, 15_000)
})

describe('lookupCNPJ — 7-day cache (Plan 01-04 Task 1)', () => {
  test('cache hit returns source=cache and does NOT re-call BrasilAPI', async () => {
    // Counter to prove the network mock fires once and only once.
    let hits = 0
    mocks.use(
      http.get('https://brasilapi.com.br/api/cnpj/v1/:cnpj', ({ params }) => {
        hits += 1
        return HttpResponse.json(
          {
            cnpj: String(params.cnpj),
            razao_social: 'CACHE TEST LTDA',
            situacao_cadastral: 2,
            descricao_situacao_cadastral: 'ATIVA',
          },
          { status: 200 },
        )
      }),
    )

    // First call — populates cache, hits BrasilAPI once.
    const first = await lookupCNPJCore(SECOND_ACTIVE_CNPJ)
    expect(first.verified).toBe(true)
    expect(first.source).toBe('brasilapi')
    expect(hits).toBe(1)

    // Second call — served from cache, BrasilAPI counter unchanged.
    const second = await lookupCNPJCore(SECOND_ACTIVE_CNPJ)
    expect(second.verified).toBe(true)
    expect(second.source).toBe('cache')
    if (second.verified === true) {
      expect(second.data.razao_social).toBe('CACHE TEST LTDA')
    }
    expect(hits).toBe(1)
  })
})
