// FB_EVENTOS — FORN-16: end-to-end refund + outbox cascade (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-07. See VALIDATION.md row FORN-16.
//
// TODO (Plan 02-07): import { requestRefund } from '@/lib/actions/refunds'

import { describe, it } from 'vitest';

describe('FORN-16: refund end-to-end SAGA', () => {
  it.todo(
    'requestRefund creates refund_requests row with refundPct per 4-tier temporal policy'
  );
  it.todo('refund.created outbox handler calls Pagar.me DELETE /core/v5/charges/:id');
  it.todo('refund success → lot.released outbox + waitlist.notify-next enqueued');
  it.todo('refund failure → refund_requests.status="failed" + audit row');
  it.todo('idempotent: replay does not double-refund (pagarme_refund_id pinned)');
});
