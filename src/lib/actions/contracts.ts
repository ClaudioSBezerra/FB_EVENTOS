// FB_EVENTOS — Contract Server Actions (Phase 1, Plan 01-05 Task 2).
//
// Two Server Actions wrapped in `withTenantAction`:
//
//   - emitContract({lotAssignmentId})
//       Resolves the assignment → vendor + lot + event in tenant scope,
//       INSERTs a `contracts` row at status='draft' with
//       template_version='fornecedor-stand-v1', enqueues the
//       `pdf.generate-contract` job in the SAME transaction (outbox), and
//       records the audit row. The PDF generation task chains the
//       `zapsign.send-contract` job on its own commit.
//
//   - listContracts({eventId?, status?})
//       RLS-scoped SELECT for the contracts dashboard.
//
//   - getContractById({contractId})
//       Single-row read for the detail page.
//
// PURE-HELPER / THIN-ACTION SPLIT (Plan 01-03 / 01-04 pattern):
//   Tests drive the *InTenant pure helpers directly inside withTenant;
//   the next-safe-action wrappers just delegate.

'use server'

import { and, desc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { contracts } from '@/db/schema/contracts'
import { lots } from '@/db/schema/lots'
import { lotAssignments, vendors } from '@/db/schema/vendors'
import type { TenantDb } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import {
  FORNECEDOR_STAND_V1_VERSION,
  PDF_GENERATE_CONTRACT_TASK,
} from '@/jobs/tasks/pdf-generate-contract'
import { withTenantAction } from '@/lib/actions/safe-action'
import { recordAudit } from '@/lib/audit'
import { resolveTenantSlug } from '@/lib/tenant'
import {
  type ContractIdInput,
  contractIdSchema,
  type EmitContractInput,
  emitContractSchema,
  type ListContractsInput,
  listContractsSchema,
} from '@/lib/validators/contract'

// ────────────────────────────────────────────────────────────────────────────
// Persisted shape
// ────────────────────────────────────────────────────────────────────────────

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
  createdAt: Date
  updatedAt: Date
}

function toPersistedContract(row: typeof contracts.$inferSelect): PersistedContract {
  return {
    id: row.id,
    tenantId: row.tenantId,
    vendorId: row.vendorId,
    lotId: row.lotId,
    eventId: row.eventId,
    templateVersion: row.templateVersion,
    status: row.status,
    pdfMinioKey: row.pdfMinioKey,
    zapsignDocId: row.zapsignDocId,
    signedPdfMinioKey: row.signedPdfMinioKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers (tests drive these inside withTenant)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Emit a draft contract for an active lot_assignment and kick off the
 * PDF-generation pipeline.
 *
 *  - Resolves the active assignment → lot + vendor + event in tenant scope.
 *  - Rejects if the vendor is not status='approved' (defensive — the
 *    assignment creation already gates on this, but a vendor could be
 *    re-rejected between assignment + emit).
 *  - INSERTs contracts row (status='draft', template_version='fornecedor-stand-v1').
 *  - Enqueues `pdf.generate-contract` in the SAME transaction. The PDF
 *    task chains zapsign.send-contract on its own commit.
 *  - recordAudit('contract.emitted') — no PII in payload.
 */
export async function emitContractInTenant(
  db: TenantDb,
  tenantId: string,
  input: EmitContractInput,
  userId: string,
): Promise<PersistedContract> {
  // 1. Resolve the assignment + vendor + lot in one tenant-scoped query.
  const assignmentRows = await db
    .select({
      assignment: lotAssignments,
      vendor: vendors,
      lot: lots,
    })
    .from(lotAssignments)
    .innerJoin(vendors, eq(vendors.id, lotAssignments.vendorId))
    .innerJoin(lots, eq(lots.id, lotAssignments.lotId))
    .where(
      and(
        eq(lotAssignments.id, input.lotAssignmentId),
        isNull(lotAssignments.deletedAt),
        isNull(vendors.deletedAt),
        isNull(lots.deletedAt),
      ),
    )
    .limit(1)
  const row = assignmentRows[0]
  if (!row) {
    throw new Error('Atribuição não encontrada ou inacessível')
  }
  if (row.vendor.status !== 'approved') {
    throw new Error(
      `Fornecedor precisa estar aprovado para emitir contrato (status atual: ${row.vendor.status})`,
    )
  }

  // 2. INSERT contracts row at status='draft'.
  const inserted = await db
    .insert(contracts)
    .values({
      tenantId,
      vendorId: row.vendor.id,
      lotId: row.lot.id,
      eventId: row.lot.eventId,
      templateVersion: FORNECEDOR_STAND_V1_VERSION,
      status: 'draft',
    })
    .returning()
  const contract = inserted[0]
  if (!contract) throw new Error('emitContractInTenant: insert returned no row')

  // 3. Outbox enqueue — pdf.generate-contract in the SAME transaction as
  //    the INSERT above. Tenant slug resolved via tenants lookup.
  const tenantSlug = await resolveTenantSlug(tenantId)
  await enqueueJob(rawSqlFromTenantDb(db), PDF_GENERATE_CONTRACT_TASK, {
    tenant_id: tenantId,
    tenant_slug: tenantSlug,
    contract_id: contract.id,
    user_id: userId,
  })

  // 4. Audit (no PII — just contract + lot + template).
  await recordAudit(db, {
    action: 'contract.emitted',
    entity: 'contract',
    entityId: contract.id,
    userId,
    payload: {
      lot_id: row.lot.id,
      lot_code: row.lot.code,
      vendor_id: row.vendor.id,
      template_version: FORNECEDOR_STAND_V1_VERSION,
    },
  })

  return toPersistedContract(contract)
}

export async function listContractsInTenant(
  db: TenantDb,
  input: ListContractsInput,
): Promise<PersistedContract[]> {
  const conds = [isNull(contracts.deletedAt)]
  if (input.eventId) conds.push(eq(contracts.eventId, input.eventId))
  if (input.status) conds.push(eq(contracts.status, input.status))
  const rows = await db
    .select()
    .from(contracts)
    .where(and(...conds))
    .orderBy(desc(contracts.createdAt))
  return rows.map(toPersistedContract)
}

export async function getContractByIdInTenant(
  db: TenantDb,
  input: ContractIdInput,
): Promise<PersistedContract | null> {
  const rows = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, input.contractId), isNull(contracts.deletedAt)))
    .limit(1)
  return rows[0] ? toPersistedContract(rows[0]) : null
}

// ────────────────────────────────────────────────────────────────────────────
// Server Actions
// ────────────────────────────────────────────────────────────────────────────

export const emitContract = withTenantAction
  .inputSchema(emitContractSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await emitContractInTenant(ctx.db, ctx.tenantId, parsedInput, ctx.userId)
    revalidatePath('/[slug]/contratos', 'page')
    revalidatePath(`/[slug]/contratos/${row.id}`, 'page')
    return row
  })

export const listContracts = withTenantAction
  .inputSchema(listContractsSchema)
  .action(async ({ ctx, parsedInput }) => {
    return listContractsInTenant(ctx.db, parsedInput)
  })

export const getContractById = withTenantAction
  .inputSchema(contractIdSchema)
  .action(async ({ ctx, parsedInput }) => {
    const row = await getContractByIdInTenant(ctx.db, parsedInput)
    if (!row) throw new Error('Contrato não encontrado')
    return row
  })
