"use strict";
// FB_EVENTOS — Drizzle schema barrel (Phase 0, Plan 03).
//
// Single re-export point so `drizzle({ schema })` and consumers can import
// the full schema namespace with one import. New tables added in later
// plans MUST be re-exported here — drizzle-kit reads this file (configured
// as the `schema:` entry in drizzle.config.ts) to discover what to generate.
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./audit"), exports);
__exportStar(require("./auth"), exports);
__exportStar(require("./cart_addon_lines"), exports);
__exportStar(require("./cnpj-cache"), exports);
__exportStar(require("./consent"), exports);
__exportStar(require("./contracts"), exports);
__exportStar(require("./event_addons"), exports);
__exportStar(require("./events"), exports);
__exportStar(require("./lot_reservations"), exports);
__exportStar(require("./lot_waitlist"), exports);
__exportStar(require("./lots"), exports);
__exportStar(require("./outbox_events"), exports);
__exportStar(require("./payment_webhooks_inbox"), exports);
__exportStar(require("./payments"), exports);
__exportStar(require("./refund_requests"), exports);
__exportStar(require("./roles"), exports);
__exportStar(require("./tenants"), exports);
__exportStar(require("./vendor_consents"), exports);
__exportStar(require("./vendors"), exports);
