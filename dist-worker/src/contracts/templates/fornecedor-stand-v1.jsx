"use strict";
// FB_EVENTOS — Fornecedor Stand contract template v1 (Phase 1, Plan 01-05 Task 1).
//
// D-07 / D-08 / ADR-0004:
//   - @react-pdf/renderer (TS pure, no Chrome in Dockerfile.worker).
//   - Hardcoded TS template per category. Future version = `-v2.tsx`
//     coexisting with v1; contracts.template_version records which version
//     each row was generated against. Git history = audit trail.
//   - Inline Helvetica only — Font.register() quirks + no variable-font
//     support in @react-pdf/renderer (RESEARCH §PDF Pitfalls).
//
// The template receives the full set of denormalized parameters at render
// time so the job handler can compose them from a single tenant-scoped JOIN.
// No data is loaded inside the template — the worker is responsible.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORNECEDOR_STAND_V1_VERSION = void 0;
exports.FornecedorStandV1 = FornecedorStandV1;
const renderer_1 = require("@react-pdf/renderer");
// ────────────────────────────────────────────────────────────────────────────
// Template version identifier (recorded on contracts.template_version)
// ────────────────────────────────────────────────────────────────────────────
exports.FORNECEDOR_STAND_V1_VERSION = 'fornecedor-stand-v1';
// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const dateFmt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
});
function formatCNPJ(cnpj) {
    // Display the CNPJ in the standard 00.000.000/0000-00 mask. The DB stores
    // 14 digits; we mask only at render time.
    const d = cnpj.replace(/\D/g, '');
    if (d.length !== 14)
        return cnpj;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}
// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────
const styles = renderer_1.StyleSheet.create({
    page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica', color: '#0f172a' },
    h1: { fontSize: 16, fontWeight: 'bold', marginBottom: 4, textAlign: 'center' },
    subtitle: { fontSize: 10, marginBottom: 16, textAlign: 'center', color: '#64748b' },
    h2: { fontSize: 13, fontWeight: 'bold', marginTop: 16, marginBottom: 4 },
    p: { marginBottom: 6, lineHeight: 1.4 },
    table: { marginTop: 6, marginBottom: 6, borderWidth: 1, borderColor: '#cbd5e1' },
    row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#cbd5e1' },
    rowLast: { flexDirection: 'row' },
    cellL: { padding: 6, flex: 1, fontWeight: 'bold', backgroundColor: '#f8fafc' },
    cellR: { padding: 6, flex: 2 },
    footer: {
        position: 'absolute',
        bottom: 20,
        left: 40,
        right: 40,
        fontSize: 8,
        color: '#64748b',
        textAlign: 'center',
    },
    sigBlock: { marginTop: 28, flexDirection: 'row', justifyContent: 'space-between' },
    sigCol: { flex: 1, marginHorizontal: 12 },
    sigLine: { borderBottomWidth: 1, borderBottomColor: '#0f172a', marginTop: 36, marginBottom: 4 },
    sigLabel: { fontSize: 9, textAlign: 'center', color: '#64748b' },
});
// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────
function FornecedorStandV1({ params }) {
    const start = dateFmt.format(params.evento.startsAt);
    const end = dateFmt.format(params.evento.endsAt);
    const generated = dateFmt.format(params.generatedAt);
    return (<renderer_1.Document>
      <renderer_1.Page size="A4" style={styles.page}>
        <renderer_1.Text style={styles.h1}>CONTRATO DE CESSÃO DE ESPAÇO</renderer_1.Text>
        <renderer_1.Text style={styles.subtitle}>
          Contrato Nº {params.contractNumber} — gerado em {generated}
        </renderer_1.Text>

        <renderer_1.Text style={styles.h2}>1. Identificação das partes</renderer_1.Text>
        <renderer_1.View style={styles.table}>
          <renderer_1.View style={styles.row}>
            <renderer_1.Text style={styles.cellL}>Organizadora</renderer_1.Text>
            <renderer_1.Text style={styles.cellR}>{params.organizadora.name}</renderer_1.Text>
          </renderer_1.View>
          <renderer_1.View style={styles.row}>
            <renderer_1.Text style={styles.cellL}>Fornecedor (Razão social)</renderer_1.Text>
            <renderer_1.Text style={styles.cellR}>{params.fornecedor.legalName}</renderer_1.Text>
          </renderer_1.View>
          <renderer_1.View style={styles.row}>
            <renderer_1.Text style={styles.cellL}>CNPJ</renderer_1.Text>
            <renderer_1.Text style={styles.cellR}>{formatCNPJ(params.fornecedor.cnpj)}</renderer_1.Text>
          </renderer_1.View>
          <renderer_1.View style={styles.rowLast}>
            <renderer_1.Text style={styles.cellL}>E-mail de contato</renderer_1.Text>
            <renderer_1.Text style={styles.cellR}>{params.fornecedor.email}</renderer_1.Text>
          </renderer_1.View>
        </renderer_1.View>

        <renderer_1.Text style={styles.h2}>2. Objeto</renderer_1.Text>
        <renderer_1.Text style={styles.p}>
          A Organizadora cede ao Fornecedor o lote {params.lote.code} ({params.lote.categoryName},{' '}
          {params.lote.areaM2.toFixed(2)} m²) durante o evento {params.evento.name}, localizado em{' '}
          {params.evento.placeName}
          {params.evento.placeAddress ? ` — ${params.evento.placeAddress}` : ''}.
        </renderer_1.Text>

        <renderer_1.Text style={styles.h2}>3. Vigência</renderer_1.Text>
        <renderer_1.Text style={styles.p}>
          Período do evento: de {start} a {end} (fuso America/Sao_Paulo).
        </renderer_1.Text>

        <renderer_1.Text style={styles.h2}>4. Valor</renderer_1.Text>
        <renderer_1.Text style={styles.p}>
          {params.lote.valueBRL}, à vista, conforme cobrança gerada na plataforma FB Eventos.
        </renderer_1.Text>

        <renderer_1.Text style={styles.h2}>5. Cláusulas padrão</renderer_1.Text>
        <renderer_1.Text style={styles.p}>
          5.1. Pagamento: O Fornecedor compromete-se a quitar a cobrança gerada antes do início do
          evento. O não pagamento até 24 horas antes do início do evento autoriza a Organizadora a
          rescindir o presente contrato e reatribuir o lote.
        </renderer_1.Text>
        <renderer_1.Text style={styles.p}>
          5.2. Cancelamento: Cancelamentos solicitados pelo Fornecedor com mais de 15 dias de
          antecedência geram reembolso parcial conforme política da Organizadora. Cancelamentos
          dentro de 15 dias não geram reembolso.
        </renderer_1.Text>
        <renderer_1.Text style={styles.p}>
          5.3. Força maior: Eventos de força maior (caso fortuito, ordem governamental, calamidade
          pública) suspendem as obrigações de ambas as partes sem responsabilidade indenizatória,
          observada a legislação aplicável.
        </renderer_1.Text>

        <renderer_1.Text style={styles.h2}>6. Assinaturas</renderer_1.Text>
        <renderer_1.Text style={styles.p}>
          Este contrato é assinado eletronicamente via ZapSign. A ordem de assinatura é sequencial:
          a Organizadora assina primeiro; o Fornecedor recebe o convite após a primeira assinatura.
        </renderer_1.Text>

        <renderer_1.View style={styles.sigBlock}>
          <renderer_1.View style={styles.sigCol}>
            <renderer_1.View style={styles.sigLine}/>
            <renderer_1.Text style={styles.sigLabel}>Organizadora</renderer_1.Text>
          </renderer_1.View>
          <renderer_1.View style={styles.sigCol}>
            <renderer_1.View style={styles.sigLine}/>
            <renderer_1.Text style={styles.sigLabel}>Fornecedor</renderer_1.Text>
          </renderer_1.View>
        </renderer_1.View>

        <renderer_1.Text style={styles.footer} fixed>
          Template {exports.FORNECEDOR_STAND_V1_VERSION} — Gerado em {generated}
        </renderer_1.Text>
      </renderer_1.Page>
    </renderer_1.Document>);
}
