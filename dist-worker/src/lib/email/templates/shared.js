"use strict";
// FB_EVENTOS — Shared template primitives
// (Phase 1, Plan 01-08 — ORG-17).
//
// `CANONICAL_DOMAIN` is the production-canonical link host used in EVERY
// pt-BR email template. Hostinger DNS points eventos.fbtax.cloud at the
// Coolify deployment. Tests assert all links match this host so a stale
// localhost URL never ships to a real fornecedor inbox.
//
// `TemplateOutput` is the uniform return shape every template MUST emit.
// Worker-safe (no DOM, no React) — plain TS module that returns strings.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_DOMAIN = void 0;
exports.escapeHtml = escapeHtml;
exports.CANONICAL_DOMAIN = 'https://eventos.fbtax.cloud';
/** Minimal HTML-entity escaper for tenant/vendor names rendered into <p> bodies. */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
