"use strict";
// FB_EVENTOS — BrasilAPI Server Action shared module (no 'use server').
//
// Constants + types extracted from brasilapi.ts to satisfy Next.js 15's
// strict 'use server' rule: files marked 'use server' may only export
// async functions. Constants, types, and interfaces live here instead.
//
// REFERENCES:
//   - src/lib/actions/brasilapi.ts (the Server Action file consuming these)
//   - 01-CONTEXT.md D-16 (2-layer + degrade)
Object.defineProperty(exports, "__esModule", { value: true });
exports.SITUACAO_ATIVA = exports.BRASILAPI_TIMEOUT_MS = exports.CNPJ_CACHE_TTL_DAYS = exports.BRASILAPI_BASE_URL = void 0;
// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
exports.BRASILAPI_BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1';
/** TTL of cached ATIVA responses. After this window we re-query BrasilAPI. */
exports.CNPJ_CACHE_TTL_DAYS = 7;
/** Hard timeout on BrasilAPI calls — beyond this we degrade. */
exports.BRASILAPI_TIMEOUT_MS = 5_000;
/** BrasilAPI situacao_cadastral enum: `2` means ATIVA (Receita Federal codes). */
exports.SITUACAO_ATIVA = 2;
