# FB_EVENTOS — Política e Inventário LGPD (Placeholder)

> **STATUS:** Placeholder técnico — revisão jurídica pendente antes do go-live
> do piloto **Festa de Trindade/GO**. As tabelas, retenções e bases legais
> abaixo refletem as escolhas técnicas da Fase 0 (Plan 05) e devem ser
> revisadas pelo encarregado (DPO) antes de qualquer coleta de dados em
> produção.
>
> Este arquivo cumpre o requisito LGPD-06 do projeto: documentar o inventário
> de tratamento, o ciclo de retenção e a política de privacidade em um lugar
> único, versionado e reviewable.

## Escopo

FB_EVENTOS é **controlador** dos dados pessoais coletados de:

- **Organizadoras** (clientes B2B) — usuários administrativos que assinam
  contrato para usar a plataforma.
- **Fornecedores / patrocinadores** — pessoas físicas que adquirem espaços
  via marketplace integrado.
- **Prestadores de serviço** — mão de obra terceirizada gerenciada pela
  plataforma.
- **Público final** — compradores de ingressos e bebidas.

Cada tenant (organizadora) é simultaneamente **operador** dos dados das três
últimas categorias, sob a estrutura de Data Processing Agreement (DPA)
descrita abaixo (LGPD-08 — Fase 4).

## Inventário de tratamento por tabela

| Tabela            | Tipo de dado pessoal                 | Base legal (LGPD Art. 7)                        | Retenção (placeholder) | Notas                                                                  |
| ----------------- | ------------------------------------ | ----------------------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `tenants`         | Identificação da empresa cliente     | execução de contrato (II)                       | indeterminado          | enquanto contrato ativo + 5 anos pós-encerramento                      |
| `user`            | Identificação + autenticação         | execução de contrato (II) + consentimento (I)   | 5 anos pós-encerramento | inclui `consent_version` / `consent_at` / `consent_ip` (LGPD-01)       |
| `session`         | Sessão técnica                       | legítimo interesse (IX)                         | até expiração + 30 dias | revogável pelo usuário                                                 |
| `account`         | Provedor OAuth                       | execução de contrato (II)                       | até desvincular        | apenas IDs externos, sem credenciais                                   |
| `audit_log`       | Log de operações sensíveis           | obrigação legal (II) + legítimo interesse (IX)  | 5 anos                 | **append-only** — `REVOKE UPDATE, DELETE FROM fb_eventos_app` (LGPD-04) |
| `consent_records` | Evidência de consentimento           | obrigação legal (Art. 8 § 1°)                   | indeterminado          | versionado por INSERT; snapshot `consent_text` preservado              |
| `organization`    | Identificação do tenant              | execução de contrato (II)                       | enquanto contrato ativo | mesmo ciclo de `tenants`                                               |
| `member`          | Vínculo usuário↔organização          | execução de contrato (II)                       | enquanto vínculo ativo  |                                                                        |
| `invitation`      | Convite pendente                     | legítimo interesse (IX)                         | até aceitar ou expirar  |                                                                        |
| `two_factor`      | Segredos TOTP / códigos de backup    | legítimo interesse (IX) — segurança             | até desabilitar 2FA     | armazenado cifrado                                                     |

## Inventário de colunas PII (LGPD-03)

Todas as colunas que contêm dados pessoais carregam `COMMENT ON COLUMN` no
catálogo Postgres com o prefixo `'PII:'`. Inventário queryable:

```sql
SELECT c.table_name, c.column_name, d.description
  FROM information_schema.columns c
  JOIN pg_description d
    ON d.objoid = (quote_ident(c.table_name))::regclass::oid
   AND d.objsubid = c.ordinal_position
 WHERE c.table_schema = 'public'
   AND d.description LIKE 'PII:%'
 ORDER BY c.table_name, c.column_name;
```

Migração `0007_pii_comments_and_audit_grants.sql` é a source-of-truth — cada
nova tabela com PII em Phase 1+ DEVE adicionar comentários `'PII: ...'` na
mesma migração que cria a tabela.

## Encarregado (DPO) e contato

> **PLACEHOLDER** — definir antes do piloto Festa de Trindade/GO:
>
> - Nome completo do encarregado
> - E-mail dedicado (sugestão: `lgpd@fbeventos.example.com`)
> - Telefone / endereço para correspondência (LGPD Art. 41 § 2°)

Até a definição formal do DPO, contato técnico: equipe FB_EVENTOS via
canal interno.

## Direitos dos titulares (LGPD Art. 18)

| Direito                   | Fase de entrega | Mecanismo técnico                                       |
| ------------------------- | --------------- | ------------------------------------------------------- |
| Confirmação + acesso      | Fase 4 (LGPD-07) | Server Action `exportMyData()` → MinIO signed URL       |
| Correção                  | Fase 1+         | UI de perfil + Server Actions                           |
| Anonimização / eliminação | Fase 4 (LGPD-07) | Graphile-Worker `anonymizeUserJob` + soft-delete prévio |
| Portabilidade             | Fase 4 (LGPD-07) | mesmo export que acesso, formato JSON                   |
| Revogação de consentimento | Fase 1+         | UI de consent + INSERT em `consent_records` com `consent_version` atualizada |

A Fase 0 entrega a **infraestrutura**:

- `audit_log` (LGPD-04) registra todas as ações sensíveis.
- `consent_records` (LGPD-01) versiona consentimentos por `consent_version`
  e preserva `consent_text` snapshot (Art. 8 § 1° — "consentimento para
  finalidades determinadas").
- Soft-delete via coluna `deleted_at` em toda tabela com PII (LGPD-05).
- Banner LGPD-02 em `src/components/consent-banner.tsx`.

A Fase 4 entrega o **workflow operacional**:

- Job de anonimização agendado via Graphile-Worker.
- Página de "Meus dados" com exportação self-service.
- Endpoint `/api/lgpd/consent` para consent versioning autenticado
  (rascunho em Phase 0; full em Phase 1+).

## DPA (Data Processing Agreement) — B2B

> **PLACEHOLDER** — LGPD-08 — Fase 4.
>
> Quando a organizadora (cliente B2B) cadastra usuários finais (fornecedores,
> público, prestadores), FB_EVENTOS atua como **operador** desses dados sob
> a responsabilidade do tenant. O DPA padrão será anexado ao contrato de
> assinatura no formato:
>
> 1. Identificação do controlador (tenant) e do operador (FB_EVENTOS).
> 2. Finalidades específicas do tratamento (matrícula em evento, cobrança,
>    notificações operacionais).
> 3. Categorias de dados tratados (referência a este inventário).
> 4. Sub-operadores autorizados (lista atualizada — Resend, Pagar.me,
>    MinIO/AWS S3, Sentry).
> 5. Medidas técnicas e organizacionais (RLS, criptografia em trânsito e
>    repouso, logs de auditoria, MFA).
> 6. Procedimento de notificação de incidente (≤ 24h conforme ANPD).

## Residência de dados

- Postgres + MinIO + Redis hospedados em região **sa-east-1 (São Paulo)**
  (FB_APU04 herança — Coolify em EC2 / Hetzner BR).
- E-mail transacional via **Resend** — datacenter EU/US. Tipo de tratamento:
  apenas conteúdo do e-mail; nenhum PII estruturado é enviado para Resend
  além de `to`/`subject`/`body`.

## Medidas técnicas em vigor (Fase 0)

- **PostgreSQL row-level security** habilitado + `FORCE ROW LEVEL SECURITY`
  em todas as tabelas tenant-scoped (Plan 03 + Plan 05).
- Role `fb_eventos_app` criada com `NOBYPASSRLS` (Plan 03).
- Senhas armazenadas via Better Auth + bcrypt/scrypt default.
- `audit_log` append-only no nível do GRANT (`REVOKE UPDATE, DELETE`).
- Soft-delete (`deleted_at`) em toda tabela com PII; hard-delete apenas via
  job assíncrono (Fase 4).
- HTTPS obrigatório (Traefik + Let's Encrypt — Plan 07).
- 2FA (TOTP) opcional para usuários administrativos (Plan 04).
- Banner de consentimento LGPD-02 em primeira visita (Plan 05).

## TODO antes do piloto Festa de Trindade/GO

- [ ] Revisão jurídica completa deste documento por advogado especializado.
- [ ] Designar DPO formalmente (LGPD Art. 41).
- [ ] Confirmar prazos de retenção da tabela acima com legal.
- [ ] Publicar Política de Privacidade pública em `/privacy` (vinculada
      pelo banner de consentimento).
- [ ] Anexar DPA padrão ao contrato comercial (LGPD-08 — Fase 4).
- [ ] Configurar workflow de notificação de incidente (≤ 24h ANPD).
- [ ] Treinar equipe de suporte sobre solicitações de titulares (Art. 18).

---

_Última atualização: Fase 0 — Plan 05 (2026-06-12)._
_Próxima revisão obrigatória: antes do go-live do piloto._
