// FB_EVENTOS — Drizzle schema barrel (Phase 0, Plan 03).
//
// Single re-export point so `drizzle({ schema })` and consumers can import
// the full schema namespace with one import. New tables added in later
// plans MUST be re-exported here — drizzle-kit reads this file (configured
// as the `schema:` entry in drizzle.config.ts) to discover what to generate.

export * from './audit'
export * from './auth'
export * from './consent'
export * from './roles'
export * from './tenants'
