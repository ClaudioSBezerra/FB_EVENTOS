// FB_EVENTOS — Fornecedor Server Action shared module (no 'use server').
//
// Constants + types extracted from fornecedores.ts to satisfy Next.js 15's
// strict 'use server' rule: files marked 'use server' may only export
// async functions.
//
// REFERENCES:
//   - src/lib/actions/fornecedores.ts (Server Action file consuming these)
//   - 01-CONTEXT.md (FORN-01 vendor row contract)

// ────────────────────────────────────────────────────────────────────────────
// Email job task name — handler lands in Plan 01-08
// ────────────────────────────────────────────────────────────────────────────

export const EMAIL_STATUS_UPDATE_TASK = 'email.send-status-update'

export type VendorEmailEvent = 'signup_fornecedor' | 'aprovacao_fornecedor' | 'rejecao_fornecedor'

// ────────────────────────────────────────────────────────────────────────────
// Persisted row shape
// ────────────────────────────────────────────────────────────────────────────

export interface PersistedVendor {
  id: string
  tenantId: string
  legalName: string
  tradeName: string | null
  cnpj: string
  cnpjVerified: boolean
  cnpjCheckedAt: Date | null
  email: string
  phone: string | null
  status: string
  approvalReason: string | null
  createdAt: Date
  updatedAt: Date
}
