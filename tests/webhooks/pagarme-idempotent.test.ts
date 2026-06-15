// FB_EVENTOS — FORN-10: webhook idempotency by gateway_event_id (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-05. See VALIDATION.md row FORN-10.
//
// TODO (Plan 02-05): import { POST } from '@/app/api/webhooks/pagarme/route'

import { describe, it } from 'vitest';

describe('FORN-10: Pagar.me webhook idempotency', () => {
  it.todo(
    'same gateway_event_id delivered twice → single payment_webhooks_inbox row'
  );
  it.todo(
    'same gateway_event_id delivered twice → single FSM transition (no double-process)'
  );
  it.todo(
    'second delivery returns 200 OK with "duplicate" body, not 409 (Pagar.me retries)'
  );
});
