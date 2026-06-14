// FB_EVENTOS — FORN-17: vendor portal render (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-08. See VALIDATION.md row FORN-17.
//
// TODO (Plan 02-08): import portal pages from @/app/[slug]/portal/...

import { describe, it } from 'vitest';

describe('FORN-17: vendor portal pages render', () => {
  it.todo('/[slug]/portal lists current vendor purchases (tenant-scoped)');
  it.todo('/[slug]/portal/purchases/[paymentId] shows signed download URL for contract');
  it.todo('/[slug]/portal/settings shows consent toggles with current grant state');
  it.todo('cross-tenant: vendor in tenant A cannot view payments from tenant B');
});
