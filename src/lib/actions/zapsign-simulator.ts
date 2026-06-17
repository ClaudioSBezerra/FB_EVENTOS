// FB_EVENTOS — ZapSign simulator Server Actions (piloto, 2026-06-17).
//
// Pareado com payment-simulator. Quando o operador clica "Simular
// Assinatura" no painel do contrato:
//   1. Re-check ZAPSIGN_SIMULATOR_ENABLED — short-circuit se off.
//   2. Valida que contract.zapsignDocId começa com SIM_ (não opera contra
//      ZapSign real).
//   3. UPDATE contracts.status='signed', signed_pdf_minio_key=null (não
//      há PDF assinado real — o download que o webhook faria é skipped).
//   4. Enfileira email 'contrato_assinado' (mesmo payload que o webhook).
//   5. recordAudit('contract.simulated_signed').

'use server'

import { and, eq } from 'drizzle-orm'
import { headers as nextHeaders } from 'next/headers'
import { z } from 'zod'

import { auth } from '@/auth/server'
import { contracts } from '@/db/schema/contracts'
import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { isSimulatedZapsignToken, shouldUseZapsignSimulator } from '@/lib/zapsign/simulator'

const inputSchema = z.object({
  contractId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export type SimulateContractResult =
  | { ok: true }
  | {
      ok: false
      error:
        | 'simulator_disabled'
        | 'no_session'
        | 'invalid_input'
        | 'contract_not_found'
        | 'not_simulated'
        | 'wrong_status'
        | 'update_failed'
    }

export async function simulateContractSigned(raw: unknown): Promise<SimulateContractResult> {
  if (!shouldUseZapsignSimulator()) return { ok: false, error: 'simulator_disabled' }

  const parsed = inputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }

  const h = await nextHeaders()
  const session = await auth.api.getSession({ headers: h })
  if (!session) return { ok: false, error: 'no_session' }

  try {
    return await withTenant(parsed.data.tenantId, async (db) => {
      // 1. Load contract + check.
      const rows = await db
        .select({
          id: contracts.id,
          status: contracts.status,
          zapsignDocId: contracts.zapsignDocId,
          vendorId: contracts.vendorId,
        })
        .from(contracts)
        .where(eq(contracts.id, parsed.data.contractId))
        .limit(1)
      const row = rows[0]
      if (!row) return { ok: false as const, error: 'contract_not_found' as const }
      if (!isSimulatedZapsignToken(row.zapsignDocId)) {
        return { ok: false as const, error: 'not_simulated' as const }
      }
      if (row.status === 'signed') {
        // Already signed — treat as idempotent success.
        return { ok: true as const }
      }
      if (
        row.status !== 'awaiting_org' &&
        row.status !== 'awaiting_fornecedor' &&
        row.status !== 'draft'
      ) {
        return { ok: false as const, error: 'wrong_status' as const }
      }

      // 2. Flip status='signed'. signedPdfMinioKey stays NULL — no real PDF.
      await db
        .update(contracts)
        .set({ status: 'signed', updatedAt: new Date() })
        .where(
          and(
            eq(contracts.id, parsed.data.contractId),
            // Defensive: not race-updating a real-signing path.
            eq(contracts.zapsignDocId, row.zapsignDocId ?? ''),
          ),
        )

      // 3. Enqueue 'contrato_assinado' email (both org + vendor receive it).
      const tx = rawSqlFromTenantDb(db)
      await enqueueJob(tx, 'email.send-status-update', {
        tenant_id: parsed.data.tenantId,
        event: 'contrato_assinado',
        contract_id: parsed.data.contractId,
        vendor_id: row.vendorId,
      })

      // 4. Audit.
      await recordAudit(db, {
        action: 'contract.simulated_signed',
        entity: 'contract',
        entityId: parsed.data.contractId,
        userId: session.user.id,
        payload: {
          zapsign_doc_id: row.zapsignDocId,
          previous_status: row.status,
        },
      })

      return { ok: true as const }
    })
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        contractId: parsed.data.contractId,
      },
      'simulate_contract_signed_failed',
    )
    return { ok: false, error: 'update_failed' }
  }
}
