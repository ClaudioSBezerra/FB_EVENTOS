// FB_EVENTOS — FORN-01: fornecedor signup integration (Wave 0 scaffold, Plan 02-01).
// Filled in by Plan 02-02. See .planning/phases/02-.../02-VALIDATION.md row FORN-01.
//
// TODO (Plan 02-02): import { signupFornecedor } from '@/lib/actions/signup-fornecedor'

import { describe, it } from 'vitest';

describe('FORN-01: fornecedor signup', () => {
  it.todo(
    'POST /[slug]/fornecedor/cadastro creates vendor + Better Auth member rows under tenant'
  );
  it.todo('cross-tenant: vendor created in tenant A is invisible to tenant B');
  it.todo('duplicate CNPJ in same tenant returns 409');
});
