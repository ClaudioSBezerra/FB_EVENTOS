"use strict";
// FB_EVENTOS — Contract template registry (Phase 1, Plan 01-05 Task 1).
//
// Maps `contracts.template_version` (text) → renderer + metadata. Adding a
// new template = a new file `<key>.tsx` + a new entry here + a new row in
// `contract_template_versions` (seeded via migration). D-08 invariant.
//
// The registry is intentionally a tiny module — no DB lookup, no I/O. The
// PDF generator (src/contracts/generate-pdf.ts) calls `getTemplate(version)`
// to look up the React component to feed into `renderToBuffer(...)`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORNECEDOR_STAND_V1_VERSION = exports.TEMPLATE_REGISTRY = void 0;
exports.getTemplate = getTemplate;
const fornecedor_stand_v1_1 = require("./fornecedor-stand-v1");
Object.defineProperty(exports, "FORNECEDOR_STAND_V1_VERSION", { enumerable: true, get: function () { return fornecedor_stand_v1_1.FORNECEDOR_STAND_V1_VERSION; } });
exports.TEMPLATE_REGISTRY = {
    [fornecedor_stand_v1_1.FORNECEDOR_STAND_V1_VERSION]: {
        version: fornecedor_stand_v1_1.FORNECEDOR_STAND_V1_VERSION,
        description: 'Contrato de cessão de espaço — Fornecedor / Stand (v1, pt-BR)',
        Component: fornecedor_stand_v1_1.FornecedorStandV1,
    },
};
function getTemplate(version) {
    return exports.TEMPLATE_REGISTRY[version] ?? null;
}
