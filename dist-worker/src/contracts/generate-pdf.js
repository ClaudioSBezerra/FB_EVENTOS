"use strict";
// FB_EVENTOS — PDF generation helper (Phase 1, Plan 01-05 Task 1).
//
// Thin shim around @react-pdf/renderer's `renderToBuffer(<Component .../>)`
// that dispatches on `template_version` via the registry in
// `src/contracts/templates/index.ts`.
//
// IMPORTANT — worker safety (D-07, ADR-0004):
//   - `renderToBuffer` runs in plain Node (no DOM, no browser globals). The
//     Graphile-Worker process (tsconfig.worker.json) consumes this file
//     directly.
//   - We import from the package root — @react-pdf/renderer auto-selects
//     the Node entry. If a future regression breaks that, fall back to
//     `@react-pdf/renderer/lib/node` (documented escape hatch in RESEARCH
//     §A6 Pitfalls).
//
// The caller (job handler) builds the param object from a tenant-scoped
// JOIN; this module performs no DB access.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnknownTemplateVersionError = void 0;
exports.generateContractPdf = generateContractPdf;
const renderer_1 = require("@react-pdf/renderer");
const react_1 = require("react");
const templates_1 = require("./templates");
class UnknownTemplateVersionError extends Error {
    constructor(version) {
        super(`Unknown contract template_version: "${version}"`);
        this.name = 'UnknownTemplateVersionError';
    }
}
exports.UnknownTemplateVersionError = UnknownTemplateVersionError;
/**
 * Render a contract PDF to a Buffer using the registered template for
 * `templateVersion`. Throws UnknownTemplateVersionError if the version is
 * not registered in TEMPLATE_REGISTRY.
 *
 * The returned Buffer is ready to upload to MinIO (no further wrapping
 * needed).
 */
async function generateContractPdf(input) {
    const tpl = (0, templates_1.getTemplate)(input.templateVersion);
    if (!tpl)
        throw new UnknownTemplateVersionError(input.templateVersion);
    // The registry intentionally holds `any` for Component because each
    // template has a unique params shape — @react-pdf/renderer's
    // `renderToBuffer` expects a Document element. Cast at the boundary;
    // the runtime contract is the Document JSX returned by every template.
    const element = (0, react_1.createElement)(tpl.Component, { params: input.params });
    // biome-ignore lint/suspicious/noExplicitAny: renderToBuffer's element type is constrained to Document — we satisfy it at runtime
    const buffer = await (0, renderer_1.renderToBuffer)(element);
    // @react-pdf/renderer returns a NodeJS Buffer in node mode. Be defensive
    // — if a future version returns a Uint8Array, coerce to Buffer so the
    // contract with MinIO `putObject(..., body: Buffer | string, ...)` holds.
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}
