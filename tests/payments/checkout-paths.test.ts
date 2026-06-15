// FB_EVENTOS — FORN-09: Pagar.me PIX + credit_card checkout paths (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-05. See VALIDATION.md row FORN-09.
// Boleto deferred per AM-01.
//
// TODO (Plan 02-05): import { startCheckout } from '@/lib/actions/checkout'
// TODO (Plan 02-05): import { createPagarmeMswHandlers } from '../test-mocks/pagarme'

import { describe, it } from 'vitest';

describe('FORN-09: checkout — PIX', () => {
  it.todo('startCheckout(method="pix") returns qr_code + qr_code_url');
  it.todo('PIX path stores payment row with status="pending" + gateway_charge_id');
});

describe('FORN-09: checkout — credit_card installments', () => {
  it.todo('startCheckout(installments=1) returns expected installment_amount');
  it.todo('startCheckout(installments=6) computes installment_amount per parent platform rules');
  it.todo('startCheckout(installments=12) computes installment_amount per parent platform rules');
});
