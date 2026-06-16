"use strict";
// FB_EVENTOS — Pino structured logger (Phase 0, Plan 06 — FOUND-10).
//
// The single Pino instance for the server process. Every Server Action,
// Server Component, Route Handler, and Graphile-Worker task should call
// `childLogger({requestId, tenantId, userId})` to obtain a bound logger
// whose every line carries the correlation IDs.
//
// CONTRACT (matches RESEARCH Pattern 8 + Plan 06 acceptance criteria):
//
//   - JSON output to stdout in production. Pino's default destination is
//     process.stdout (fd 1) with synchronous writes — this is what we want
//     in production so log lines are not lost when a container is killed.
//     CI/Coolify ship stdout to the log aggregator (Coolify → Loki/Sentry
//     side-channel; OOB of this plan).
//
//   - pino-pretty transport ONLY in NODE_ENV=development. In `test` we still
//     emit JSON so the in-memory destination capture in
//     tests/logging/request-id-binding.test.ts can parse it. In `production`
//     we emit JSON for log aggregator ingest.
//
//   - The `redact` list is load-bearing for FOUND-10 ("no secrets in
//     structured logs"). Adding a new credential field anywhere in the code
//     base should grow this list — every entry blocks an entire class of
//     accidental leakage. The patterns use Pino's path syntax (`*.token`
//     matches `token` at any nesting depth via the wildcard prefix).
//
//   - `base` carries the service identifier so multi-service deployments
//     (FB_EVENTOS web + worker) can be partitioned in the log aggregator
//     without a separate field per source.
//
// SECURITY NOTE: This module deliberately does NOT import @/lib/env (which
// validates the full env at module-load time). Reading process.env.LOG_LEVEL
// directly keeps the logger usable in the Edge runtime (middleware.ts) and
// in instrumentation.ts before env validation has run.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.childLogger = childLogger;
const pino_1 = __importDefault(require("pino"));
const isDev = process.env.NODE_ENV === 'development';
/**
 * Singleton Pino logger. Imported as `import { logger } from '@/lib/logger'`
 * in code that doesn't have a request scope (cold paths like
 * instrumentation-node.ts, scripts/jobs/start-worker.ts).
 *
 * For request-scoped code use `childLogger({requestId, tenantId})` instead so
 * every emitted line carries the correlation IDs.
 */
exports.logger = (0, pino_1.default)({
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
        service: 'fb-eventos-web',
        env: process.env.NODE_ENV ?? 'development',
    },
    redact: [
        // Top-level credential fields (Pino's `*.x` patterns only match one
        // level deep — top-level `password` requires an explicit entry).
        'password',
        'token',
        'secret',
        'authorization',
        // Wildcard one-level-deep — catches { user: { password } } shapes.
        '*.password',
        '*.token',
        '*.secret',
        '*.authorization',
        // Common HTTP request fields that carry credentials.
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
    ],
    transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
});
/**
 * Bind correlation IDs (requestId, tenantId, userId) onto a child logger.
 * Every line emitted via the returned logger will include the bound fields
 * in its JSON payload, enabling end-to-end request tracing across the web
 * process and the Graphile-Worker process.
 *
 * Typical use:
 *   const log = childLogger({ requestId, tenantId, userId })
 *   log.info({ action: 'event.created' }, 'event created')
 *
 * @param bindings  Subset of correlation IDs to bind. Omitting a field means
 *                  Pino simply won't emit it on this child — children can be
 *                  further refined with .child({...}) downstream.
 */
function childLogger(bindings) {
    return exports.logger.child(bindings);
}
