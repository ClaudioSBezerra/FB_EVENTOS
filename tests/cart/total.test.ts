// FB_EVENTOS — FORN-08: cart total math (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-05. See VALIDATION.md row FORN-08.
//
// TODO (Plan 02-05): import { computeCartTotal } from '@/lib/actions/cart'

import { describe, it } from 'vitest';

describe('FORN-08: cart total = lot_price + Σ add-on lines', () => {
  it.todo('cart with no add-ons → total = lot price');
  it.todo('cart with one add-on (qty=2) → total = lot price + 2 × snapshot price');
  it.todo('cart with multiple add-ons → total = lot price + Σ(qty × snapshot price)');
  it.todo('snapshot price (not current addon price) used after addon price change');
});
