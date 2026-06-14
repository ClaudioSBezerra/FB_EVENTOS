// FB_EVENTOS — Email template: contrato_assinado
// (Phase 1, Plan 01-08 — ORG-17 / D-15 template #5).
//
// Sent when ZapSign reports both signers have signed (zapsign webhook
// → email.send-status-update job — Plan 01-05).
//
// Recipients: BOTH organizadora user and vendor.email — same template
// rendered twice (handler resolves the two addresses + sends two emails).
//
// Audience addressed in second person — works for both organizadora and
// fornecedor reading the message.

import { CANONICAL_DOMAIN, escapeHtml, type TemplateOutput } from './shared'

export interface ContratoAssinadoData {
  recipientName: string
  tenantName: string
  tenantSlug: string
  contractRef: string
}

export function contratoAssinado(data: ContratoAssinadoData): TemplateOutput {
  const contractsUrl = `${CANONICAL_DOMAIN}/${data.tenantSlug}/contratos/${data.contractRef}`
  const subject = `[${data.tenantName}] Contrato ${data.contractRef} totalmente assinado`
  const text =
    `Olá ${data.recipientName},\n\n` +
    `Todas as partes assinaram o contrato ${data.contractRef} do evento ` +
    `${data.tenantName}.\n\n` +
    `Faça o download da versão final em: ${contractsUrl}\n\n` +
    `O próximo passo é o pagamento — se você é o fornecedor, em breve receberá ` +
    `o link de cobrança PIX/cartão.\n\n` +
    `— Equipe FB_EVENTOS`
  const html =
    `<p>Olá <strong>${escapeHtml(data.recipientName)}</strong>,</p>` +
    `<p>Todas as partes assinaram o contrato <strong>${escapeHtml(data.contractRef)}</strong> ` +
    `do evento <strong>${escapeHtml(data.tenantName)}</strong>.</p>` +
    `<p>Faça o download da versão final em: <a href="${contractsUrl}">${contractsUrl}</a></p>` +
    `<p>O próximo passo é o pagamento — se você é o fornecedor, em breve receberá ` +
    `o link de cobrança PIX/cartão.</p>` +
    `<p>— Equipe FB_EVENTOS</p>`
  return { subject, text, html }
}
