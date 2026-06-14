// FB_EVENTOS — FORN-05: 50-concurrent reservation race (Wave 0 scaffold, Plan 02-01).
// LOAD-BEARING: this test is the FORN-05 invariant guard.
// Filled in by Plan 02-03. See VALIDATION.md row FORN-05.
//
// TODO (Plan 02-03): import { reserveLotInTenant } from '@/lib/actions/reservations'

import { describe, it } from 'vitest';

describe('FORN-05: concurrent reservation race (load-bearing)', () => {
  it.todo('50 concurrent reserveLotInTenant: exactly 1 winner, 49 × 409 conflict');
  it.todo(
    'load-bearing: advisory lock on (tenant_id, lot_id) ensures determinism under stress'
  );
});
