// FB_EVENTOS — Vendor Zod validators (Phase 1, Plan 01-04 — Task 2).
//
// Three composite schemas:
//
//   - vendorCreateSchema     — fields the organizadora fills on /[slug]/fornecedores/novo
//   - vendorUpdateSchema     — partial; id required (edit-mode form)
//   - vendorApprovalSchema   — approval FSM transition (approve | reject + reason)
//
// PII INVENTORY (LGPD-03, comments on columns installed in migration 0011):
//   - legal_name   (razão social)
//   - cnpj         (PII identifier)
//   - email        (contact)
//   - phone        (contact)
//
// CNPJ:
//   Uses `cnpjSchema` from src/lib/validators/cnpj.ts — accepts formatted
//   ("XX.XXX.XXX/XXXX-XX") OR 14 raw digits, validates mod-11 check digits,
//   normalizes to 14 digits on parse.
//
// BR phone regex (relaxed):
//   Accepts "+55 (62) 99999-0000", "(62) 99999-0000", "62999990000",
//   "+5562999990000". Phone-number completeness is NOT a hard contract in
//   Phase 1 — the form lets the user paste imperfect formats and we
//   normalize visually in the UI layer. We just refuse very short or very
//   long strings + obviously non-numeric characters.

import { z } from 'zod'

import { cnpjSchema } from './cnpj'

// ────────────────────────────────────────────────────────────────────────────
// Field-level primitives
// ────────────────────────────────────────────────────────────────────────────

// PII — razão social. Required.
const vendorLegalName = z
  .string()
  .trim()
  .min(2, 'Razão social precisa de pelo menos 2 caracteres')
  .max(200, 'Razão social deve ter no máximo 200 caracteres')

// Optional friendly name (nome fantasia).
const vendorTradeName = z
  .string()
  .trim()
  .max(200, 'Nome fantasia deve ter no máximo 200 caracteres')
  .optional()
  .nullable()

// PII — email.
const vendorEmail = z
  .string()
  .trim()
  .min(1, 'Email é obrigatório')
  .email('Email inválido')
  .max(254, 'Email muito longo')

// PII — phone (BR-flavored relaxed).
const vendorPhone = z
  .string()
  .trim()
  .max(20, 'Telefone deve ter no máximo 20 caracteres')
  .refine((v) => v === '' || /^[+()\-\s\d]{8,20}$/.test(v), {
    message: 'Telefone deve conter apenas dígitos, espaços, parênteses, traço e +',
  })
  .optional()
  .nullable()

// Free-form address (PII low-sensitivity).
const vendorAddress = z
  .string()
  .trim()
  .max(400, 'Endereço deve ter no máximo 400 caracteres')
  .optional()
  .nullable()

// Reason text (rejection notes / approval observations).
const vendorReason = z
  .string()
  .trim()
  .min(3, 'Motivo precisa de pelo menos 3 caracteres')
  .max(500, 'Motivo deve ter no máximo 500 caracteres')

// ────────────────────────────────────────────────────────────────────────────
// Composite schemas
// ────────────────────────────────────────────────────────────────────────────

export const vendorIdSchema = z.object({
  id: z.uuid('Id de fornecedor inválido'),
})
export type VendorIdInput = z.infer<typeof vendorIdSchema>

export const vendorCreateSchema = z.object({
  legalName: vendorLegalName,
  tradeName: vendorTradeName,
  cnpj: cnpjSchema,
  email: vendorEmail,
  phone: vendorPhone,
  address: vendorAddress,
})
export type VendorCreateInput = z.infer<typeof vendorCreateSchema>

export const vendorUpdateSchema = z.object({
  id: z.uuid('Id de fornecedor inválido'),
  legalName: vendorLegalName.optional(),
  tradeName: vendorTradeName.optional(),
  email: vendorEmail.optional(),
  phone: vendorPhone.optional(),
  address: vendorAddress.optional(),
})
export type VendorUpdateInput = z.infer<typeof vendorUpdateSchema>

export const vendorApprovalSchema = z
  .object({
    vendorId: z.uuid('Id de fornecedor inválido'),
    action: z.enum(['approve', 'reject']),
    reason: vendorReason.optional(),
  })
  .refine(
    (data) => {
      // Rejection requires an explicit reason — fornecedor gets emailed
      // with the rationale (D-15 email template `rejeicao_fornecedor`).
      if (data.action === 'reject') return typeof data.reason === 'string' && data.reason.length > 0
      return true
    },
    {
      message: 'Motivo é obrigatório ao rejeitar fornecedor',
      path: ['reason'],
    },
  )
export type VendorApprovalInput = z.infer<typeof vendorApprovalSchema>

export const vendorListInputSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  search: z.string().trim().max(200).optional(),
})
export type VendorListInput = z.infer<typeof vendorListInputSchema>
