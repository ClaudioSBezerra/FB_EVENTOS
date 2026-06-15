// FB_EVENTOS — FORN-06: reservation.expire scheduled task (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-03. See VALIDATION.md row FORN-06.
//
// TODO (Plan 02-03): import { runTaskInline } from '../test-mocks/graphile-worker'

import { describe, it } from 'vitest';

describe('FORN-06: reservation.expire scheduled task', () => {
  it.todo('releases reservations whose expires_at < now() (sets released_at)');
  it.todo('emits outbox lot.released in same transaction');
  it.todo('cross-tenant scan via migratorPool — handles >1 tenant in one tick');
});
