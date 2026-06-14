// FB_EVENTOS — Email template: rejecao_fornecedor
// (Phase 1, Plan 01-08 — ORG-17 / D-15 template #3).
//
// Sent when an organizadora rejects a vendor (rejectVendor Server Action).
// Recipient: vendor.email.
//
// LGPD note: reason is a free-text field that may be quoted back to the
// fornecedor — escaped for HTML body, kept verbatim in text body.

import { CANONICAL_DOMAIN, escapeHtml, type TemplateOutput } from './shared'

export interface RejeicaoFornecedorData {
  vendorName: string
  tenantName: string
  tenantSlug: string
  reason: string
}

export function rejeicaoFornecedor(data: RejeicaoFornecedorData): TemplateOutput {
  const updateUrl = `${CANONICAL_DOMAIN}/${data.tenantSlug}/fornecedor/cadastro`
  const subject = `[${data.tenantName}] Sobre o seu cadastro de fornecedor`
  const text =
    `Olá ${data.vendorName},\n\n` +
    `Avaliamos seu cadastro como fornecedor no evento ${data.tenantName} ` +
    `e, neste momento, ele NÃO foi aprovado.\n\n` +
    `Motivo: ${data.reason}\n\n` +
    `Você pode atualizar seus dados e enviar novamente em: ${updateUrl}\n\n` +
    `Em caso de dúvida sobre o motivo, responda a este e-mail e a organizadora ` +
    `retornará o contato.\n\n` +
    `— Equipe FB_EVENTOS`
  const html =
    `<p>Olá <strong>${escapeHtml(data.vendorName)}</strong>,</p>` +
    `<p>Avaliamos seu cadastro como fornecedor no evento ` +
    `<strong>${escapeHtml(data.tenantName)}</strong> e, neste momento, ele <strong>NÃO foi aprovado</strong>.</p>` +
    `<p><strong>Motivo:</strong> ${escapeHtml(data.reason)}</p>` +
    `<p>Você pode atualizar seus dados e enviar novamente em: ` +
    `<a href="${updateUrl}">${updateUrl}</a></p>` +
    `<p>Em caso de dúvida sobre o motivo, responda a este e-mail e a organizadora ` +
    `retornará o contato.</p>` +
    `<p>— Equipe FB_EVENTOS</p>`
  return { subject, text, html }
}
