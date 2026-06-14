// FB_EVENTOS — PDF generation helper (Phase 1, Plan 01-05 Task 1).
//
// Thin shim around @react-pdf/renderer's `renderToBuffer(<Component .../>)`
// that dispatches on `template_version` via the registry in
// `src/contracts/templates/index.ts`.
//
// IMPORTANT — worker safety (D-07, ADR-0004):
//   - `renderToBuffer` runs in plain Node (no DOM, no browser globals). The
//     Graphile-Worker process (tsconfig.worker.json) consumes this file
//     directly.
//   - We import from the package root — @react-pdf/renderer auto-selects
//     the Node entry. If a future regression breaks that, fall back to
//     `@react-pdf/renderer/lib/node` (documented escape hatch in RESEARCH
//     §A6 Pitfalls).
//
// The caller (job handler) builds the param object from a tenant-scoped
// JOIN; this module performs no DB access.

import { renderToBuffer } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'

import { getTemplate, type RegisteredTemplate } from './templates'

export class UnknownTemplateVersionError extends Error {
  constructor(version: string) {
    super(`Unknown contract template_version: "${version}"`)
    this.name = 'UnknownTemplateVersionError'
  }
}

export interface GenerateContractPdfInput {
  templateVersion: string
  // biome-ignore lint/suspicious/noExplicitAny: payload shape is template-specific (validated by the template component itself at render time)
  params: any
}

/**
 * Render a contract PDF to a Buffer using the registered template for
 * `templateVersion`. Throws UnknownTemplateVersionError if the version is
 * not registered in TEMPLATE_REGISTRY.
 *
 * The returned Buffer is ready to upload to MinIO (no further wrapping
 * needed).
 */
export async function generateContractPdf(input: GenerateContractPdfInput): Promise<Buffer> {
  const tpl = getTemplate(input.templateVersion) as RegisteredTemplate<unknown> | null
  if (!tpl) throw new UnknownTemplateVersionError(input.templateVersion)
  // The registry intentionally holds `any` for Component because each
  // template has a unique params shape — @react-pdf/renderer's
  // `renderToBuffer` expects a Document element. Cast at the boundary;
  // the runtime contract is the Document JSX returned by every template.
  const element = createElement(tpl.Component, { params: input.params }) as unknown as ReactElement
  // biome-ignore lint/suspicious/noExplicitAny: renderToBuffer's element type is constrained to Document — we satisfy it at runtime
  const buffer = await renderToBuffer(element as any)
  // @react-pdf/renderer returns a NodeJS Buffer in node mode. Be defensive
  // — if a future version returns a Uint8Array, coerce to Buffer so the
  // contract with MinIO `putObject(..., body: Buffer | string, ...)` holds.
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}
