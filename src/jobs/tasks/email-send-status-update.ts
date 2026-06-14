// FB_EVENTOS — Graphile-Worker task: email.send-status-update
// (Phase 1, Plan 01-08 — ORG-17).
//
// ─────────────────────────────────────────────────────────────────────────
// RESEARCH Pitfall 8 — withTenant() inside the worker (load-bearing):
// ─────────────────────────────────────────────────────────────────────────
// Like every other tenant-scoped task in this codebase, this handler MUST
// wrap its body in withTenant(payload.tenant_id, fn). Without it, every
// SELECT against vendors/contracts/payments/tenants returns 0 rows
// (RLS default-deny) and the email is silently never sent.
//
// Failure-mode probe: tests/email/send-status-update.test.ts case
// "worker without withTenant — vendor invisible → throws".
//
// Flow per event:
//   1. Parse payload via Zod (tenant_id + event + per-event refs).
//   2. withTenant(tenant_id):
//      a. Resolve tenant (slug + name) from `tenants` global lookup.
//      b. Per event, resolve recipient(s) + template data.
//      c. Render template via templateRegistry[event](data).
//      d. sendEmail({to, subject, text, html}).
//      e. recordAudit('email.sent', {template, recipient_email_hash, ...}).
//
// AUDIT PAYLOAD: email is hashed (SHA-256) before landing in audit_log so
// the audit row does not duplicate PII directly. The vendor row is still
// load-bearing for forensics (audit_log → contracts → vendors join).

import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Task } from 'graphile-worker'
import { z } from 'zod'

import { member, organization, user as userTable } from '@/db/schema/auth'
import { contracts } from '@/db/schema/contracts'
import { payments } from '@/db/schema/payments'
import { tenants } from '@/db/schema/tenants'
import { vendors } from '@/db/schema/vendors'
import { withTenant } from '@/db/with-tenant'
import { recordAudit } from '@/lib/audit'
import { sendEmail } from '@/lib/email'
import { type TemplateOutput, templateRegistry, type VendorEmailEvent } from '@/lib/email/templates'
import { childLogger } from '@/lib/logger'
import { formatBRL } from '@/lib/lots/price'

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

export const EMAIL_SEND_STATUS_UPDATE_TASK = 'email.send-status-update'

// ────────────────────────────────────────────────────────────────────────────
// Payload schema — uniform envelope, optional per-event fields
// ────────────────────────────────────────────────────────────────────────────

export const emailSendStatusUpdatePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  event: z.enum([
    'signup_fornecedor',
    'aprovacao_fornecedor',
    'rejecao_fornecedor',
    'contrato_emitido',
    'contrato_assinado',
    'pagamento_recebido',
  ]),
  vendor_id: z.string().uuid().optional(),
  contract_id: z.string().uuid().optional(),
  payment_id: z.string().uuid().optional(),
  // Optional vendor identity passed straight in payload (Plan 01-04 stub
  // contract — saves a re-query in the handler).
  legal_name: z.string().optional(),
  email: z.string().optional(),
  reason: z.string().optional(),
})

export type EmailSendStatusUpdatePayload = z.infer<typeof emailSendStatusUpdatePayloadSchema>

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s.toLowerCase()).digest('hex')
}

interface ResolvedTenant {
  id: string
  slug: string
  name: string
}

interface Recipient {
  email: string
  name: string
}

// ────────────────────────────────────────────────────────────────────────────
// Task handler
// ────────────────────────────────────────────────────────────────────────────

export const emailSendStatusUpdate: Task = async (rawPayload, helpers) => {
  const payload = emailSendStatusUpdatePayloadSchema.parse(rawPayload ?? {})
  const log = childLogger({ tenantId: payload.tenant_id })

  await withTenant(payload.tenant_id, async (db) => {
    // 1. Resolve tenant — `tenants` is a global lookup (no RLS) but we
    //    still issue the query through the tenant-scoped db handle to keep
    //    the transaction boundary uniform.
    const tenantRows = await db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, payload.tenant_id))
      .limit(1)
    const tenant = tenantRows[0]
    if (!tenant) {
      throw new Error(
        `email.send-status-update: tenant ${payload.tenant_id} not found (deleted or wrong id)`,
      )
    }

    const recipients = await resolveRecipients(db, payload)
    if (recipients.length === 0) {
      // No recipients means the row(s) we needed could not be read — RLS
      // boundary or soft-deleted. Throw so Graphile-Worker retries with
      // backoff (consistent with pdf-generate-contract Pitfall 8 contract).
      throw new Error(
        `email.send-status-update: no recipients resolved for event=${payload.event} (RLS scope?)`,
      )
    }

    // 2. Render per recipient (some templates personalize the body name).
    for (const recipient of recipients) {
      const rendered = renderTemplate(payload.event, payload, tenant, recipient)
      await sendEmail({
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.html ?? `<pre>${escapePre(rendered.text)}</pre>`,
        text: rendered.text,
      })
      await recordAudit(db, {
        action: 'email.sent',
        entity: 'email',
        entityId: payload.vendor_id ?? payload.contract_id ?? payload.payment_id,
        userId: TEMPLATE_SYSTEM_USER_ID,
        payload: {
          template: payload.event,
          recipient_email_hash: sha256(recipient.email),
          subject: rendered.subject,
          tenant_slug: tenant.slug,
        },
      })
    }

    log.info(
      {
        component: 'job',
        task: EMAIL_SEND_STATUS_UPDATE_TASK,
        jobId: String(helpers.job.id),
        event: payload.event,
        recipientCount: recipients.length,
      },
      'status-update email(s) sent',
    )
  })
}

/**
 * Synthetic system user UUID for audit rows on email sends. Production
 * deployments may swap this for a "system" Better Auth user, but for Phase 1
 * a deterministic UUID keeps recordAudit's NOT NULL constraint satisfied.
 *
 * Audit-log forensics can still trace back to the originating actor via
 * vendor_id / contract_id / payment_id in payload.
 */
const TEMPLATE_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001'

function escapePre(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ────────────────────────────────────────────────────────────────────────────
// Recipient resolution per event
// ────────────────────────────────────────────────────────────────────────────

async function resolveRecipients(
  db: Parameters<Parameters<typeof withTenant>[1]>[0],
  payload: EmailSendStatusUpdatePayload,
): Promise<Recipient[]> {
  switch (payload.event) {
    case 'signup_fornecedor':
    case 'aprovacao_fornecedor':
    case 'rejecao_fornecedor':
    case 'contrato_emitido': {
      // Vendor-only events. Prefer payload.email + payload.legal_name when
      // the upstream enqueuer supplied them (avoids a redundant SELECT).
      if (payload.email && payload.legal_name) {
        return [{ email: payload.email, name: payload.legal_name }]
      }
      if (!payload.vendor_id && !payload.contract_id) return []
      let vendorRow: { email: string; legalName: string } | undefined
      if (payload.vendor_id) {
        const rows = await db
          .select({ email: vendors.email, legalName: vendors.legalName })
          .from(vendors)
          .where(and(eq(vendors.id, payload.vendor_id), isNull(vendors.deletedAt)))
          .limit(1)
        vendorRow = rows[0]
      } else if (payload.contract_id) {
        const rows = await db
          .select({ email: vendors.email, legalName: vendors.legalName })
          .from(contracts)
          .innerJoin(vendors, eq(vendors.id, contracts.vendorId))
          .where(and(eq(contracts.id, payload.contract_id), isNull(contracts.deletedAt)))
          .limit(1)
        vendorRow = rows[0]
      }
      if (!vendorRow) return []
      return [{ email: vendorRow.email, name: vendorRow.legalName }]
    }

    case 'contrato_assinado':
    case 'pagamento_recebido': {
      // Two recipients: organizadora user + vendor.
      const recipients: Recipient[] = []
      // Vendor side — resolved via contract or payment FK chain.
      let vendorRow: { email: string; legalName: string } | undefined
      if (payload.contract_id) {
        const rows = await db
          .select({ email: vendors.email, legalName: vendors.legalName })
          .from(contracts)
          .innerJoin(vendors, eq(vendors.id, contracts.vendorId))
          .where(and(eq(contracts.id, payload.contract_id), isNull(contracts.deletedAt)))
          .limit(1)
        vendorRow = rows[0]
      } else if (payload.payment_id) {
        const rows = await db
          .select({ email: vendors.email, legalName: vendors.legalName })
          .from(payments)
          .innerJoin(contracts, eq(contracts.id, payments.contractId))
          .innerJoin(vendors, eq(vendors.id, contracts.vendorId))
          .where(and(eq(payments.id, payload.payment_id), isNull(payments.deletedAt)))
          .limit(1)
        vendorRow = rows[0]
      }
      if (vendorRow) recipients.push({ email: vendorRow.email, name: vendorRow.legalName })

      // Organizadora side — first owner-role member of the active tenant.
      const orgRows = await db.select({ id: organization.id }).from(organization).limit(1)
      const org = orgRows[0]
      if (org) {
        const ownerRows = await db
          .select({ email: userTable.email, name: userTable.name })
          .from(member)
          .innerJoin(userTable, eq(userTable.id, member.userId))
          .where(eq(member.organizationId, org.id))
          .orderBy(member.createdAt)
          .limit(1)
        const owner = ownerRows[0]
        if (owner?.email) {
          recipients.push({ email: owner.email, name: owner.name ?? 'Organizadora' })
        }
      }
      return recipients
    }

    default: {
      const _exhaustive: never = payload.event
      throw new Error(`email.send-status-update: unhandled event ${_exhaustive as string}`)
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Template rendering per event
// ────────────────────────────────────────────────────────────────────────────

function renderTemplate(
  event: VendorEmailEvent,
  payload: EmailSendStatusUpdatePayload,
  tenant: ResolvedTenant,
  recipient: Recipient,
): TemplateOutput {
  switch (event) {
    case 'signup_fornecedor':
      return templateRegistry.signup_fornecedor({
        vendorName: recipient.name,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
      })
    case 'aprovacao_fornecedor':
      return templateRegistry.aprovacao_fornecedor({
        vendorName: recipient.name,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
      })
    case 'rejecao_fornecedor':
      return templateRegistry.rejecao_fornecedor({
        vendorName: recipient.name,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        reason: payload.reason ?? 'Motivo não informado',
      })
    case 'contrato_emitido':
      return templateRegistry.contrato_emitido({
        vendorName: recipient.name,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        contractRef: shortRef(payload.contract_id ?? ''),
      })
    case 'contrato_assinado':
      return templateRegistry.contrato_assinado({
        recipientName: recipient.name,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        contractRef: shortRef(payload.contract_id ?? ''),
      })
    case 'pagamento_recebido':
      return templateRegistry.pagamento_recebido({
        recipientName: recipient.name,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        contractRef: shortRef(payload.contract_id ?? ''),
        amountBRL: formatBRL(0),
        paymentId: payload.payment_id ?? '',
      })
    default: {
      const _exhaustive: never = event
      throw new Error(`email.send-status-update: no template for event ${_exhaustive as string}`)
    }
  }
}

function shortRef(uuidOrEmpty: string): string {
  if (!uuidOrEmpty) return 'N/A'
  return uuidOrEmpty.slice(0, 8).toUpperCase()
}
