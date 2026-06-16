"use strict";
// FB_EVENTOS — Task registry for Graphile-Worker (Phase 0, Plan 06).
//
// The runner consumes this `taskList` and dispatches `add_job` rows whose
// `identifier` matches one of the keys here. Every task added to the
// codebase must be registered here AND its file must carry the Pitfall 8
// withTenant() reminder header.
//
// Phase 2 additions (Plan 02-03):
//   - reservation.expire — scheduled every minute via crontab in runner.ts.
//
// Phase 2 additions (Plan 02-04):
//   - lot.notify-channel — outbox-drain handler that pg_notifys the SSE
//     channel for lot status changes that happened outside the originating
//     transaction (e.g. payment.paid → lot.sold cascade via outbox.drain).
//
// Phase 2 stubs (Plans 02-06, 02-07 register these):
//   - outbox.drain, payment.process-webhook, waitlist.notify-next,
//     refund.process
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskList = void 0;
const echo_1 = require("./echo");
const email_send_status_update_1 = require("./email-send-status-update");
const lot_notify_channel_1 = require("./lot-notify-channel");
const payment_process_webhook_1 = require("./payment-process-webhook");
const pdf_generate_contract_1 = require("./pdf-generate-contract");
const reservation_expire_1 = require("./reservation-expire");
const zapsign_send_contract_1 = require("./zapsign-send-contract");
exports.taskList = {
    echo: echo_1.echo,
    [pdf_generate_contract_1.PDF_GENERATE_CONTRACT_TASK]: pdf_generate_contract_1.pdfGenerateContract,
    [zapsign_send_contract_1.ZAPSIGN_SEND_CONTRACT_TASK]: zapsign_send_contract_1.zapsignSendContract,
    [email_send_status_update_1.EMAIL_SEND_STATUS_UPDATE_TASK]: email_send_status_update_1.emailSendStatusUpdate,
    [reservation_expire_1.RESERVATION_EXPIRE_TASK]: reservation_expire_1.reservationExpire,
    [lot_notify_channel_1.LOT_NOTIFY_CHANNEL_TASK]: lot_notify_channel_1.lotNotifyChannel,
    [payment_process_webhook_1.PAYMENT_PROCESS_WEBHOOK_TASK]: payment_process_webhook_1.paymentProcessWebhook,
};
