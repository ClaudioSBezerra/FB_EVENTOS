#!/usr/bin/env tsx
"use strict";
// FB_EVENTOS — Graphile-Worker entrypoint (Phase 0, Plan 06).
//
// This script runs as a SEPARATE Node process from the Next.js web server
// (Plan 07 wires it as its own Coolify service). Invoked via:
//
//     pnpm worker:dev      (tsx, local development — hot-reload off)
//     pnpm worker:start    (production — built JS bundle, Plan 07 specifies path)
//
// Graceful shutdown: graphile-worker installs SIGTERM/SIGINT handlers when
// `noHandleSignals: false` (the default we use in runner.ts). On signal,
// the runner stops accepting new jobs, waits for in-flight jobs to finish,
// then resolves the run() promise. We `await runner.promise` so this
// process exits cleanly with code 0 once the runner drains.
//
// On unexpected error the runner's promise rejects → we log + exit 1.
// Coolify's restart policy (`always`, Plan 07) brings the process back up.
Object.defineProperty(exports, "__esModule", { value: true });
const runner_1 = require("../../src/jobs/runner");
const logger_1 = require("../../src/lib/logger");
async function main() {
    const runner = await (0, runner_1.startWorker)();
    logger_1.logger.info({ component: 'graphile-worker' }, 'worker ready — awaiting jobs');
    // Block until the runner shuts down (signal or fatal error).
    await runner.promise;
    logger_1.logger.info({ component: 'graphile-worker' }, 'worker drained — exiting');
}
main().catch((err) => {
    logger_1.logger.error({ component: 'graphile-worker', err: err instanceof Error ? err.message : String(err) }, 'worker crashed');
    process.exit(1);
});
