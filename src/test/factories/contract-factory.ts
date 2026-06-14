// FB_EVENTOS — Contract factory (Phase 1, Plan 01-05 — Task 1 test infra).
//
// Builds a `contracts` row tied to (tenantId, eventId, vendorId, lotId)
// at status='draft' with template_version='fornecedor-stand-v1'. Uses the
// appPool + SET LOCAL pattern (contracts has FORCE RLS).
//
// REFERENCES:
//   - 01-RESEARCH.md §A1 (contracts schema)
//   - src/test/factories/lot-category-factory.ts (appPool + SET LOCAL pattern)

import { appPool } from '@/test/db'

export interface ContractOverrides {
  templateVersion?: string
  status?: string
  pdfMinioKey?: string | null
  zapsignDocId?: string | null
  signedPdfMinioKey?: string | null
}

export interface PersistedContract {
  id: string
  tenantId: string
  vendorId: string
  lotId: string
  eventId: string
  templateVersion: string
  status: string
  pdfMinioKey: string | null
  zapsignDocId: string | null
  signedPdfMinioKey: string | null
}

/**
 * Build + persist a contract row tied to (tenantId, vendorId, lotId, eventId).
 * Defaults: template_version='fornecedor-stand-v1', status='draft'.
 */
export async function makeContract(
  tenantId: string,
  vendorId: string,
  lotId: string,
  eventId: string,
  overrides: ContractOverrides = {},
): Promise<PersistedContract> {
  const defaults = {
    templateVersion: overrides.templateVersion ?? 'fornecedor-stand-v1',
    status: overrides.status ?? 'draft',
    pdfMinioKey: overrides.pdfMinioKey ?? null,
    zapsignDocId: overrides.zapsignDocId ?? null,
    signedPdfMinioKey: overrides.signedPdfMinioKey ?? null,
  }

  const rows = await appPool.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
    return tx<
      Array<{
        id: string
        tenant_id: string
        vendor_id: string
        lot_id: string
        event_id: string
        template_version: string
        status: string
        pdf_minio_key: string | null
        zapsign_doc_id: string | null
        signed_pdf_minio_key: string | null
      }>
    >`
      INSERT INTO contracts (
        tenant_id, vendor_id, lot_id, event_id, template_version,
        status, pdf_minio_key, zapsign_doc_id, signed_pdf_minio_key
      ) VALUES (
        ${tenantId}, ${vendorId}, ${lotId}, ${eventId}, ${defaults.templateVersion},
        ${defaults.status}, ${defaults.pdfMinioKey}, ${defaults.zapsignDocId},
        ${defaults.signedPdfMinioKey}
      )
      RETURNING id, tenant_id, vendor_id, lot_id, event_id, template_version,
                status, pdf_minio_key, zapsign_doc_id, signed_pdf_minio_key
    `
  })

  if (!rows[0]) throw new Error('makeContract: no row returned')
  const r = rows[0]
  return {
    id: r.id,
    tenantId: r.tenant_id,
    vendorId: r.vendor_id,
    lotId: r.lot_id,
    eventId: r.event_id,
    templateVersion: r.template_version,
    status: r.status,
    pdfMinioKey: r.pdf_minio_key,
    zapsignDocId: r.zapsign_doc_id,
    signedPdfMinioKey: r.signed_pdf_minio_key,
  }
}
