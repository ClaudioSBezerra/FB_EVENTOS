// FB_EVENTOS — BrasilAPI Server Action shared module (no 'use server').
//
// Constants + types extracted from brasilapi.ts to satisfy Next.js 15's
// strict 'use server' rule: files marked 'use server' may only export
// async functions. Constants, types, and interfaces live here instead.
//
// REFERENCES:
//   - src/lib/actions/brasilapi.ts (the Server Action file consuming these)
//   - 01-CONTEXT.md D-16 (2-layer + degrade)

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

export const BRASILAPI_BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1'

/** TTL of cached ATIVA responses. After this window we re-query BrasilAPI. */
export const CNPJ_CACHE_TTL_DAYS = 7

/** Hard timeout on BrasilAPI calls — beyond this we degrade. */
export const BRASILAPI_TIMEOUT_MS = 5_000

/** BrasilAPI situacao_cadastral enum: `2` means ATIVA (Receita Federal codes). */
export const SITUACAO_ATIVA = 2

// ────────────────────────────────────────────────────────────────────────────
// Result shape
// ────────────────────────────────────────────────────────────────────────────

export type LookupSource = 'cache' | 'brasilapi' | 'degraded'

export interface BrasilAPIPayload {
  cnpj: string
  razao_social?: string
  nome_fantasia?: string | null
  situacao_cadastral?: number | string
  descricao_situacao_cadastral?: string
  data_situacao_cadastral?: string
  cnae_fiscal?: number
  cnae_fiscal_descricao?: string
  logradouro?: string
  numero?: string
  complemento?: string | null
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
  ddd_telefone_1?: string
  email?: string
  [k: string]: unknown
}

export interface LookupSuccess {
  verified: true
  source: 'cache' | 'brasilapi'
  data: BrasilAPIPayload
  /** Normalized 14-digit CNPJ. */
  cnpj: string
}

export interface LookupInactive {
  verified: false
  source: 'brasilapi'
  reason: 'inactive' | 'not_found'
  /** Original Receita situação descriptor when available (e.g., BAIXADA). */
  situacao?: string | null
  cnpj: string
}

export interface LookupDegraded {
  verified: null
  source: 'degraded'
  reason: string
  cnpj: string
}

export type LookupResult = LookupSuccess | LookupInactive | LookupDegraded
