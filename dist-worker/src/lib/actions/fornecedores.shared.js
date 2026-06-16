"use strict";
// FB_EVENTOS — Fornecedor Server Action shared module (no 'use server').
//
// Constants + types extracted from fornecedores.ts to satisfy Next.js 15's
// strict 'use server' rule: files marked 'use server' may only export
// async functions.
//
// REFERENCES:
//   - src/lib/actions/fornecedores.ts (Server Action file consuming these)
//   - 01-CONTEXT.md (FORN-01 vendor row contract)
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMAIL_STATUS_UPDATE_TASK = void 0;
// ────────────────────────────────────────────────────────────────────────────
// Email job task name — handler lands in Plan 01-08
// ────────────────────────────────────────────────────────────────────────────
exports.EMAIL_STATUS_UPDATE_TASK = 'email.send-status-update';
