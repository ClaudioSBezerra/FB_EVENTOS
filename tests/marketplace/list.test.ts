// FB_EVENTOS — FORN-02: tenant-scoped event discovery (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-02. See VALIDATION.md row FORN-02.
//
// TODO (Plan 02-02): import { listMarketplaceEvents } from '@/lib/actions/marketplace'

import { describe, it } from 'vitest';

describe('FORN-02: marketplace event listing', () => {
  it.todo('lists tenant published events in /[slug]/marketplace');
  it.todo('cross-tenant: events in tenant A invisible in tenant B marketplace');
  it.todo('non-published (draft) events excluded from the listing');
});
