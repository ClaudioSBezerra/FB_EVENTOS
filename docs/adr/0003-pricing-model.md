# ADR-0003 — Modelo de Preço de Lote (aditivo)

- **Status:** Accepted
- **Data:** 2026-06-14
- **Plano:** 01-03 (Phase 1 — Organizadora end-to-end piloto Festa de Trindade)
- **Decisão original:** CONTEXT.md D-09

## Contexto

A organizadora precisa de uma forma simples e previsível para definir
preços de lotes que cubra os três modos comerciais observados nas
referências de mercado (Festa de Trindade/GO, Totus Tuus, eventos
religiosos de massa em geral):

1. **Preço fixo por lote** — todos os stands tipo "loja 4 m²" pagam
   R$ 200 independentemente da posição.
2. **Preço por m²** — espaços maiores (food courts, palanques de
   patrocínio) pagam proporcional à área desenhada na planta (R$ 50/m²
   por exemplo).
3. **Híbrido** — uma taxa fixa de uso da infraestrutura (luz, gerador,
   limpeza) somada a um valor por m² (R$ 1.000 + R$ 30/m²).

Critério #2 do plano-mestre da Phase 1 (CONTEXT.md): _"organizadora
define categorias com preço/m² + preço fixo"_ — explicitamente aditivo.

## Decisão

O preço final de um lote é calculado pela fórmula **aditiva**:

```
lot.price = category.base_fixed + lot.area_m² × category.per_sqm_rate
```

Implementação:

- `lot_categories.base_fixed   numeric(12,2) NOT NULL DEFAULT 0`
- `lot_categories.per_sqm_rate numeric(10,4) NOT NULL DEFAULT 0`
- `lots.area_m²` é **recomputado server-side** via shoelace nos pontos
  do polígono — o cliente nunca envia área diretamente.
- Helper canônico: `src/lib/lots/price.ts::computeLotPrice(category, lot)`.

A combinação de defaults zero suporta os três modos sem schema
condicional:

| Combinação                                  | Resultado                          |
| ------------------------------------------- | ---------------------------------- |
| `base_fixed=200`, `per_sqm_rate=0`          | Preço fixo R$ 200 (área ignorada). |
| `base_fixed=0`, `per_sqm_rate=50`, area=4   | R$ 200 (4 × 50).                   |
| `base_fixed=1000`, `per_sqm_rate=30`, area=10 | R$ 1.300 (1000 + 300).            |
| `base_fixed=0`, `per_sqm_rate=0`            | R$ 0 ("gratuito" — ex. prestador). |

## Alternativas consideradas

### A. Excludente (escolher um dos dois)

Uma categoria carrega **ou** `base_fixed` **ou** `per_sqm_rate`, nunca
ambos. Implementaria via CHECK constraint `(base_fixed = 0 OR per_sqm_rate = 0)`.

- **Pró:** Modelo conceitual mais claro ("plano fixo" vs "plano por m²").
- **Contra:** Bloqueia o modo híbrido que aparece nos contratos reais de
  patrocínio (taxa de infraestrutura + variável por m²). Refatoração futura
  exigiria ALTER TABLE + script de migração de dados.
- **Veredito:** REJEITADO.

### B. Per-lote (preço arbitrário em cada lote)

Cada lote carrega sua própria coluna `price_override numeric` sem ligação
à categoria.

- **Pró:** Flexibilidade máxima — organizadora ajusta caso a caso.
- **Contra:** Empurra a lógica de precificação para a UI; muda um preço
  global vira "UPDATE em N lotes". Quebra a UX de "configurar categoria"
  como ponto único de edição. Surface area para bugs de inconsistência
  (lote com `price_override` quando a categoria muda).
- **Veredito:** REJEITADO para Phase 1. Possível reintrodução em Phase 3
  via coluna opcional `lots.price_override numeric NULL` mantendo o
  default aditivo.

### C. Tiered pricing (faixas por área)

Categorias com tabela de faixas:
`[0..10m² → R$/m² × 50, 10..50m² → R$/m² × 40, 50+ → R$/m² × 30]`.

- **Pró:** Modela descontos por escala.
- **Contra:** Overkill para piloto. Phase 1 não tem dado de escala que
  justifique a complexidade. CONTEXT.md D-09 explicitamente descarta.
- **Veredito:** REJEITADO.

### D. `price_rules jsonb` por categoria

Schema flexível: cada categoria carrega `{ formula: '...', params: ... }`
em jsonb e o servidor avalia.

- **Pró:** Extensível sem migração.
- **Contra:** Cria uma DSL interna que precisa ser parseada, validada, e
  documentada. Trade-off ruim para piloto.
- **Veredito:** DEFERRED para Phase 3 se a aditivo provar insuficiente.

## Consequências

### Positivas

- Fórmula trivial (uma multiplicação + uma soma) — sem dúvida sobre
  precedência ou edge case.
- Suporte aos três modos comerciais via combinações dos dois campos —
  não há condicional no schema.
- Helper único `computeLotPrice` garante consistência entre UI, cálculo
  de cobrança Pagar.me (01-06), e geração de contrato PDF (01-05).
- `area_m²` server-side via shoelace fecha o gap de confiança em valor
  numérico fornecido pelo cliente.

### Negativas

- Organizadora não pode dar desconto individual a um lote sem ajustar a
  categoria — workaround: criar categoria nova "desconto X" e atribuir.
  Aceitável para piloto; Phase 3 endereça via `price_override` opcional
  (alternativa B reintroduzida sem mudar o default).
- Modelagem de comissões de prestadores (Phase 3) usa fórmula distinta —
  esta ADR cobre apenas lotes de fornecedores.

### Neutras

- Numérico fixo 12,2 + 10,4 cobre R$ 9.999.999,99 base e até R$ 999.999,9999
  por m² — adequado para os tickets atuais do mercado. Phase 4
  internacionalização revisita.

## Implementação

Arquivos load-bearing:

- `src/db/schema/lots.ts` — colunas `baseFixed`/`perSqmRate` em
  `lot_categories` (NOT NULL DEFAULT 0).
- `src/lib/lots/price.ts` — `computeLotPrice(category, lot)` + `formatBRL`.
- `src/lib/validators/lot-category.ts` — Zod schema (não-negativo, ≤ R$ 9.999.999,99).
- `src/lib/validators/geometry.ts::computePolygonArea` — shoelace.
- `src/lib/actions/lots.ts::createLotInTenant` — recomputa `areaM2`
  server-side antes de persistir.
- `tests/lotes/categories.test.ts` — round-trip CRUD + valores de
  referência (R$ 200 / R$ 1.000 / R$ 800 / R$ 0).

## Referências

- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-CONTEXT.md` § D-09.
- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-RESEARCH.md` § "ADR-0003 Draft Material — Aditivo Pricing Model".
- `.planning/phases/01-organizadora-end-to-end-piloto-festa-de-trindade/01-03-konva-editor-lots-categories-PLAN.md`.

## Reversão

Esta decisão é reversível com baixo custo:

1. Adicionar coluna opcional `lots.price_override numeric NULL` (Phase 3).
2. `computeLotPrice` passa a checar `price_override` antes da fórmula.
3. Migração não destrói dados — categorias continuam funcionando para
   lotes que não tenham `price_override`.

Reverter para esquema excludente (alternativa A) **é destrutivo** —
requer reescrever categorias híbridas e perder dados. Não previsto.
