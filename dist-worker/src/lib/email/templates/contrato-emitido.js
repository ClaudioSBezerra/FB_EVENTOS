"use strict";
// FB_EVENTOS — Email template: contrato_emitido
// (Phase 1, Plan 01-08 — ORG-17 / D-15 template #4).
//
// Sent when an organizadora emits a contract (zapsign.send-contract job).
// Recipient: vendor.email.
//
// The ZapSign signing link is passed as data.zapsignSignUrl; FB_EVENTOS
// dashboard link (contrato status) goes to /{slug}/fornecedor/contratos.
Object.defineProperty(exports, "__esModule", { value: true });
exports.contratoEmitido = contratoEmitido;
const shared_1 = require("./shared");
function contratoEmitido(data) {
    const contractsUrl = `${shared_1.CANONICAL_DOMAIN}/${data.tenantSlug}/fornecedor/contratos`;
    const subject = `[${data.tenantName}] Contrato ${data.contractRef} disponível para assinatura`;
    const signLine = data.zapsignSignUrl
        ? `Para assinar agora, acesse o link enviado pela ZapSign no e-mail separado, ou abra: ${data.zapsignSignUrl}\n\n`
        : `Você receberá um e-mail separado da ZapSign com o link de assinatura.\n\n`;
    const text = `Olá ${data.vendorName},\n\n` +
        `Um contrato foi emitido para você no evento ${data.tenantName}.\n` +
        `Referência: ${data.contractRef}\n\n` +
        signLine +
        `Acompanhe o status do contrato em: ${contractsUrl}\n\n` +
        `— Equipe FB_EVENTOS`;
    const signHtml = data.zapsignSignUrl
        ? `<p>Para assinar agora, acesse o link enviado pela ZapSign no e-mail separado, ou abra: ` +
            `<a href="${data.zapsignSignUrl}">${data.zapsignSignUrl}</a></p>`
        : `<p>Você receberá um e-mail separado da ZapSign com o link de assinatura.</p>`;
    const html = `<p>Olá <strong>${(0, shared_1.escapeHtml)(data.vendorName)}</strong>,</p>` +
        `<p>Um contrato foi emitido para você no evento <strong>${(0, shared_1.escapeHtml)(data.tenantName)}</strong>.<br>` +
        `Referência: <strong>${(0, shared_1.escapeHtml)(data.contractRef)}</strong></p>` +
        signHtml +
        `<p>Acompanhe o status do contrato em: <a href="${contractsUrl}">${contractsUrl}</a></p>` +
        `<p>— Equipe FB_EVENTOS</p>`;
    return { subject, text, html };
}
