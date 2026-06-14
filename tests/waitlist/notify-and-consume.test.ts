// FB_EVENTOS — FORN-15: waitlist notify + JWT single-use consume (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-07. See VALIDATION.md row FORN-15.
//
// TODO (Plan 02-07): import { notifyWaitlistNext } from '@/jobs/tasks/waitlist-notify-next'
// TODO (Plan 02-07): import { redeemWaitlistToken } from '@/lib/actions/waitlist'

import { describe, it } from 'vitest';

describe('FORN-15: waitlist notify + JWT consume', () => {
  it.todo('lot.released triggers waitlist.notify-next for top 3 vendors');
  it.todo('email sent contains JWT valid for 15 min (signed with WAITLIST_JWT_SECRET)');
  it.todo('JWT consume creates a fresh lot_reservations row and marks token used');
  it.todo('JWT single-use: second redeem with same jti → 410 Gone');
  it.todo('JWT expired (>15min) → 410 Gone');
});
