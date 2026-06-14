// FB_EVENTOS — Email template: signup_fornecedor
// (Phase 1, Plan 01-08 — ORG-17 / D-15 template #1).
//
// Sent when a new vendor is created (createVendor Server Action enqueues
// the email.send-status-update job — Plan 01-04 Task 3 stub).
//
// Recipient: vendor.email (the just-cadastrado fornecedor).
//
// Domain canonical: ALL links use https://eventos.fbtax.cloud/{slug}/...
// (regex-asserted in tests/email/templates.test.ts).
//
// Worker-safe: plain TS module — NO DOM, NO JSX, NO React. Returns
// {subject, text, html} with html as plain HTML string (optional).
//
// pt-BR style: formal-mas-humano per 01-CONTEXT.md.

import { CANONICAL_DOMAIN, escapeHtml, type TemplateOutput } from './shared'

export interface SignupFornecedorData {
  vendorName: string
  tenantName: string
  tenantSlug: string
}

export function signupFornecedor(data: SignupFornecedorData): TemplateOutput {
  const dashboardUrl = `${CANONICAL_DOMAIN}/${data.tenantSlug}/fornecedor`
  const subject = `[${data.tenantName}] Cadastro de fornecedor recebido`
  const text =
    `Olá ${data.vendorName},\n\n` +
    `Recebemos seu cadastro como fornecedor no evento ${data.tenantName}. ` +
    `Vamos analisar seus dados e retornar em breve com a aprovação.\n\n` +
    `Acompanhe o status em: ${dashboardUrl}\n\n` +
    `— Equipe FB_EVENTOS`
  const html =
    `<p>Olá <strong>${escapeHtml(data.vendorName)}</strong>,</p>` +
    `<p>Recebemos seu cadastro como fornecedor no evento <strong>${escapeHtml(data.tenantName)}</strong>. ` +
    `Vamos analisar seus dados e retornar em breve com a aprovação.</p>` +
    `<p>Acompanhe o status em: <a href="${dashboardUrl}">${dashboardUrl}</a></p>` +
    `<p>— Equipe FB_EVENTOS</p>`
  return { subject, text, html }
}
