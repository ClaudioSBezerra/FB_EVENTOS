"use strict";
// FB_EVENTOS — Vendor docs Server Action shared module (no 'use server').
//
// Constants + Zod schemas + types extracted from vendor-docs.ts to satisfy
// Next.js 15's strict 'use server' rule.
//
// REFERENCES:
//   - src/lib/actions/vendor-docs.ts (Server Action file consuming these)
Object.defineProperty(exports, "__esModule", { value: true });
exports.vendorDocIdInput = exports.vendorDocScopeInput = exports.confirmVendorDocUploadInput = exports.mintVendorDocUploadInput = exports.VENDOR_DOC_ALLOWED_CONTENT_TYPES = exports.VENDOR_DOC_GET_TTL_SECONDS = exports.VENDOR_DOC_PUT_TTL_SECONDS = exports.VENDOR_DOC_MAX_BYTES = void 0;
const zod_1 = require("zod");
// ────────────────────────────────────────────────────────────────────────────
// Configuration — ORG-15 contract
// ────────────────────────────────────────────────────────────────────────────
exports.VENDOR_DOC_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
exports.VENDOR_DOC_PUT_TTL_SECONDS = 300; // 5 min (D-05)
exports.VENDOR_DOC_GET_TTL_SECONDS = 900; // 15 min (D-06)
exports.VENDOR_DOC_ALLOWED_CONTENT_TYPES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
];
// ────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ────────────────────────────────────────────────────────────────────────────
exports.mintVendorDocUploadInput = zod_1.z.object({
    vendorId: zod_1.z.uuid('Id de fornecedor inválido'),
    fileName: zod_1.z.string().trim().min(1, 'Nome do arquivo é obrigatório').max(255),
    contentType: zod_1.z.enum(exports.VENDOR_DOC_ALLOWED_CONTENT_TYPES),
    sizeBytes: zod_1.z
        .number()
        .int('Tamanho deve ser inteiro')
        .min(1, 'Tamanho mínimo 1 byte')
        .max(exports.VENDOR_DOC_MAX_BYTES, `Tamanho máximo é ${exports.VENDOR_DOC_MAX_BYTES} bytes (25 MB)`),
});
exports.confirmVendorDocUploadInput = zod_1.z.object({
    vendorId: zod_1.z.uuid('Id de fornecedor inválido'),
    key: zod_1.z.string().trim().min(1).max(512),
    docType: zod_1.z
        .string()
        .trim()
        .min(1, 'Tipo de documento é obrigatório')
        .max(80, 'Tipo de documento muito longo'),
});
exports.vendorDocScopeInput = zod_1.z.object({
    vendorId: zod_1.z.uuid('Id de fornecedor inválido'),
});
exports.vendorDocIdInput = zod_1.z.object({
    docId: zod_1.z.uuid('Id de documento inválido'),
});
