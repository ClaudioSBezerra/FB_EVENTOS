"use strict";
// FB_EVENTOS — Planta presign Server Action shared module (no 'use server').
//
// Constants + Zod schemas + types extracted from minio-presign.ts to satisfy
// Next.js 15's strict 'use server' rule.
//
// REFERENCES:
//   - src/lib/actions/minio-presign.ts (Server Action file consuming these)
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventOnlyInput = exports.confirmPlantaUploadInput = exports.mintPlantaUploadInput = exports.PLANTA_ALLOWED_CONTENT_TYPES = exports.PLANTA_GET_TTL_SECONDS = exports.PLANTA_PUT_TTL_SECONDS = exports.PLANTA_MAX_BYTES = void 0;
const zod_1 = require("zod");
// ────────────────────────────────────────────────────────────────────────────
// Configuration constants — ORG-02 contract
// ────────────────────────────────────────────────────────────────────────────
exports.PLANTA_MAX_BYTES = 25 * 1024 * 1024; // 25 MB (ORG-02)
exports.PLANTA_PUT_TTL_SECONDS = 300; // 5 min (D-05)
exports.PLANTA_GET_TTL_SECONDS = 900; // 15 min (D-06)
/** Allowed MIME types for planta uploads — content-type lock allowlist. */
exports.PLANTA_ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
// ────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────────
exports.mintPlantaUploadInput = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
    fileName: zod_1.z.string().trim().min(1, 'Nome do arquivo é obrigatório').max(255),
    contentType: zod_1.z.enum(exports.PLANTA_ALLOWED_CONTENT_TYPES),
    sizeBytes: zod_1.z
        .number()
        .int('Tamanho deve ser inteiro')
        .min(1, 'Tamanho mínimo 1 byte')
        .max(exports.PLANTA_MAX_BYTES, `Tamanho máximo é ${exports.PLANTA_MAX_BYTES} bytes (25 MB)`),
});
exports.confirmPlantaUploadInput = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
    key: zod_1.z.string().trim().min(1).max(512),
});
exports.eventOnlyInput = zod_1.z.object({
    eventId: zod_1.z.uuid('Id de evento inválido'),
});
