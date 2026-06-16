"use strict";
// FB_EVENTOS — Email template registry
// (Phase 1, Plan 01-08 — ORG-17).
//
// Single source-of-truth for all six pt-BR Resend templates. The Graphile-
// Worker task `email.send-status-update` (src/jobs/tasks/email-send-status-
// update.ts) reads `payload.event` and dispatches into this registry to
// resolve the right template function.
//
// CONTRACT (pinned by tests/email/templates.test.ts):
//   - Every template returns {subject, text, html?} with non-empty strings.
//   - Every link in subject/text/html matches https://eventos.fbtax.cloud/...
//   - All templates are worker-safe (no DOM, no JSX runtime).
//
// To add a new template (Phase 2+): create the file, import here, register
// the key on `templateRegistry`, and extend `VendorEmailEvent`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.signupFornecedor = exports.rejeicaoFornecedor = exports.pagamentoRecebido = exports.contratoEmitido = exports.contratoAssinado = exports.aprovacaoFornecedor = exports.CANONICAL_DOMAIN = exports.templateRegistry = void 0;
const aprovacao_fornecedor_1 = require("./aprovacao-fornecedor");
Object.defineProperty(exports, "aprovacaoFornecedor", { enumerable: true, get: function () { return aprovacao_fornecedor_1.aprovacaoFornecedor; } });
const contrato_assinado_1 = require("./contrato-assinado");
Object.defineProperty(exports, "contratoAssinado", { enumerable: true, get: function () { return contrato_assinado_1.contratoAssinado; } });
const contrato_emitido_1 = require("./contrato-emitido");
Object.defineProperty(exports, "contratoEmitido", { enumerable: true, get: function () { return contrato_emitido_1.contratoEmitido; } });
const pagamento_recebido_1 = require("./pagamento-recebido");
Object.defineProperty(exports, "pagamentoRecebido", { enumerable: true, get: function () { return pagamento_recebido_1.pagamentoRecebido; } });
const rejeicao_fornecedor_1 = require("./rejeicao-fornecedor");
Object.defineProperty(exports, "rejeicaoFornecedor", { enumerable: true, get: function () { return rejeicao_fornecedor_1.rejeicaoFornecedor; } });
const signup_fornecedor_1 = require("./signup-fornecedor");
Object.defineProperty(exports, "signupFornecedor", { enumerable: true, get: function () { return signup_fornecedor_1.signupFornecedor; } });
/**
 * Untyped registry — each template accepts a different shape of data.
 * The handler validates via Zod per-event before dispatching here.
 */
// biome-ignore lint/suspicious/noExplicitAny: per-template payload shapes diverge — Zod-validated upstream
exports.templateRegistry = {
    signup_fornecedor: signup_fornecedor_1.signupFornecedor,
    aprovacao_fornecedor: aprovacao_fornecedor_1.aprovacaoFornecedor,
    // The codebase uses 'rejecao_fornecedor' (rejecao, no 'i') — matches
    // Plan 01-04 stub + tests/fornecedores/notifications.test.ts. The
    // template filename uses the more readable 'rejeicao' spelling but the
    // event key sticks with the existing key to avoid touching upstream
    // enqueue sites in Plans 01-04..01-06.
    rejecao_fornecedor: rejeicao_fornecedor_1.rejeicaoFornecedor,
    contrato_emitido: contrato_emitido_1.contratoEmitido,
    contrato_assinado: contrato_assinado_1.contratoAssinado,
    pagamento_recebido: pagamento_recebido_1.pagamentoRecebido,
};
var shared_1 = require("./shared");
Object.defineProperty(exports, "CANONICAL_DOMAIN", { enumerable: true, get: function () { return shared_1.CANONICAL_DOMAIN; } });
