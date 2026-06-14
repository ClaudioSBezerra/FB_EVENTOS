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

import { aprovacaoFornecedor } from './aprovacao-fornecedor'
import { contratoAssinado } from './contrato-assinado'
import { contratoEmitido } from './contrato-emitido'
import { pagamentoRecebido } from './pagamento-recebido'
import { rejeicaoFornecedor } from './rejeicao-fornecedor'
import type { TemplateOutput } from './shared'
import { signupFornecedor } from './signup-fornecedor'

export type VendorEmailEvent =
  | 'signup_fornecedor'
  | 'aprovacao_fornecedor'
  | 'rejecao_fornecedor'
  | 'contrato_emitido'
  | 'contrato_assinado'
  | 'pagamento_recebido'

/**
 * Untyped registry — each template accepts a different shape of data.
 * The handler validates via Zod per-event before dispatching here.
 */
// biome-ignore lint/suspicious/noExplicitAny: per-template payload shapes diverge — Zod-validated upstream
export const templateRegistry: Record<VendorEmailEvent, (data: any) => TemplateOutput> = {
  signup_fornecedor: signupFornecedor,
  aprovacao_fornecedor: aprovacaoFornecedor,
  // The codebase uses 'rejecao_fornecedor' (rejecao, no 'i') — matches
  // Plan 01-04 stub + tests/fornecedores/notifications.test.ts. The
  // template filename uses the more readable 'rejeicao' spelling but the
  // event key sticks with the existing key to avoid touching upstream
  // enqueue sites in Plans 01-04..01-06.
  rejecao_fornecedor: rejeicaoFornecedor,
  contrato_emitido: contratoEmitido,
  contrato_assinado: contratoAssinado,
  pagamento_recebido: pagamentoRecebido,
}

export { CANONICAL_DOMAIN } from './shared'
export type { TemplateOutput }
export {
  aprovacaoFornecedor,
  contratoAssinado,
  contratoEmitido,
  pagamentoRecebido,
  rejeicaoFornecedor,
  signupFornecedor,
}
