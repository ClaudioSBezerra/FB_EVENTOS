// FB_EVENTOS — FORN-13: outbox + business write atomicity (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-03. See VALIDATION.md row FORN-13.
//
// TODO (Plan 02-03): import { emitOutboxInTransaction } from '@/lib/outbox/emit'

import { describe, it } from 'vitest';

describe('FORN-13: outbox + business write atomicity', () => {
  it.todo(
    'lot_reservations INSERT + outbox_events INSERT in same tx → rollback ⇒ neither persists'
  );
  it.todo('successful tx → both rows visible after commit');
  it.todo('outbox INSERT failure rolls back business write (sanity check)');
});
