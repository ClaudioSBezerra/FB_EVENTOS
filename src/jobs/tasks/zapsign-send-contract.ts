// FB_EVENTOS — Graphile-Worker task: zapsign.send-contract
// (Phase 1, Plan 01-05 Task 2).
//
// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Pitfall 8 — withTenant() inside the worker (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// Like pdf.generate-contract (Plan 01-05 Task 1), this task wraps its body
// in withTenant(payload.tenant_id, fn) so RLS engages. Without that wrap
// the contracts row reads as 0 rows (default-deny) and the job silently
// no-ops.
//
// Flow (D-01 / D-02):
//   1. Load contracts row (must have pdf_minio_key set by Task 1).
//   2. Mint a 15-min pre-signed GET URL for the draft PDF.
//   3. Load organizadora email/name (from active session user via Better
//      Auth's user table — Phase 1: simplified to "first user in the
//      tenant's org" since the organizadora always self-emits contracts).
//   4. Load fornecedor (vendor) email + name.
//   5. POST to ZapSign /api/v1/docs/ with:
//      - signature_order_active: true
//      - signers: [{order_group:1, organizadora}, {order_group:2, fornecedor}]
//      - external_id: contract.id (echoed back on every webhook)
//   6. INSERT zapsign_documents row with zapsign_id + payload_send.
//   7. UPDATE contracts: status='awaiting_org', zapsign_doc_id=<token>.
//   8. recordAudit('contract.zapsign_sent').
//   9. Enqueue email.send-status-update {event:'contrato_emitido'}.

import { and, eq, isNull } from 'drizzle-orm'
import type { Task } from 'graphile-worker'
import { z } from 'zod'
import { member, organization, user } from '@/db/schema/auth'
import { contracts, zapsignDocuments } from '@/db/schema/contracts'
import { vendors } from '@/db/schema/vendors'
import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { recordAudit } from '@/lib/audit'
import { childLogger } from '@/lib/logger'
import { mintPresignedGet } from '@/lib/storage/minio'
import { createDocument } from '@/lib/zapsign/client'
import type { ZapsignCreateDocRequest } from '@/lib/zapsign/types'

// ────────────────────────────────────────────────────────────────────────────
// Payload schema (mirrors pdf.generate-contract)
// ────────────────────────────────────────────────────────────────────────────

export const zapsignSendContractPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  tenant_slug: z.string().min(1),
  contract_id: z.string().uuid(),
  user_id: z.string().uuid(),
})

export type ZapsignSendContractPayload = z.infer<typeof zapsignSendContractPayloadSchema>

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

export const ZAPSIGN_SEND_CONTRACT_TASK = 'zapsign.send-contract'
export const EMAIL_STATUS_UPDATE_TASK = 'email.send-status-update'

// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────

export const zapsignSendContract: Task = async (rawPayload, helpers) => {
  const payload = zapsignSendContractPayloadSchema.parse(rawPayload ?? {})
  const log = childLogger({ tenantId: payload.tenant_id })

  await withTenant(payload.tenant_id, async (db) => {
    // 1. Load the contracts row + fornecedor in a single tenant-scoped JOIN.
    const rows = await db
      .select({ contract: contracts, vendor: vendors })
      .from(contracts)
      .innerJoin(vendors, eq(vendors.id, contracts.vendorId))
      .where(and(eq(contracts.id, payload.contract_id), isNull(contracts.deletedAt)))
      .limit(1)
    const row = rows[0]
    if (!row) {
      throw new Error(
        `zapsign.send-contract: contract ${payload.contract_id} not found in tenant ${payload.tenant_id} (RLS scope)`,
      )
    }
    if (!row.contract.pdfMinioKey) {
      throw new Error(
        `zapsign.send-contract: contract ${payload.contract_id} has no pdf_minio_key yet — pdf.generate-contract must run first`,
      )
    }

    // 2. Mint a 15-min pre-signed GET URL for the draft PDF.
    const presigned = await mintPresignedGet(payload.tenant_slug, row.contract.pdfMinioKey, 900)

    // 3. Resolve organizadora identity. Phase 1: the active organization
    //    has exactly one tenant; we fetch the owner-role member's user row
    //    for the org's display name + email. If multiple owners exist we
    //    pick the first deterministically (ordered by membership created).
    const orgRows = await db
      .select({ name: organization.name, id: organization.id })
      .from(organization)
      .limit(1)
    const org = orgRows[0]
    if (!org) {
      throw new Error(`zapsign.send-contract: no organization in tenant ${payload.tenant_id}`)
    }
    const ownerRows = await db
      .select({ name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, org.id))
      .orderBy(member.createdAt)
      .limit(1)
    // Fallback to the job-invoker user if no owner is found.
    let orgSignerName = ownerRows[0]?.name ?? org.name
    let orgSignerEmail = ownerRows[0]?.email
    if (!orgSignerEmail) {
      const invoker = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(user.id, payload.user_id))
        .limit(1)
      orgSignerName = invoker[0]?.name ?? orgSignerName
      orgSignerEmail = invoker[0]?.email
    }
    if (!orgSignerEmail) {
      throw new Error('zapsign.send-contract: could not resolve organizadora signer email')
    }

    // 4. Build the ZapSign payload.
    const zapsignPayload: ZapsignCreateDocRequest = {
      name: `Contrato ${row.contract.id.slice(0, 8).toUpperCase()}`,
      url_pdf: presigned.url,
      signers: [
        { name: orgSignerName, email: orgSignerEmail, order_group: 1, send_automatic_email: true },
        {
          name: row.vendor.legalName,
          email: row.vendor.email,
          order_group: 2,
          send_automatic_email: true,
        },
      ],
      signature_order_active: true,
      lang: 'pt-br',
      external_id: row.contract.id,
    }

    // 5. POST to ZapSign.
    const response = await createDocument(zapsignPayload)

    // 6. INSERT zapsign_documents row.
    await db.insert(zapsignDocuments).values({
      tenantId: payload.tenant_id,
      contractId: row.contract.id,
      zapsignId: response.token,
      // Drizzle jsonb columns accept any JSON-serializable value at runtime.
      // biome-ignore lint/suspicious/noExplicitAny: jsonb takes any serializable shape
      payloadSend: zapsignPayload as any,
    })

    // 7. UPDATE contracts.
    await db
      .update(contracts)
      .set({
        status: 'awaiting_org',
        zapsignDocId: response.token,
        updatedAt: new Date(),
      })
      .where(eq(contracts.id, row.contract.id))

    // 8. Audit.
    await recordAudit(db, {
      action: 'contract.zapsign_sent',
      entity: 'contract',
      entityId: row.contract.id,
      userId: payload.user_id,
      payload: {
        zapsign_id: response.token,
        zapsign_open_id: response.open_id,
        signer_count: zapsignPayload.signers.length,
        status_new: 'awaiting_org',
      },
    })

    // 9. Enqueue email job — Plan 01-08 will register the handler. Payload
    //    shape matches the contract pinned by Plan 01-04 notifications.test.
    await enqueueJob(rawSqlFromTenantDb(db), EMAIL_STATUS_UPDATE_TASK, {
      tenant_id: payload.tenant_id,
      contract_id: row.contract.id,
      vendor_id: row.vendor.id,
      event: 'contrato_emitido',
      legal_name: row.vendor.legalName,
      email: row.vendor.email,
    })

    log.info(
      {
        component: 'job',
        task: ZAPSIGN_SEND_CONTRACT_TASK,
        jobId: String(helpers.job.id),
        contractId: row.contract.id,
        zapsignId: response.token,
        zapsignEnv: process.env.ZAPSIGN_ENV ?? 'sandbox',
      },
      'contract sent to ZapSign',
    )
  })
}
