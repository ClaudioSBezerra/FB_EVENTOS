// FB_EVENTOS — Vendor docs Server Action shared module (no 'use server').
//
// Constants + Zod schemas + types extracted from vendor-docs.ts to satisfy
// Next.js 15's strict 'use server' rule.
//
// REFERENCES:
//   - src/lib/actions/vendor-docs.ts (Server Action file consuming these)

import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────────────
// Configuration — ORG-15 contract
// ────────────────────────────────────────────────────────────────────────────

export const VENDOR_DOC_MAX_BYTES = 25 * 1024 * 1024 // 25 MB
export const VENDOR_DOC_PUT_TTL_SECONDS = 300 // 5 min (D-05)
export const VENDOR_DOC_GET_TTL_SECONDS = 900 // 15 min (D-06)

export const VENDOR_DOC_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const
export type VendorDocContentType = (typeof VENDOR_DOC_ALLOWED_CONTENT_TYPES)[number]

// ────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────────

export const mintVendorDocUploadInput = z.object({
  vendorId: z.uuid('Id de fornecedor inválido'),
  fileName: z.string().trim().min(1, 'Nome do arquivo é obrigatório').max(255),
  contentType: z.enum(VENDOR_DOC_ALLOWED_CONTENT_TYPES),
  sizeBytes: z
    .number()
    .int('Tamanho deve ser inteiro')
    .min(1, 'Tamanho mínimo 1 byte')
    .max(VENDOR_DOC_MAX_BYTES, `Tamanho máximo é ${VENDOR_DOC_MAX_BYTES} bytes (25 MB)`),
})
export type MintVendorDocUploadInput = z.infer<typeof mintVendorDocUploadInput>

export const confirmVendorDocUploadInput = z.object({
  vendorId: z.uuid('Id de fornecedor inválido'),
  key: z.string().trim().min(1).max(512),
  docType: z
    .string()
    .trim()
    .min(1, 'Tipo de documento é obrigatório')
    .max(80, 'Tipo de documento muito longo'),
})
export type ConfirmVendorDocUploadInput = z.infer<typeof confirmVendorDocUploadInput>

export const vendorDocScopeInput = z.object({
  vendorId: z.uuid('Id de fornecedor inválido'),
})
export type VendorDocScopeInput = z.infer<typeof vendorDocScopeInput>

export const vendorDocIdInput = z.object({
  docId: z.uuid('Id de documento inválido'),
})
export type VendorDocIdInput = z.infer<typeof vendorDocIdInput>

// ────────────────────────────────────────────────────────────────────────────
// Result shapes
// ────────────────────────────────────────────────────────────────────────────

export interface MintVendorDocUploadResult {
  url: string
  key: string
  bucket: string
  expiresAt: string
  contentType: VendorDocContentType
  sizeMaxBytes: number
}

export interface MintVendorDocDownloadResult {
  url: string
  expiresAt: string
}

export interface ConfirmVendorDocUploadResult {
  ok: true
  docId: string
  key: string
  size: number
  contentType: VendorDocContentType
}

export interface PersistedVendorDoc {
  id: string
  tenantId: string
  vendorId: string
  minioKey: string
  contentType: string | null
  sizeBytes: number | null
  docType: string
  uploadedAt: Date
}
