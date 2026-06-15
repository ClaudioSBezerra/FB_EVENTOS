// FB_EVENTOS — FORN-04: reservation row creation (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-03. See VALIDATION.md row FORN-04.
//
// TODO (Plan 02-03): import { reserveLotInTenant } from '@/lib/actions/reservations'

import { describe, it } from 'vitest';

describe('FORN-04: reserveLotInTenant happy path', () => {
  it.todo('creates lot_reservations row with expires_at = now() + 15min');
  it.todo('emits outbox lot.reserved in the same transaction');
  it.todo('rejects reservation when lot is already sold');
});
