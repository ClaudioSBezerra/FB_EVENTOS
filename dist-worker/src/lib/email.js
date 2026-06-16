"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__emails = void 0;
exports.sendEmail = sendEmail;
const env_1 = require("./env");
// In-memory capture for tests (cleared between tests via __emails.reset()).
const inMemoryEmails = [];
const DEFAULT_FROM = 'FB_EVENTOS <no-reply@eventos.fbtax.cloud>';
async function sendViaSmtp(msg, opts) {
    // nodemailer is loaded lazily to keep cold-start lean in environments that
    // never actually send (e.g. NODE_ENV=test → memory transport).
    const nodemailer = await Promise.resolve().then(() => __importStar(require('nodemailer')));
    const transport = nodemailer.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure,
        ...(opts.ignoreTLS ? { ignoreTLS: true } : {}),
        ...(opts.user && opts.pass ? { auth: { user: opts.user, pass: opts.pass } } : {}),
    });
    await transport.sendMail({
        from: msg.from ?? env_1.env.SMTP_FROM ?? DEFAULT_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
    });
}
function sendViaMemory(msg) {
    inMemoryEmails.push(msg);
}
async function sendEmail(msg) {
    if (env_1.env.NODE_ENV === 'test') {
        sendViaMemory(msg);
        return;
    }
    if (env_1.env.NODE_ENV === 'production') {
        if (!env_1.env.SMTP_HOST) {
            throw new Error('SMTP_HOST missing — required for production email send.');
        }
        await sendViaSmtp(msg, {
            host: env_1.env.SMTP_HOST,
            port: env_1.env.SMTP_PORT ?? 587,
            secure: env_1.env.SMTP_SECURE ?? true,
            user: env_1.env.SMTP_USER,
            pass: env_1.env.SMTP_PASS,
        });
        return;
    }
    // dev fallback: mailpit at localhost:1025 by default, or operator-supplied
    // SMTP creds if present. Gracefully degrade to memory if SMTP not up.
    try {
        await sendViaSmtp(msg, {
            host: env_1.env.SMTP_HOST ?? 'localhost',
            port: env_1.env.SMTP_PORT ?? 1025,
            secure: env_1.env.SMTP_SECURE ?? false,
            ignoreTLS: true,
            user: env_1.env.SMTP_USER,
            pass: env_1.env.SMTP_PASS,
        });
    }
    catch (err) {
        // Don't crash dev login flow if SMTP isn't running.
        // eslint-disable-next-line no-console
        console.warn('[email] SMTP unreachable; capturing in-memory:', err.message);
        sendViaMemory(msg);
    }
}
/** Test helpers — read or clear captured emails. */
exports.__emails = {
    list() {
        return inMemoryEmails;
    },
    findByTo(to) {
        return [...inMemoryEmails].reverse().find((m) => m.to === to);
    },
    reset() {
        inMemoryEmails.length = 0;
    },
};
