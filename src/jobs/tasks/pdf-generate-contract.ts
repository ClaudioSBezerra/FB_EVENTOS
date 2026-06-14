// FB_EVENTOS — Graphile-Worker task: pdf.generate-contract
// (Phase 1, Plan 01-05 Task 1).
//
// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Pitfall 8 — withTenant() inside the worker (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// The worker process uses its OWN pg connection (separate pool from web).
// The runner does NOT pre-set `app.current_tenant_id` on that connection.
// Therefore this task MUST wrap its body in
// `withTenant(payload.tenant_id, async (db) => { ... })`. Otherwise RLS
// default-deny returns 0 rows for the contracts/events/vendors/lots reads
// and the job silently no-ops.
//
// Failure-mode probe: tests/contracts/pdf-gen.test.ts case
// "task without withTenant returns no data and the task throws"
//
// Flow:
//   1. Resolve template_version from contracts row → registry → component.
//   2. Load contract + tenant + organization (organizadora) + vendor +
//      event + lot + lot_category in a single JOIN.
//   3. Build the FornecedorStandV1Params shape (denormalized).
//   4. generateContractPdf({ templateVersion, params }) → Buffer.
//   5. MinIO putObject contracts/{contractId}/contract-v1.pdf.
//   6. UPDATE contracts.pdf_minio_key.
//   7. recordAudit('contract.pdf_generated').
//   8. Enqueue zapsign.send-contract { contract_id, tenant_id } in the
//      SAME withTenant transaction (outbox: if commit succeeds, the
//      zapsign job is durable; if rollback, the next job never queued).
//
// AUDIT PAYLOAD: contains template_version + pdf_minio_key + lot_code only
// — no PII (vendor CNPJ / email / razão social) per audit hygiene. The
// vendor row is loaded inside the same tenant scope so consumers can join
// audit_log → contracts → vendors when needed.

import { and, eq, isNull } from 'drizzle-orm'
import type { Task } from 'graphile-worker'
import { z } from 'zod'
import { generateContractPdf } from '@/contracts/generate-pdf'
import { FORNECEDOR_STAND_V1_VERSION, type FornecedorStandV1Params } from '@/contracts/templates'
import { organization } from '@/db/schema/auth'
import { contracts } from '@/db/schema/contracts'
import { events } from '@/db/schema/events'
import { lotCategories, lots } from '@/db/schema/lots'
import { vendors } from '@/db/schema/vendors'
import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { recordAudit } from '@/lib/audit'
import { childLogger } from '@/lib/logger'
import { computeLotPrice, formatBRL } from '@/lib/lots/price'
import { getMinIOClient, getTenantBucket } from '@/lib/storage/minio'

// ────────────────────────────────────────────────────────────────────────────
// Payload schema (job invariants)
// ────────────────────────────────────────────────────────────────────────────

export const pdfGenerateContractPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  tenant_slug: z.string().min(1),
  contract_id: z.string().uuid(),
  user_id: z.string().uuid(),
})

export type PdfGenerateContractPayload = z.infer<typeof pdfGenerateContractPayloadSchema>

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

export const PDF_GENERATE_CONTRACT_TASK = 'pdf.generate-contract'
export const ZAPSIGN_SEND_CONTRACT_TASK = 'zapsign.send-contract'

function contractObjectKey(contractId: string): string {
  // contracts/{contractId}/contract-v1.pdf — versioned filename so a
  // template_version bump (Phase 3) lands as a sibling object, not an
  // overwrite. Aligned with D-08 reproducibility.
  return `contracts/${contractId}/contract-v1.pdf`
}

// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────

export const pdfGenerateContract: Task = async (rawPayload, helpers) => {
  const payload = pdfGenerateContractPayloadSchema.parse(rawPayload ?? {})
  const log = childLogger({ tenantId: payload.tenant_id })

  await withTenant(payload.tenant_id, async (db) => {
    // Single JOIN — tenant-scoped (RLS enforces the boundary). Drizzle's
    // .innerJoin returns a tuple; we destructure manually.
    const rows = await db
      .select({
        contract: contracts,
        event: events,
        vendor: vendors,
        lot: lots,
        category: lotCategories,
      })
      .from(contracts)
      .innerJoin(events, eq(events.id, contracts.eventId))
      .innerJoin(vendors, eq(vendors.id, contracts.vendorId))
      .innerJoin(lots, eq(lots.id, contracts.lotId))
      .innerJoin(lotCategories, eq(lotCategories.id, lots.categoryId))
      .where(and(eq(contracts.id, payload.contract_id), isNull(contracts.deletedAt)))
      .limit(1)
    const row = rows[0]
    if (!row) {
      // The task throws so Graphile-Worker retries with backoff. RLS-no-
      // worker contract: this MUST throw — silently completing would
      // strand the contract in `draft` forever.
      throw new Error(
        `pdf.generate-contract: contract ${payload.contract_id} not found in tenant ${payload.tenant_id} (RLS scope)`,
      )
    }

    // Lookup organizadora display name from the org row (single tenant has
    // one organization in Phase 1 — Better Auth's organization plugin).
    const orgRows = await db.select({ name: organization.name }).from(organization).limit(1)
    const orgName = orgRows[0]?.name ?? 'Organizadora'

    // Compute the lote price (aditivo: base_fixed + area × per_sqm_rate)
    // and format for the contract body.
    const price = computeLotPrice(
      { baseFixed: row.category.baseFixed, perSqmRate: row.category.perSqmRate },
      { areaM2: row.lot.areaM2 },
    )

    const params: FornecedorStandV1Params = {
      contractNumber: row.contract.id.slice(0, 8).toUpperCase(),
      organizadora: { name: orgName },
      fornecedor: {
        legalName: row.vendor.legalName,
        cnpj: row.vendor.cnpj,
        email: row.vendor.email,
      },
      evento: {
        name: row.event.name,
        placeName: row.event.placeName,
        placeAddress: row.event.placeAddress,
        startsAt: row.event.startsAt,
        endsAt: row.event.endsAt,
      },
      lote: {
        code: row.lot.code,
        areaM2: Number(row.lot.areaM2),
        categoryName: row.category.name,
        valueBRL: formatBRL(price),
      },
      generatedAt: new Date(),
    }

    // Generate + upload.
    const buffer = await generateContractPdf({
      templateVersion: row.contract.templateVersion,
      params,
    })
    const objectKey = contractObjectKey(row.contract.id)
    await getMinIOClient().putObject(
      getTenantBucket(payload.tenant_slug),
      objectKey,
      buffer,
      buffer.length,
      { 'Content-Type': 'application/pdf' },
    )

    // Persist pdf_minio_key.
    await db
      .update(contracts)
      .set({ pdfMinioKey: objectKey, updatedAt: new Date() })
      .where(eq(contracts.id, row.contract.id))

    await recordAudit(db, {
      action: 'contract.pdf_generated',
      entity: 'contract',
      entityId: row.contract.id,
      userId: payload.user_id,
      payload: {
        template_version: row.contract.templateVersion,
        pdf_minio_key: objectKey,
        lot_code: row.lot.code,
      },
    })

    // Outbox: enqueue zapsign.send-contract atomically with the UPDATE
    // above. If the worker process dies between UPDATE and enqueue, the
    // transaction rolls back and the original pdf.generate-contract retry
    // picks up cleanly. Same pattern as Plan 01-04 (rawSqlFromTenantDb).
    await enqueueJob(rawSqlFromTenantDb(db), ZAPSIGN_SEND_CONTRACT_TASK, {
      tenant_id: payload.tenant_id,
      tenant_slug: payload.tenant_slug,
      contract_id: row.contract.id,
      user_id: payload.user_id,
    })

    log.info(
      {
        component: 'job',
        task: PDF_GENERATE_CONTRACT_TASK,
        jobId: String(helpers.job.id),
        contractId: row.contract.id,
        templateVersion: row.contract.templateVersion,
        pdfMinioKey: objectKey,
      },
      'contract PDF generated',
    )
  })
}

// Re-export the template-version constant so callers (Server Action) can
// pin the version used at INSERT time without importing the heavy template.
export { FORNECEDOR_STAND_V1_VERSION }
