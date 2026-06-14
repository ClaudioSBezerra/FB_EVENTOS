# ADR-0004 — Gerador de PDF de Contrato (@react-pdf/renderer)

- **Status:** Accepted
- **Data:** 2026-06-14
- **Plano:** 01-05 (Phase 1 — Organizadora end-to-end piloto Festa de Trindade)
- **Decisão original:** CONTEXT.md D-07

## Contexto

A Fase 1 precisa gerar contratos de cessão de espaço em PDF dentro do
processo Graphile-Worker (`Dockerfile.worker`), uma imagem Docker
deliberadamente mínima e separada do `Dockerfile` da aplicação web.

Critérios não-negociáveis:

1. **Sem Chrome / Chromium no `Dockerfile.worker`.** Adicionar Puppeteer
   ou Playwright traria ~300 MB de binário Chromium, aumentaria o tempo
   de cold-start em 1-3 s, e introduziria risco de OOM em workers
   com pouca RAM (piloto Coolify roda em VMs de 2 GB).
2. **TypeScript puro, sem fila externa de processos**: a geração deve
   poder ser invocada inline pelo handler do job sem fork de processo
   filho. (Puppeteer/Playwright nunca bloqueia o event-loop por si só,
   mas o Chromium é um processo separado que precisa ser gerenciado.)
3. **Versionamento por arquivo (D-08)**: cada template é um componente
   React (`.tsx`) com versão no nome do arquivo (`fornecedor-stand-v1.tsx`).
   Mudanças = novo arquivo `-v2.tsx`. `contracts.template_version` no DB
   referencia a versão usada, e o git log é o audit trail.
4. **Geração rápida para o piloto** (≤2 s por contrato simples) — o
   organizadora emite contratos em ondas durante a venda de espaços.

## Decisão

Usar **`@react-pdf/renderer@4.5.1`** com a API `renderToBuffer(...)` no
processo do worker.

Implementação:

- Template: `src/contracts/templates/fornecedor-stand-v1.tsx` — componente
  React puro usando primitivas `Document` / `Page` / `View` / `Text`,
  fonte Helvetica embutida (sem `Font.register`).
- Registry: `src/contracts/templates/index.ts` — mapa
  `template_version → componente`. Adicionar uma versão = novo arquivo +
  novo entry no registry + nova linha em `contract_template_versions`
  (migration 0013 fez o seed do v1).
- Helper: `src/contracts/generate-pdf.ts::generateContractPdf({...})` →
  retorna `Buffer` pronto para upload MinIO.
- Job handler: `src/jobs/tasks/pdf-generate-contract.ts` chama o helper
  dentro de `withTenant(payload.tenant_id, ...)` (Pitfall 8) e faz
  `putObject` em `contracts/{contractId}/contract-v1.pdf`.

## Alternativas consideradas

| Opção                  | Vantagens                                            | Desvantagens                                                                                       | Veredito                                                |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **`@react-pdf/renderer@4.5.1`** ✅ | TS puro, sem Chrome, registry de templates é trivial, React DX | Não suporta variable fonts, CSS limitado, layouts complexos exigem workarounds. Manutenção do upstream foi inconsistente em 2025-2026 (RESEARCH §A6). | **Adotado.** Suficiente para contratos da Fase 1; risco mitigado por escape-hatch ao Puppeteer documentado abaixo. |
| Puppeteer + HTML → PDF | Suporte CSS/flexbox completo, qualquer template HTML  | Adiciona Chromium 300 MB no Dockerfile.worker. Cold-start +1-3 s. OOM risk em VMs pequenas. Quebra D-07. | **Rejeitado.** Apenas como escape-hatch documentado se @react-pdf regredir. |
| `pdfkit`               | Pequeno, controle binário fino                       | API procedural, sem componentes React; difícil de manter versões de template em código.            | **Rejeitado.** O modelo "1 arquivo .tsx por versão" perde sentido sem componentes. |
| `wkhtmltopdf` binário  | Renderiza HTML/CSS direto                            | Binário não-Node, requer install via apt/brew; manutenção upstream paralisada.                     | **Rejeitado.** Não-portável + manutenção morta.          |
| `pdfmake`              | TS puro, sem Chrome                                  | Modelo de "document definition" custom (não-React, não-HTML); curva de aprendizado dupla.          | **Rejeitado.** Toolkit menor que @react-pdf + curva extra. |

## Consequências

### Positivas

- `Dockerfile.worker` permanece pequeno (~150 MB total).
- Sem ciclo de boot do Chromium em cada job.
- Templates são componentes React — devs já familiarizados com TSX podem
  contribuir. PR review é diff JSX vs diff HTML+CSS+JS misturado.
- Versionamento por arquivo combina com Git — `git blame` no template
  responde "quem mudou esta cláusula".

### Negativas

- Layouts mais ricos (gradientes, animações, fontes variáveis) não são
  viáveis. Para contratos Phase 1 isso é aceitável; templates de
  newsletter ou pitch decks NÃO devem usar @react-pdf.
- O upstream @diegomura/react-pdf teve cadência irregular em 2025-2026.
  Pinning em `4.5.1` mitiga regressões silenciosas.
- Variable fonts não são suportadas — precisamos registrar cada peso
  individualmente se quisermos custom fonts no futuro. Fase 1 usa
  Helvetica embutida, sem registro.

### Escape-hatch documentado

Se uma regressão futura no `@react-pdf/renderer` quebrar a geração e
fix upstream demorar, o caminho de fallback é:

1. Adicionar Puppeteer + Chromium ao `Dockerfile.worker` apenas para
   o template afetado.
2. Reescrever o template como HTML+CSS no mesmo padrão de registry
   (`src/contracts/templates/fornecedor-stand-v2.tsx` → componente que
   gera HTML string + chama `puppeteer.launch().newPage().setContent()`).
3. `contracts.template_version = 'fornecedor-stand-v2'` distingue qual
   pipeline usar.

Não invertemos a decisão preventivamente — adicionar Chromium AGORA é
custo certo contra risco probabilístico.

## Referências

- CONTEXT.md D-07 (decisão original).
- 01-RESEARCH.md §A6 (PDF Pitfalls).
- `src/contracts/templates/fornecedor-stand-v1.tsx`
- `src/contracts/generate-pdf.ts`
- `src/jobs/tasks/pdf-generate-contract.ts`
- `tests/contracts/pdf-gen.test.ts`
- @react-pdf/renderer docs: <https://react-pdf.org/>
- npm: <https://www.npmjs.com/package/@react-pdf/renderer> (4.5.1, 2026-04-15)
