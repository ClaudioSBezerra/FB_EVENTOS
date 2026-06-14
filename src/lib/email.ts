// FB_EVENTOS — Transactional email wrapper (Phase 0 Plan 04; Phase 1 Plan
// 01-08 D-14 gate decision swapped Resend for SMTP + nodemailer per
// user-locked decision at the gate — "estrutura própria de envio de
// e-mails", see RUNBOOK § Phase 1 — D-14 Gate).
//
// In production: SMTP via nodemailer (host/port/user/pass from env). The
// operator points SMTP_HOST at their managed SMTP server (Hostinger /
// postfix / etc).
// In dev (NODE_ENV=development): SMTP via nodemailer pointing at mailpit
// (host: localhost, port: 1025, no auth) so verification + reset links
// land in the mailpit UI at http://localhost:8025.
// In test (NODE_ENV=test): tiny in-memory transport accumulates emails
// for assertion (see `__emails` for read-back).
//
// nodemailer is the single dependency. NO Resend, NO HTTP API — pure SMTP.

import { env } from './env'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  /** Optional plain-text alternative (preferred by some MUAs + accessibility). */
  text?: string
  from?: string
}

// In-memory capture for tests (cleared between tests via __emails.reset()).
const inMemoryEmails: EmailMessage[] = []

const DEFAULT_FROM = 'FB_EVENTOS <no-reply@eventos.fbtax.cloud>'

interface SmtpOpts {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  ignoreTLS?: boolean
}

async function sendViaSmtp(msg: EmailMessage, opts: SmtpOpts): Promise<void> {
  // nodemailer is loaded lazily to keep cold-start lean in environments that
  // never actually send (e.g. NODE_ENV=test → memory transport).
  const nodemailer = await import('nodemailer')
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    ...(opts.ignoreTLS ? { ignoreTLS: true } : {}),
    ...(opts.user && opts.pass ? { auth: { user: opts.user, pass: opts.pass } } : {}),
  })
  await transport.sendMail({
    from: msg.from ?? env.SMTP_FROM ?? DEFAULT_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    ...(msg.text ? { text: msg.text } : {}),
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

  if (env.NODE_ENV === 'production') {
    if (!env.SMTP_HOST) {
      throw new Error('SMTP_HOST missing — required for production email send.')
    }
    await sendViaSmtp(msg, {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE ?? true,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    })
    return
  }

  // dev fallback: mailpit at localhost:1025 by default, or operator-supplied
  // SMTP creds if present. Gracefully degrade to memory if SMTP not up.
  try {
    await sendViaSmtp(msg, {
      host: env.SMTP_HOST ?? 'localhost',
      port: env.SMTP_PORT ?? 1025,
      secure: env.SMTP_SECURE ?? false,
      ignoreTLS: true,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    })
  } catch (err) {
    // Don't crash dev login flow if SMTP isn't running.
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP unreachable; capturing in-memory:', (err as Error).message)
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
