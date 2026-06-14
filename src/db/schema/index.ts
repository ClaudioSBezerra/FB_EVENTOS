// FB_EVENTOS — Drizzle schema barrel (Phase 0, Plan 03).
//
// Single re-export point so `drizzle({ schema })` and consumers can import
// the full schema namespace with one import. New tables added in later
// plans MUST be re-exported here — drizzle-kit reads this file (configured
// as the `schema:` entry in drizzle.config.ts) to discover what to generate.

export * from './audit'
export * from './auth'
export * from './cart_addon_lines'
export * from './cnpj-cache'
export * from './consent'
export * from './contracts'
export * from './event_addons'
export * from './events'
export * from './lot_reservations'
export * from './lot_waitlist'
export * from './lots'
export * from './outbox_events'
export * from './payment_webhooks_inbox'
export * from './payments'
export * from './refund_requests'
export * from './roles'
export * from './tenants'
export * from './vendor_consents'
export * from './vendors'
