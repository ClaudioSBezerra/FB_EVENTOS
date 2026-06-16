"use strict";
// FB_EVENTOS — Migrator postgres.js pool (Phase 1, Plan 01-05 Task 3).
//
// The runtime app role (fb_eventos_app) is NOBYPASSRLS. A small set of
// code paths legitimately need to read tenant-owned tables BEFORE a
// session/withTenant boundary exists — most notably the ZapSign webhook
// handler at /api/webhooks/zapsign which receives an opaque token and
// must resolve tenant_id from zapsign_documents to enter withTenant().
//
// The cleanest mechanism for that lookup is a BYPASSRLS pool keyed to
// the fb_eventos_migrator role (which Phase 0 already grants the
// privileges to read every domain table). This module exports that
// pool as `migratorPool` — DO NOT use it for any write that should be
// tenant-scoped (use withTenant + appPool for those).
//
// USAGE SCOPE:
//   - Webhook tenant resolution (zapsign_documents → tenant_id).
//   - Future: schedule/cron jobs that need cross-tenant aggregates.
//   - CI/test fixtures (separate `test/db.ts` already imports its own
//     migratorPool — this module is purely for production code).
//
// SAFETY: this module exists in src/db/ — a Server Component or Route
// Handler that imports it accepts the responsibility for bypass. Lint
// rules / CODEOWNERS reviewer responsibility.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migratorPool = void 0;
const postgres_1 = __importDefault(require("postgres"));
const env_1 = require("@/lib/env");
const isBuildTime = process.env.SKIP_ENV_VALIDATION === '1' || process.env.NEXT_PHASE === 'phase-production-build';
if (!isBuildTime && env_1.env.NODE_ENV !== 'test' && !env_1.env.DATABASE_MIGRATOR_URL) {
    // In production we MUST have a migrator URL to power the webhook tenant
    // lookup. In test the URL is read from process.env via setup.ts. In
    // build-time (`next build` page-data collection), the runtime URL isn't
    // available yet — Coolify supplies it at container start.
    throw new Error('DATABASE_MIGRATOR_URL is required for the webhook tenant-resolution pool. ' +
        'Configure it via Coolify env (Plan 07) or .env.local.');
}
// Small pool — webhook traffic is low volume, and we want to limit
// concurrent BYPASSRLS connections by construction.
exports.migratorPool = (0, postgres_1.default)(env_1.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_MIGRATOR_URL ?? '', { max: 4 });
