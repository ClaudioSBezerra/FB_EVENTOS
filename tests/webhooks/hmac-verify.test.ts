// FB_EVENTOS — FORN-11: Pagar.me webhook HMAC verification (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-05. See VALIDATION.md row FORN-11 + AM-02 probe.
//
// TODO (Plan 02-05): import { verifyPagarmeHmac } from '@/lib/pagarme/hmac'
// TODO (Plan 02-05): import { signPagarmePayload } from '../test-mocks/pagarme'

import { describe, it } from 'vitest';

describe('FORN-11: webhook HMAC verification', () => {
  it.todo('valid HMAC signature → 200 OK');
  it.todo('invalid HMAC signature → 401 Unauthorized');
  it.todo('missing signature header → 401 Unauthorized');
  it.todo('AM-02: header name pinned by probe test (X-Hub-Signature or alt)');
});
