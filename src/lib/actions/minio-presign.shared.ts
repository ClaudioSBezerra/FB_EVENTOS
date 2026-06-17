// FB_EVENTOS — Planta presign Server Action shared module (no 'use server').
//
// Constants + Zod schemas + types extracted from minio-presign.ts to satisfy
// Next.js 15's strict 'use server' rule.
//
// REFERENCES:
//   - src/lib/actions/minio-presign.ts (Server Action file consuming these)

import { z } from 'zod'

// ────────────────────────────────────────────────────────────────────────────
// Configuration constants — ORG-02 contract
// ────────────────────────────────────────────────────────────────────────────

export const PLANTA_MAX_BYTES = 200 * 1024 * 1024 // 200 MB (2026-06-17 operator request — plantas PDF de eventos grandes podem passar de 100 MB)
export const PLANTA_PUT_TTL_SECONDS = 300 // 5 min (D-05)
export const PLANTA_GET_TTL_SECONDS = 900 // 15 min (D-06)

/** Allowed MIME types for planta uploads — content-type lock allowlist. */
export const PLANTA_ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const
export type PlantaContentType = (typeof PLANTA_ALLOWED_CONTENT_TYPES)[number]

// ────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────────

export const mintPlantaUploadInput = z.object({
  eventId: z.uuid('Id de evento inválido'),
  fileName: z.string().trim().min(1, 'Nome do arquivo é obrigatório').max(255),
  contentType: z.enum(PLANTA_ALLOWED_CONTENT_TYPES),
  sizeBytes: z
    .number()
    .int('Tamanho deve ser inteiro')
    .min(1, 'Tamanho mínimo 1 byte')
    .max(PLANTA_MAX_BYTES, `Tamanho máximo é ${PLANTA_MAX_BYTES} bytes (200 MB)`),
})
export type MintPlantaUploadInput = z.infer<typeof mintPlantaUploadInput>

export const confirmPlantaUploadInput = z.object({
  eventId: z.uuid('Id de evento inválido'),
  key: z.string().trim().min(1).max(512),
})
export type ConfirmPlantaUploadInput = z.infer<typeof confirmPlantaUploadInput>

export const eventOnlyInput = z.object({
  eventId: z.uuid('Id de evento inválido'),
})

// ────────────────────────────────────────────────────────────────────────────
// Result shapes
// ────────────────────────────────────────────────────────────────────────────

export interface MintPlantaUploadResult {
  url: string
  key: string
  bucket: string
  expiresAt: string
  /** Echoes the content-type the browser MUST send on the PUT. */
  contentType: PlantaContentType
  sizeMaxBytes: number
}

export interface MintPlantaDownloadResult {
  url: string
  expiresAt: string
}

export interface ConfirmPlantaUploadResult {
  ok: true
  eventId: string
  key: string
  size: number
  contentType: PlantaContentType
}
