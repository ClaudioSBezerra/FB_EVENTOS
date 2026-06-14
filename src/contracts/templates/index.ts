// FB_EVENTOS — Contract template registry (Phase 1, Plan 01-05 Task 1).
//
// Maps `contracts.template_version` (text) → renderer + metadata. Adding a
// new template = a new file `<key>.tsx` + a new entry here + a new row in
// `contract_template_versions` (seeded via migration). D-08 invariant.
//
// The registry is intentionally a tiny module — no DB lookup, no I/O. The
// PDF generator (src/contracts/generate-pdf.ts) calls `getTemplate(version)`
// to look up the React component to feed into `renderToBuffer(...)`.

import type { ComponentType } from 'react'
import {
  FORNECEDOR_STAND_V1_VERSION,
  FornecedorStandV1,
  type FornecedorStandV1Params,
} from './fornecedor-stand-v1'

export interface RegisteredTemplate<P> {
  version: string
  description: string
  // biome-ignore lint/suspicious/noExplicitAny: React 19 + @react-pdf/renderer's Document return type is intentionally loose
  Component: ComponentType<{ params: P }> | any
}

export const TEMPLATE_REGISTRY = {
  [FORNECEDOR_STAND_V1_VERSION]: {
    version: FORNECEDOR_STAND_V1_VERSION,
    description: 'Contrato de cessão de espaço — Fornecedor / Stand (v1, pt-BR)',
    Component: FornecedorStandV1,
  } satisfies RegisteredTemplate<FornecedorStandV1Params>,
} as const

export type TemplateVersion = keyof typeof TEMPLATE_REGISTRY

export function getTemplate(version: string): RegisteredTemplate<unknown> | null {
  return (TEMPLATE_REGISTRY as Record<string, RegisteredTemplate<unknown>>)[version] ?? null
}

export type { FornecedorStandV1Params }

export { FORNECEDOR_STAND_V1_VERSION }
