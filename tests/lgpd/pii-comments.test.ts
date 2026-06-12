// FB_EVENTOS — PII column inventory via SQL comments (Phase 0, Plan 05 —
// LGPD-03).
//
// Assertions:
//   - Joining information_schema.columns to pg_description finds ≥8 columns
//     where the comment matches LIKE 'PII:%'.
//   - audit_log has ≥3 PII-tagged columns (user_id, ip_address, payload,
//     user_agent — all four start with 'PII:' after migration 0007).
//   - consent_records has ≥2 PII-tagged columns (user_id, ip_address).
//   - user has the email + name + consent_* PII columns tagged.
//
// The query is the canonical LGPD-03 inventory query — runnable by auditors
// against any FB_EVENTOS database.

import { afterAll, describe, expect, test } from 'vitest'
import { migratorPool } from '@/test/db'

describe('PII inventory via SQL comments (LGPD-03)', () => {
  afterAll(async () => {
    // migratorPool is closed in the global setup's afterAll; nothing to do here.
  })

  test('≥8 PII columns are inventoried via information_schema + pg_description', async () => {
    const rows = await migratorPool<
      { table_name: string; column_name: string; description: string }[]
    >`
      SELECT c.table_name, c.column_name, d.description
        FROM information_schema.columns c
        JOIN pg_description d
          ON d.objoid = (quote_ident(c.table_name))::regclass::oid
         AND d.objsubid = c.ordinal_position
       WHERE c.table_schema = 'public'
         AND d.description LIKE 'PII:%'
       ORDER BY c.table_name, c.column_name
    `

    expect(rows.length).toBeGreaterThanOrEqual(8)

    const tableCols = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))

    // audit_log: at least user_id + ip_address (the two non-low-sensitivity ones).
    expect(tableCols.has('audit_log.user_id')).toBe(true)
    expect(tableCols.has('audit_log.ip_address')).toBe(true)

    // consent_records: user_id + ip_address.
    expect(tableCols.has('consent_records.user_id')).toBe(true)
    expect(tableCols.has('consent_records.ip_address')).toBe(true)

    // user: email + name (the primary identification PII).
    expect(tableCols.has('user.email')).toBe(true)
    expect(tableCols.has('user.name')).toBe(true)
  })

  test('audit_log has ≥3 PII-tagged columns (LGPD-03 audit table inventory)', async () => {
    const rows = await migratorPool<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM information_schema.columns c
        JOIN pg_description d
          ON d.objoid = (quote_ident(c.table_name))::regclass::oid
         AND d.objsubid = c.ordinal_position
       WHERE c.table_name = 'audit_log'
         AND d.description LIKE 'PII:%'
    `
    const count = Number.parseInt(rows[0]?.count ?? '0', 10)
    expect(count).toBeGreaterThanOrEqual(3)
  })
})
