// FB_EVENTOS — Graphile-Worker task: lot.notify-channel (Plan 02-04).
// STUB — implementation in GREEN phase of TDD.
import type { Task } from 'graphile-worker'

export const LOT_NOTIFY_CHANNEL_TASK = 'lot.notify-channel'

// biome-ignore lint/suspicious/noExplicitAny: stub
export const lotNotifyChannel: Task = async (_payload: any, _helpers) => {
  throw new Error('Not implemented yet')
}
