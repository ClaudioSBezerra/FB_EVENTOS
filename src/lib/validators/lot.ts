// FB_EVENTOS — Lot Zod validators (Phase 1, Plan 01-03 — Task 1).
//
// Schemas:
//   - lotCreateSchema       — create a lot (caller supplies eventId, categoryId,
//                             code, geometry; area_m² is RE-COMPUTED server-side
//                             from polygon points via shoelace — never trust
//                             client-supplied area).
//   - lotUpdateGeometrySchema — auto-save partial: { lotId, geometry }.
//   - lotIdSchema           — uuid identifier (for delete + assignment lookups).
//
// Code uniqueness: enforced per-event in DB layer; Zod just validates shape
// (1..40 chars, ascii printable). Empty / blank codes rejected.

import { z } from 'zod'
import { geometrySchema } from './geometry'

const lotCode = z
  .string()
  .trim()
  .min(1, 'Código do lote é obrigatório')
  .max(40, 'Código do lote deve ter no máximo 40 caracteres')
  .regex(/^[\w\- ./]+$/, 'Código do lote contém caracteres inválidos')

const lotStatus = z.enum(['available', 'reserved', 'sold'])

export const lotCreateSchema = z.object({
  eventId: z.uuid('Id de evento inválido'),
  categoryId: z.uuid('Id de categoria inválido'),
  code: lotCode,
  geometry: geometrySchema,
})
export type LotCreateInput = z.infer<typeof lotCreateSchema>

export const lotUpdateGeometrySchema = z.object({
  lotId: z.uuid('Id de lote inválido'),
  geometry: geometrySchema,
})
export type LotUpdateGeometryInput = z.infer<typeof lotUpdateGeometrySchema>

export const lotIdSchema = z.object({
  lotId: z.uuid('Id de lote inválido'),
})
export type LotIdInput = z.infer<typeof lotIdSchema>

export const lotEventScopeSchema = z.object({
  eventId: z.uuid('Id de evento inválido'),
})
export type LotEventScopeInput = z.infer<typeof lotEventScopeSchema>

export const lotUpdateStatusSchema = z.object({
  lotId: z.uuid('Id de lote inválido'),
  status: lotStatus,
})
export type LotUpdateStatusInput = z.infer<typeof lotUpdateStatusSchema>
