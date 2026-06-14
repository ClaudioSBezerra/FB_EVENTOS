// FB_EVENTOS — ZapSign webhook handler (Phase 1, Plan 01-05 Task 3).
//
// Receives POST callbacks from ZapSign and transitions the contracts FSM
// through:
//
//   draft → awaiting_org → awaiting_fornecedor → signed
//                                              → expired
//                                              → cancelled (refused)
//
// SECURITY MODEL (D-01 / ADR-0002):
//   1. HTTP Basic Auth header verified against ZAPSIGN_WEBHOOK_USER +
//      ZAPSIGN_WEBHOOK_PASS env. Missing/wrong auth → 401.
//   2. **Belt-and-suspenders re-fetch**: after Basic Auth passes, the
//      handler GETs the document from ZapSign API via getDocument(token)
//      and trusts the API response over the webhook payload. Webhook is
//      a notification; API is the source of truth.
//   3. Always returns 200 to ZapSign on processable events (idempotent
//      via UNIQUE on zapsign_documents.zapsign_id — duplicates no-op).
//      Returns 400 only when the re-fetch fails so ZapSign retries.
//
// TENANT RESOLUTION:
//   No session yet; we resolve tenant_id from zapsign_documents.zapsign_id
//   via the migrator pool (BYPASSRLS) BEFORE entering withTenant() to
//   apply the FSM transition.

import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { migratorPool } from '@/db/migrator-pool'
import { contracts, zapsignDocuments } from '@/db/schema/contracts'
import { withTenant } from '@/db/with-tenant'
import { enqueueJob } from '@/jobs/enqueue'
import { rawSqlFromTenantDb } from '@/jobs/raw-sql-from-tenant-db'
import { EMAIL_STATUS_UPDATE_TASK } from '@/jobs/tasks/zapsign-send-contract'
import { recordAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { getMinIOClient, getTenantBucket } from '@/lib/storage/minio'
import { downloadSignedPdf, getDocument } from '@/lib/zapsign/client'
import { type ZapsignWebhookPayload, zapsignWebhookPayloadSchema } from '@/lib/zapsign/types'

// ────────────────────────────────────────────────────────────────────────────
// Logger — bound with component=webhook.zapsign so every line correlates
// to this handler in the aggregator.
// ────────────────────────────────────────────────────────────────────────────

const log = logger.child({ component: 'webhook.zapsign' })

// ────────────────────────────────────────────────────────────────────────────
// Basic Auth check
// ────────────────────────────────────────────────────────────────────────────

function verifyBasicAuth(req: NextRequest): boolean {
  const expectedUser = process.env.ZAPSIGN_WEBHOOK_USER
  const expectedPass = process.env.ZAPSIGN_WEBHOOK_PASS
  if (!expectedUser || !expectedPass) {
    // If the operator has not configured Basic Auth, REJECT every request.
    // Failing closed is the only safe default for unconfigured webhook auth.
    return false
  }
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Basic ')) return false
  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx < 0) return false
    const user = decoded.slice(0, idx)
    const pass = decoded.slice(idx + 1)
    return user === expectedUser && pass === expectedPass
  } catch {
    return false
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tenant resolution by zapsign_id (BYPASSRLS lookup via migratorPool)
// ────────────────────────────────────────────────────────────────────────────

async function resolveTenantForZapsignId(zapsignId: string): Promise<{
  tenantId: string
  contractId: string
} | null> {
  const rows = await migratorPool<Array<{ tenant_id: string; contract_id: string }>>`
    SELECT tenant_id, contract_id
      FROM zapsign_documents
     WHERE zapsign_id = ${zapsignId}
     LIMIT 1
  `
  const r = rows[0]
  return r ? { tenantId: r.tenant_id, contractId: r.contract_id } : null
}

// ────────────────────────────────────────────────────────────────────────────
// FSM transition (re-fetch from API as source of truth)
// ────────────────────────────────────────────────────────────────────────────

interface FsmInputs {
  tenantId: string
  tenantSlug: string
  contractId: string
  zapsignId: string
  webhookEventType: string
  apiStatus: string
  signedFile: string | null
  apiSigners: Array<{ status: string; order_group?: number; signed_at?: string | null }>
}

interface FsmResult {
  newStatus: string | null
  signedPdfMinioKey: string | null
}

function decideNextStatus(inputs: FsmInputs): FsmResult {
  // The API status is the load-bearing input. ZapSign documents progress:
  //   pending → signed   (every signer completed)
  //   pending → refused  (any signer rejected)
  //   pending → expired  (deadline passed)
  const status = inputs.apiStatus.toLowerCase()
  if (status === 'signed') {
    return { newStatus: 'signed', signedPdfMinioKey: `contracts/${inputs.contractId}/signed.pdf` }
  }
  if (status === 'refused' || status === 'rejected') {
    return { newStatus: 'cancelled', signedPdfMinioKey: null }
  }
  if (status === 'expired') {
    return { newStatus: 'expired', signedPdfMinioKey: null }
  }
  // Partial-progress: at least one signer signed but document still pending.
  // Map to awaiting_fornecedor when the org signer (order_group=1) has signed.
  if (status === 'pending') {
    const orgSigned = inputs.apiSigners.some((s) => s.order_group === 1 && s.status === 'signed')
    const fornecedorSigned = inputs.apiSigners.some(
      (s) => s.order_group === 2 && s.status === 'signed',
    )
    if (orgSigned && !fornecedorSigned) {
      return { newStatus: 'awaiting_fornecedor', signedPdfMinioKey: null }
    }
  }
  return { newStatus: null, signedPdfMinioKey: null }
}

// ────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Basic Auth.
  if (!verifyBasicAuth(req)) {
    log.warn('unauthorized webhook delivery (Basic Auth failed)')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 2. Parse + validate payload.
  let parsed: ZapsignWebhookPayload
  try {
    const raw = (await req.json()) as unknown
    parsed = zapsignWebhookPayloadSchema.parse(raw)
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'invalid webhook payload')
    // Return 200 so ZapSign doesn't retry forever on a malformed payload.
    return NextResponse.json({ ok: true, ignored: 'invalid_payload' }, { status: 200 })
  }

  // 3. Resolve tenant via zapsign_documents lookup (no session yet).
  const resolved = await resolveTenantForZapsignId(parsed.token)
  if (!resolved) {
    log.warn({ zapsignId: parsed.token }, 'no zapsign_documents row found for token — ignoring')
    return NextResponse.json({ ok: true, ignored: 'unknown_token' }, { status: 200 })
  }

  // 4. Belt-and-suspenders RE-FETCH from ZapSign API. If this fails, return
  //    400 so ZapSign retries the webhook.
  let apiDoc: Awaited<ReturnType<typeof getDocument>>
  try {
    apiDoc = await getDocument(parsed.token)
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err), zapsignId: parsed.token },
      'ZapSign API re-fetch failed — returning 400 so ZapSign retries',
    )
    return NextResponse.json({ error: 'refetch_failed' }, { status: 400 })
  }

  // Resolve tenant slug for MinIO bucket addressing.
  const tenantSlugRows = await migratorPool<Array<{ slug: string }>>`
    SELECT slug FROM tenants WHERE id = ${resolved.tenantId} LIMIT 1
  `
  const tenantSlug = tenantSlugRows[0]?.slug
  if (!tenantSlug) {
    log.warn(
      { tenantId: resolved.tenantId },
      'tenant row not found for zapsign_documents — ignoring',
    )
    return NextResponse.json({ ok: true, ignored: 'tenant_missing' }, { status: 200 })
  }

  // 5. Apply FSM transition inside withTenant.
  const fsmDecision = decideNextStatus({
    tenantId: resolved.tenantId,
    tenantSlug,
    contractId: resolved.contractId,
    zapsignId: parsed.token,
    webhookEventType: parsed.event_type,
    apiStatus: apiDoc.status,
    signedFile: apiDoc.signed_file ?? null,
    apiSigners: apiDoc.signers.map((s) => ({
      status: s.status,
      order_group: s.order_group,
      signed_at: s.signed_at ?? null,
    })),
  })

  try {
    await withTenant(resolved.tenantId, async (db) => {
      // Append webhook payload to zapsign_documents.payload_callback (idempotent
      // via the UNIQUE on zapsign_id — the row exists already, we UPDATE).
      await db
        .update(zapsignDocuments)
        .set({
          // biome-ignore lint/suspicious/noExplicitAny: jsonb accepts any serializable
          payloadCallback: parsed as any,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(zapsignDocuments.zapsignId, parsed.token),
            eq(zapsignDocuments.contractId, resolved.contractId),
          ),
        )

      // Idempotency: if the contract is already in a terminal state, skip
      // status update + signed-PDF download + email enqueue.
      const currentRows = await db
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, resolved.contractId))
        .limit(1)
      const currentStatus = currentRows[0]?.status ?? null
      const TERMINAL = new Set(['signed', 'cancelled', 'expired'])

      if (fsmDecision.newStatus === null) {
        // No transition triggered (e.g. viewed event). Audit only.
        await recordAudit(db, {
          action: 'contract.zapsign_webhook',
          entity: 'contract',
          entityId: resolved.contractId,
          userId: '00000000-0000-0000-0000-000000000000',
          payload: {
            zapsign_id: parsed.token,
            event_type: parsed.event_type,
            api_status: apiDoc.status,
            no_transition: true,
          },
        })
        return
      }

      if (currentStatus && TERMINAL.has(currentStatus)) {
        // Already in terminal state — duplicate webhook delivery. No-op.
        // We deliberately drop ALL transitions into a terminal state (even
        // the legitimate "first arrival at signed"), because the FIRST
        // arrival already ran the signed-PDF download + email enqueue under
        // its own commit; a second delivery should not duplicate those
        // side-effects. The first arrival is detectable by currentStatus
        // being awaiting_* at the time of the UPDATE (not yet terminal).
        return
      }

      // Download + upload signed PDF on the terminal signed transition.
      let signedPdfMinioKey: string | null = null
      if (fsmDecision.newStatus === 'signed' && fsmDecision.signedPdfMinioKey) {
        try {
          const signedBuf = await downloadSignedPdf(parsed.token)
          await getMinIOClient().putObject(
            getTenantBucket(tenantSlug),
            fsmDecision.signedPdfMinioKey,
            signedBuf,
            signedBuf.length,
            { 'Content-Type': 'application/pdf' },
          )
          signedPdfMinioKey = fsmDecision.signedPdfMinioKey
        } catch (err) {
          log.error(
            {
              err: err instanceof Error ? err.message : String(err),
              zapsignId: parsed.token,
              contractId: resolved.contractId,
            },
            'signed PDF download/upload failed — contract.status update aborted; ZapSign should retry',
          )
          // Re-throw so the withTenant transaction rolls back and the
          // route handler can return 400 to ZapSign for retry.
          throw err
        }
      }

      // UPDATE contracts.
      const updates: Partial<typeof contracts.$inferInsert> = {
        status: fsmDecision.newStatus,
        updatedAt: new Date(),
      }
      if (signedPdfMinioKey) updates.signedPdfMinioKey = signedPdfMinioKey
      await db.update(contracts).set(updates).where(eq(contracts.id, resolved.contractId))

      // Idempotent audit — repeated webhook deliveries for the SAME terminal
      // state are dropped early (TERMINAL check above), so only the first
      // transition lands an audit row.
      await recordAudit(db, {
        action: 'contract.zapsign_webhook',
        entity: 'contract',
        entityId: resolved.contractId,
        userId: '00000000-0000-0000-0000-000000000000',
        payload: {
          zapsign_id: parsed.token,
          event_type: parsed.event_type,
          api_status: apiDoc.status,
          status_new: fsmDecision.newStatus,
          signed_pdf_minio_key: signedPdfMinioKey,
        },
      })

      // Enqueue email on the signed transition (Plan 01-08 will register
      // the handler). Pinned payload shape matches Plan 01-04 contract.
      if (fsmDecision.newStatus === 'signed') {
        await enqueueJob(rawSqlFromTenantDb(db), EMAIL_STATUS_UPDATE_TASK, {
          tenant_id: resolved.tenantId,
          contract_id: resolved.contractId,
          event: 'contrato_assinado',
        })
      }
    })
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'withTenant block failed — returning 400 so ZapSign retries',
    )
    return NextResponse.json({ error: 'transition_failed' }, { status: 400 })
  }

  log.info(
    {
      zapsignId: parsed.token,
      contractId: resolved.contractId,
      eventType: parsed.event_type,
      apiStatus: apiDoc.status,
      newStatus: fsmDecision.newStatus,
    },
    'webhook processed',
  )

  return NextResponse.json({ ok: true }, { status: 200 })
}
