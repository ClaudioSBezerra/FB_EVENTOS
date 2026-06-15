// FB_EVENTOS — FORN-18: vendor consent insert + revoke + audit (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-08. See VALIDATION.md row FORN-18.
//
// TODO (Plan 02-08): import { recordConsent, revokeConsent } from '@/lib/actions/consents'

import { describe, it } from 'vitest'

describe('FORN-18: vendor consent FSM + audit', () => {
  it.todo('recordConsent inserts vendor_consents row + audit_log row')
  it.todo('three independent consent types stored: marketing, analytics, payment_data')
  it.todo('revokeConsent sets revoked_at + appends second audit row')
  it.todo('consent_text snapshot preserved when consent_version bumps')
  it.todo('cross-tenant: consent in tenant A invisible in tenant B (RLS)')
})
