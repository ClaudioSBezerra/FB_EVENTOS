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

import type { TaskList } from 'graphile-worker'

import { echo } from './echo'
import { EMAIL_SEND_STATUS_UPDATE_TASK, emailSendStatusUpdate } from './email-send-status-update'
import { LOT_NOTIFY_CHANNEL_TASK, lotNotifyChannel } from './lot-notify-channel'
import { PAYMENT_PROCESS_WEBHOOK_TASK, paymentProcessWebhook } from './payment-process-webhook'
import { PDF_GENERATE_CONTRACT_TASK, pdfGenerateContract } from './pdf-generate-contract'
import { RESERVATION_EXPIRE_TASK, reservationExpire } from './reservation-expire'
import { ZAPSIGN_SEND_CONTRACT_TASK, zapsignSendContract } from './zapsign-send-contract'

export const taskList: TaskList = {
  echo,
  [PDF_GENERATE_CONTRACT_TASK]: pdfGenerateContract,
  [ZAPSIGN_SEND_CONTRACT_TASK]: zapsignSendContract,
  [EMAIL_SEND_STATUS_UPDATE_TASK]: emailSendStatusUpdate,
  [RESERVATION_EXPIRE_TASK]: reservationExpire,
  [LOT_NOTIFY_CHANNEL_TASK]: lotNotifyChannel,
  [PAYMENT_PROCESS_WEBHOOK_TASK]: paymentProcessWebhook,
}
