"use strict";
// FB_EVENTOS — Contract Zod validators (Phase 1, Plan 01-05 Task 2).
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractIdSchema = exports.listContractsSchema = exports.emitContractSchema = void 0;
const zod_1 = require("zod");
exports.emitContractSchema = zod_1.z.object({
    lotAssignmentId: zod_1.z.uuid('Id de atribuição inválido'),
});
exports.listContractsSchema = zod_1.z.object({
    eventId: zod_1.z.uuid().optional(),
    status: zod_1.z
        .enum(['draft', 'awaiting_org', 'awaiting_fornecedor', 'signed', 'expired', 'cancelled'])
        .optional(),
});
exports.contractIdSchema = zod_1.z.object({
    contractId: zod_1.z.uuid('Id de contrato inválido'),
});
