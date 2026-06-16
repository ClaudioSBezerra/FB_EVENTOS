"use strict";
// FB_EVENTOS — Email template: aprovacao_fornecedor
// (Phase 1, Plan 01-08 — ORG-17 / D-15 template #2).
//
// Sent when an organizadora approves a vendor (approveVendor Server Action).
// Recipient: vendor.email.
Object.defineProperty(exports, "__esModule", { value: true });
exports.aprovacaoFornecedor = aprovacaoFornecedor;
const shared_1 = require("./shared");
function aprovacaoFornecedor(data) {
    const dashboardUrl = `${shared_1.CANONICAL_DOMAIN}/${data.tenantSlug}/fornecedor`;
    const subject = `[${data.tenantName}] Você foi aprovado como fornecedor`;
    const text = `Olá ${data.vendorName},\n\n` +
        `Boas notícias! Seu cadastro foi APROVADO para o evento ${data.tenantName}.\n\n` +
        `Próximos passos:\n` +
        `1. Acesse seu painel: ${dashboardUrl}\n` +
        `2. Escolha o lote disponível na planta visual do evento\n` +
        `3. Assine o contrato digital enviado pela organizadora\n` +
        `4. Realize o pagamento via PIX ou cartão\n\n` +
        `Qualquer dúvida, responda a este e-mail.\n\n` +
        `— Equipe FB_EVENTOS`;
    const html = `<p>Olá <strong>${(0, shared_1.escapeHtml)(data.vendorName)}</strong>,</p>` +
        `<p>Boas notícias! Seu cadastro foi <strong>APROVADO</strong> para o evento ` +
        `<strong>${(0, shared_1.escapeHtml)(data.tenantName)}</strong>.</p>` +
        `<p>Próximos passos:</p>` +
        `<ol>` +
        `<li>Acesse seu painel: <a href="${dashboardUrl}">${dashboardUrl}</a></li>` +
        `<li>Escolha o lote disponível na planta visual do evento</li>` +
        `<li>Assine o contrato digital enviado pela organizadora</li>` +
        `<li>Realize o pagamento via PIX ou cartão</li>` +
        `</ol>` +
        `<p>Qualquer dúvida, responda a este e-mail.</p>` +
        `<p>— Equipe FB_EVENTOS</p>`;
    return { subject, text, html };
}
