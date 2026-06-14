// FB_EVENTOS — FORN-12: webhook handler perf < 100ms p95 (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-05. See VALIDATION.md row FORN-12.
//
// TODO (Plan 02-05): drive POST /api/webhooks/pagarme N times, measure p95.

import { describe, it } from 'vitest';

describe('FORN-12: webhook handler perf', () => {
  it.todo(
    'p95 < 100ms across N=100 deliveries (handler does inbox INSERT + enqueue only — no business logic)'
  );
  it.todo('handler does NOT call Pagar.me API in the hot path (re-fetch happens in worker)');
});
