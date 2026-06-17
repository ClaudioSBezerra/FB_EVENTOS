// FB_EVENTOS — Stub for waitlist.notify-next (Plan 02-07 ships the body).
//
// The lot-released outbox handler enqueues this task by name. Until
// Plan 02-07 lands, the stub logs and returns no-op so the queue does
// not raise "task not found" + retry forever.

import type { Task } from 'graphile-worker'
import { logger } from '@/lib/logger'

export const WAITLIST_NOTIFY_NEXT_TASK = 'waitlist.notify-next'

export const waitlistNotifyNext: Task = async (rawPayload, helpers) => {
  const log = logger.child({
    task: WAITLIST_NOTIFY_NEXT_TASK,
    jobId: String(helpers.job.id),
  })
  log.info({ payload: rawPayload }, 'waitlist.notify-next stub — implement in Plan 02-07')
}
