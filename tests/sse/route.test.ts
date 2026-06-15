// FB_EVENTOS — FORN-07: SSE Route Handler + pg_notify fan-out (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-04. See VALIDATION.md row FORN-07.
//
// TODO (Plan 02-04): import { GET } from '@/app/api/sse/events/[eventId]/lots/route'

import { describe, it } from 'vitest';

describe('FORN-07: SSE lot-events route handler', () => {
  it.todo('client receives data: event after pg_notify from another connection');
  it.todo('tenant scoping: only events for current tenant + eventId flow to client');
  it.todo('connection cleanup: NOTIFY listener detached when client disconnects');
});
