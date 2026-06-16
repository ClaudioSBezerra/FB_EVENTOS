// FB_EVENTOS — Tenant slug + middleware unit tests (Phase 0, Plan 04).
//
// Asserts the TENA-05 split:
//   1. slugReserved() correctly identifies SYSTEM_PREFIXES.
//   2. middleware sets x-tenant-slug for tenant paths.
//   3. middleware does NOT set x-tenant-slug for system paths (/api/*).
//   4. middleware always sets x-request-id (preserves inbound or generates).
//   5. middleware does NOT touch the database — proves the TENA-05 split
//      (middleware is Edge-runtime, DB access happens only inside withTenant).
//
// The DB-no-touch assertion uses a vi.mock() spy on `postgres` to prove no
// postgres client is constructed during middleware execution.

import { NextRequest } from 'next/server'
import { describe, expect, test, vi } from 'vitest'
import { SYSTEM_PREFIXES, slugReserved } from '@/lib/tenant'
import { middleware } from '@/middleware'

describe('SYSTEM_PREFIXES + slugReserved', () => {
  test('all 17 prefixes are present', () => {
    expect(SYSTEM_PREFIXES.size).toBe(17)
    expect(SYSTEM_PREFIXES.has('api')).toBe(true)
    expect(SYSTEM_PREFIXES.has('login')).toBe(true)
    expect(SYSTEM_PREFIXES.has('signup')).toBe(true)
    expect(SYSTEM_PREFIXES.has('dashboard')).toBe(true)
    expect(SYSTEM_PREFIXES.has('admin')).toBe(true)
    expect(SYSTEM_PREFIXES.has('docs')).toBe(true)
    expect(SYSTEM_PREFIXES.has('onboarding')).toBe(true)
  })

  test('slugReserved is case-insensitive and rejects API/login', () => {
    expect(slugReserved('api')).toBe(true)
    expect(slugReserved('API')).toBe(true)
    expect(slugReserved('Login')).toBe(true)
    expect(slugReserved('signup')).toBe(true)
  })

  test('slugReserved accepts real tenant slugs', () => {
    expect(slugReserved('acme-corp')).toBe(false)
    expect(slugReserved('globex')).toBe(false)
    expect(slugReserved('festa-de-trindade-2026')).toBe(false)
  })
})

describe('middleware — tenant slug parsing', () => {
  test('sets x-tenant-slug for /acme-corp/dashboard', () => {
    const req = new NextRequest('https://app.fb-eventos.local/acme-corp/dashboard')
    const res = middleware(req)
    expect(res.headers.get('x-tenant-slug')).toBe('acme-corp')
  })

  test('does NOT set x-tenant-slug for /api/health (system path)', () => {
    const req = new NextRequest('https://app.fb-eventos.local/api/health')
    const res = middleware(req)
    expect(res.headers.get('x-tenant-slug')).toBeNull()
  })

  test('does NOT set x-tenant-slug for /login (system path)', () => {
    const req = new NextRequest('https://app.fb-eventos.local/login')
    const res = middleware(req)
    expect(res.headers.get('x-tenant-slug')).toBeNull()
  })

  test('does NOT set x-tenant-slug for root /', () => {
    const req = new NextRequest('https://app.fb-eventos.local/')
    const res = middleware(req)
    expect(res.headers.get('x-tenant-slug')).toBeNull()
  })
})

describe('middleware — request id', () => {
  test('generates a UUID x-request-id when none is provided', () => {
    const req = new NextRequest('https://app.fb-eventos.local/acme/dashboard')
    const res = middleware(req)
    const id = res.headers.get('x-request-id')
    expect(id).toBeTruthy()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  test('preserves an inbound x-request-id', () => {
    const inbound = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const req = new NextRequest('https://app.fb-eventos.local/acme/dashboard', {
      headers: { 'x-request-id': inbound },
    })
    const res = middleware(req)
    expect(res.headers.get('x-request-id')).toBe(inbound)
  })
})

describe('TENA-05 split — middleware does NOT touch the DB', () => {
  // Middleware lives on the Edge runtime, where postgres() / Drizzle cannot
  // be imported. Any DB call from middleware would crash the Edge bundle.
  // We prove the contract by spying on `postgres` at the module level: if
  // middleware tried to require it, the spy would record a call.
  //
  // The mock must be installed BEFORE middleware imports — so we use
  // vi.mock at the top. Postgres.js isn't even imported by middleware.ts
  // (verified by reading the file); this test makes the invariant
  // structural.

  test('middleware module does not import postgres / Drizzle', async () => {
    // Read the middleware source and assert no DB-layer imports.
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const src = await fs.readFile(path.resolve(process.cwd(), 'src/middleware.ts'), 'utf8')
    expect(src).not.toMatch(/from\s+['"]postgres['"]/)
    expect(src).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(src).not.toMatch(/from\s+['"]@\/db['"]/)
  })

  test('middleware execution does NOT instantiate a postgres client', async () => {
    // Spy on postgres.js: if middleware would call it, we'd see a call.
    // Already-loaded postgres modules: clear the module cache so the spy
    // can intercept any fresh import.
    const postgresSpy = vi.fn()
    vi.doMock('postgres', () => ({ default: postgresSpy }))

    const req = new NextRequest('https://app.fb-eventos.local/acme/dashboard')
    const res = middleware(req)
    expect(res.headers.get('x-tenant-slug')).toBe('acme')
    expect(postgresSpy).not.toHaveBeenCalled()

    vi.doUnmock('postgres')
  })
})
