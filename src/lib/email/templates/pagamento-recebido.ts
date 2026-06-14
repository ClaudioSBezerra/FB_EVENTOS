// FB_EVENTOS — Email template: pagamento_recebido
// (Phase 1, Plan 01-08 — ORG-17 / ORG-12 template #6).
//
// Sent when Pagar.me webhook reports order.paid (pagarme webhook
// → email.send-status-update job — Plan 01-06).
//
// Recipients: BOTH organizadora user and vendor.email.

import { CANONICAL_DOMAIN, escapeHtml, type TemplateOutput } from './shared'

export interface PagamentoRecebidoData {
  recipientName: string
  tenantName: string
  tenantSlug: string
  contractRef: string
  amountBRL: string
  paymentId: string
}

export function pagamentoRecebido(data: PagamentoRecebidoData): TemplateOutput {
  const receiptUrl = `${CANONICAL_DOMAIN}/${data.tenantSlug}/pagamentos/${data.paymentId}`
  const subject = `[${data.tenantName}] Pagamento confirmado — contrato ${data.contractRef}`
  const text =
    `Olá ${data.recipientName},\n\n` +
    `Recebemos o pagamento referente ao contrato ${data.contractRef} ` +
    `do evento ${data.tenantName}.\n\n` +
    `Valor: ${data.amountBRL}\n` +
    `Comprovante: ${receiptUrl}\n\n` +
    `Obrigado por escolher a FB_EVENTOS.\n\n` +
    `— Equipe FB_EVENTOS`
  const html =
    `<p>Olá <strong>${escapeHtml(data.recipientName)}</strong>,</p>` +
    `<p>Recebemos o pagamento referente ao contrato <strong>${escapeHtml(data.contractRef)}</strong> ` +
    `do evento <strong>${escapeHtml(data.tenantName)}</strong>.</p>` +
    `<p><strong>Valor:</strong> ${escapeHtml(data.amountBRL)}<br>` +
    `<strong>Comprovante:</strong> <a href="${receiptUrl}">${receiptUrl}</a></p>` +
    `<p>Obrigado por escolher a FB_EVENTOS.</p>` +
    `<p>— Equipe FB_EVENTOS</p>`
  return { subject, text, html }
}
