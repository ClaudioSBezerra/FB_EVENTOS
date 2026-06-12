// FB_EVENTOS — Transactional email wrapper (Phase 0, Plan 04).
//
// In production: uses Resend (env.RESEND_API_KEY) for transactional emails.
// In dev/test: posts via SMTP to mailpit (localhost:1025) so verification
// and password-reset links land in the mailpit UI (http://localhost:8025).
// In test (NODE_ENV='test'), a tiny in-memory transport accumulates emails
// for assertion by integration tests (see __emails for read-back).
//
// This module is intentionally minimal — Plan 06 will swap a richer
// implementation with retry/queue via Graphile-Worker.

import { Resend } from 'resend'
import { env } from './env'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  from?: string
}

// In-memory capture for tests (cleared between tests via reset()).
const inMemoryEmails: EmailMessage[] = []

const DEFAULT_FROM = 'FB_EVENTOS <no-reply@fb-eventos.local>'

async function sendViaResend(msg: EmailMessage): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY missing — required for production email send.')
  }
  const resend = new Resend(env.RESEND_API_KEY)
  await resend.emails.send({
    from: msg.from ?? DEFAULT_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  })
}

async function sendViaMailpit(msg: EmailMessage): Promise<void> {
  // nodemailer is loaded only in dev/test paths to keep prod cold-start small.
  const nodemailer = await import('nodemailer')
  const transport = nodemailer.createTransport({
    host: 'localhost',
    port: 1025,
    secure: false,
    ignoreTLS: true,
  })
  await transport.sendMail({
    from: msg.from ?? DEFAULT_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
  })
}

function sendViaMemory(msg: EmailMessage): void {
  inMemoryEmails.push(msg)
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (env.NODE_ENV === 'test') {
    sendViaMemory(msg)
    return
  }
  if (env.NODE_ENV === 'production' && env.RESEND_API_KEY) {
    await sendViaResend(msg)
    return
  }
  // dev fallback: mailpit. Gracefully degrade to memory if mailpit not up.
  try {
    await sendViaMailpit(msg)
  } catch (err) {
    // Don't crash dev login flow if mailpit isn't running.
    // eslint-disable-next-line no-console
    console.warn('[email] mailpit unreachable; capturing in-memory:', (err as Error).message)
    sendViaMemory(msg)
  }
}

/** Test helpers — read or clear captured emails. */
export const __emails = {
  list(): readonly EmailMessage[] {
    return inMemoryEmails
  },
  findByTo(to: string): EmailMessage | undefined {
    return [...inMemoryEmails].reverse().find((m) => m.to === to)
  },
  reset(): void {
    inMemoryEmails.length = 0
  },
}
