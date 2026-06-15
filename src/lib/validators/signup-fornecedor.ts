// FB_EVENTOS — Signup Fornecedor Zod validator (Phase 2, Plan 02-02).
//
// Validates the public fornecedor self-service signup form at
// /{slug}/fornecedor/cadastro (D-21).
//
// Key constraints:
//   - password min 10 chars (softer than organizadora min 12 for UX)
//   - cnpj: reuses Phase 1 cnpjSchema (Layer 1 mod-11)
//   - phone: relaxed BR pattern (same as vendorPhone in vendor.ts)
//   - consents.payment_data: MUST be true (z.literal(true)) — T-02-02-02
//     tamper mitigation: even if client strips the flag, Zod blocks it
//
// REFERENCES:
//   - 02-CONTEXT.md D-21 D-23 D-24
//   - 02-02-PLAN.md Task 1 <action> — Zod schema spec
//   - src/lib/validators/vendor.ts (vendorPhone + vendorLegalName patterns)

import { z } from 'zod'
import { cnpjSchema } from './cnpj'

export const LGPD_CONSENT_VERSION_V2 = '2026-06-15'

export const LGPD_CONSENT_TEXTS = {
  marketing:
    'Autorizo o uso dos meus dados para comunicações de marketing da FB_EVENTOS (LGPD Art. 7, IX). Revogável a qualquer momento via /portal/consentimento.',
  analytics:
    'Autorizo o uso dos meus dados para análise de uso e melhoria da plataforma FB_EVENTOS (LGPD Art. 7, IX). Revogável a qualquer momento via /portal/consentimento.',
  payment_data:
    'Autorizo o processamento dos meus dados de pagamento pelo gateway Pagar.me para viabilizar transações na plataforma FB_EVENTOS (LGPD Art. 7, V — execução de contrato). Necessário para concluir compras.',
}

export const signupFornecedorSchema = z.object({
  email: z.email('Email inválido'),
  password: z.string().min(10, 'Senha deve ter ao menos 10 caracteres'),
  name: z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres'),
  legalName: z.string().trim().min(2, 'Razão social precisa de pelo menos 2 caracteres').max(200),
  tradeName: z
    .string()
    .trim()
    .max(200, 'Nome fantasia deve ter no máximo 200 caracteres')
    .optional()
    .nullable(),
  cnpj: cnpjSchema,
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === '' || /^[+()\-\s\d]{8,20}$/.test(v), {
      message: 'Telefone deve conter apenas dígitos, espaços, parênteses, traço e +',
    })
    .optional()
    .nullable(),
  consents: z.object({
    marketing: z.boolean(),
    analytics: z.boolean(),
    // T-02-02-02 mitigation: server-side enforces payment_data must be true
    payment_data: z.literal(true, {
      message: 'O consentimento para dados de pagamento é obrigatório para completar o cadastro',
    }),
  }),
})

export type SignupFornecedorSchema = z.infer<typeof signupFornecedorSchema>
