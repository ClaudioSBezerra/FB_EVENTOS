"use strict";
// FB_EVENTOS — Postgres role declarations (Phase 0, Plan 03).
//
// Declares the `fb_eventos_app` role to Drizzle so `pgPolicy({ to: fbEventosApp, ... })`
// chains can reference it in tenant_isolation policies (RESEARCH Pattern 1).
//
// The role itself is created in migration 0000_roles_and_extensions.sql with
// NOBYPASSRLS — verified by tests/db/role-no-bypassrls.test.ts. The flags
// passed to pgRole() below describe the role's *intended* attributes for
// Drizzle's understanding; the migration is the source of truth for the
// actual catalog entry.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fbEventosApp = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.fbEventosApp = (0, pg_core_1.pgRole)('fb_eventos_app', {
    createDb: false,
    createRole: false,
    inherit: true,
});
