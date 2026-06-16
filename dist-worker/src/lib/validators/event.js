"use strict";
// FB_EVENTOS — Event Zod validators (Phase 1, Plan 01-02 — Task 1).
//
// Three schemas:
//
//   - eventCreateSchema  — the create-event form payload.
//   - eventUpdateSchema  — partial update payload (id required, all else
//                          optional).
//   - eventIdSchema      — uuid identifier (for delete / detail fetches).
//
// Fields (from PLAN.md ORG-01):
//   - name           1..120 chars
//   - startsAt       ISO datetime, today-or-later
//   - endsAt         ISO datetime, MUST be > startsAt
//   - placeName      1..200 chars
//   - placeAddress   PII; 1..400 chars (low-sensitivity venue address)
//   - capacity       int 1..1_000_000
//   - timezone       IANA timezone string (default 'America/Sao_Paulo')
//   - currency       enum (Phase 1 = ['BRL']) — locked to a single value to
//                    avoid surface area until Phase 4 multi-currency lands.
//
// IMPORTANT:
//   The cross-field check (endsAt > startsAt) lives in a `.refine()` on the
//   parent object — not on the endsAt field — so Zod can compare the two
//   parsed values together. This matches the Phase 0 signup-form pattern
//   for the consent literal.
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventUpdateSchema = exports.eventCreateSchema = exports.eventIdSchema = void 0;
const zod_1 = require("zod");
// ────────────────────────────────────────────────────────────────────────────
// Field-level primitives
// ────────────────────────────────────────────────────────────────────────────
const eventName = zod_1.z
    .string()
    .trim()
    .min(1, 'Nome do evento é obrigatório')
    .max(120, 'Nome do evento deve ter no máximo 120 caracteres');
const eventPlaceName = zod_1.z
    .string()
    .trim()
    .min(1, 'Nome do local é obrigatório')
    .max(200, 'Nome do local deve ter no máximo 200 caracteres');
// PII — annotated via COMMENT ON COLUMN in migration 0011 (Plan 01-01).
const eventPlaceAddress = zod_1.z
    .string()
    .trim()
    .min(1, 'Endereço do local é obrigatório')
    .max(400, 'Endereço do local deve ter no máximo 400 caracteres');
const eventCapacity = zod_1.z
    .number()
    .int('Capacidade deve ser um número inteiro')
    .min(1, 'Capacidade mínima é 1 pessoa')
    .max(1_000_000, 'Capacidade máxima é 1.000.000 pessoas');
// IANA timezone (loose check — full IANA validation requires Intl.DateTimeFormat
// at parse time; the canonical default is America/Sao_Paulo per CLAUDE.md).
const eventTimezone = zod_1.z
    .string()
    .trim()
    .min(3, 'Timezone IANA inválido')
    .max(64, 'Timezone IANA muito longo')
    .default('America/Sao_Paulo');
// Phase 1 locked to BRL (D-13 — pilot is in Brazil; expansion later).
const eventCurrency = zod_1.z.enum(['BRL']).default('BRL');
/**
 * Accept either an ISO 8601 string (form submit / wire format) or a real
 * `Date` (Server Component pre-population). Both coerce to `Date`.
 *
 * NOTE: We intentionally do NOT enforce future-only at field level; the
 * cross-field refine below enforces `endsAt > startsAt` and the page-level
 * validation can layer a "starts today or later" UX constraint where needed.
 * Tests that seed historical events (1970s) for retention assertions must
 * still work via the factory, which bypasses the Server Action layer.
 */
const eventDate = zod_1.z
    .union([zod_1.z.string().datetime({ offset: true }), zod_1.z.string().datetime(), zod_1.z.date()])
    .transform((v) => (v instanceof Date ? v : new Date(v)));
// ────────────────────────────────────────────────────────────────────────────
// Composite schemas
// ────────────────────────────────────────────────────────────────────────────
exports.eventIdSchema = zod_1.z.object({
    id: zod_1.z.uuid('Id de evento inválido'),
});
exports.eventCreateSchema = zod_1.z
    .object({
    name: eventName,
    startsAt: eventDate,
    endsAt: eventDate,
    placeName: eventPlaceName,
    placeAddress: eventPlaceAddress,
    capacity: eventCapacity,
    timezone: eventTimezone,
    currency: eventCurrency,
})
    .refine((data) => data.endsAt.getTime() > data.startsAt.getTime(), {
    message: 'Data de término deve ser posterior à data de início',
    path: ['endsAt'],
});
exports.eventUpdateSchema = zod_1.z
    .object({
    id: zod_1.z.uuid('Id de evento inválido'),
    name: eventName.optional(),
    startsAt: eventDate.optional(),
    endsAt: eventDate.optional(),
    placeName: eventPlaceName.optional(),
    placeAddress: eventPlaceAddress.optional(),
    capacity: eventCapacity.optional(),
    timezone: eventTimezone.optional(),
    currency: eventCurrency.optional(),
})
    .refine((data) => {
    if (data.startsAt && data.endsAt) {
        return data.endsAt.getTime() > data.startsAt.getTime();
    }
    return true;
}, {
    message: 'Data de término deve ser posterior à data de início',
    path: ['endsAt'],
});
