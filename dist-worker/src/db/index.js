"use strict";
// FB_EVENTOS — Drizzle DB singleton (Phase 0, Plan 03).
//
// Exports:
//   - `pool`: the raw postgres.js client (DATABASE_URL = fb_eventos_app role).
//     Use this when you need transaction control directly (e.g., the
//     withTenant() wrapper in src/db/with-tenant.ts).
//   - `db`: the Drizzle wrapper around `pool` for non-tenant-scoped reads
//     (tenants table lookup, /api/health probe). Default-deny: any
//     `db.select()` against a tenant-owned table outside a withTenant()
//     block returns 0 rows because the RLS policy's
//     `current_setting('app.current_tenant_id', true)::uuid` evaluates to
//     NULL and the predicate becomes `tenant_id = NULL` (= false for all
//     rows). This is the load-bearing guarantee that protects against
//     forgotten withTenant() calls — verified by tests/db/rls-forced.test.ts.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const env_1 = require("@/lib/env");
const schema = __importStar(require("./schema"));
if (!env_1.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. See .env.example for the manifest. ' +
        'The runtime app role is fb_eventos_app (NO BYPASSRLS) — ' +
        'never substitute DATABASE_MIGRATOR_URL.');
}
exports.pool = (0, postgres_1.default)(env_1.env.DATABASE_URL, { max: 20 });
exports.db = (0, postgres_js_1.drizzle)(exports.pool, { schema });
