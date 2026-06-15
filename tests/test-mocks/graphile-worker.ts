// FB_EVENTOS — Graphile Worker in-process task harness (Plan 02-01 Task 3, Wave 0).
//
// Deterministic helper for unit/integration tests that need to drive a scheduled
// task without spinning up an actual graphile-worker pool. Plans 02-03, 02-04,
// 02-06, 02-07 import `runTaskInline` to execute their tasks against test data.
//
// The harness reuses the production `taskList` from src/jobs/tasks/index.ts so
// tests stay coupled to the same task registration the runner uses.

import type { Helpers, JobHelpers, TaskList } from 'graphile-worker'

// Minimal subset of graphile-worker's JobHelpers — only what existing
// Phase 2 tasks consume. Plans 02-03/02-06 will extend if needed.
export type InlineHelpers = Partial<JobHelpers> & Pick<JobHelpers, 'logger' | 'addJob' | 'job'>

export type InlineHarnessOpts = {
  // Override the production taskList (e.g. inject test-only handlers).
  taskList?: TaskList
  // Capture addJob() invocations so tests can assert downstream enqueues.
  capturedJobs?: Array<{ taskName: string; payload: unknown }>
  // Custom logger; defaults to no-op.
  logger?: Helpers['logger']
}

const noopLogger: Helpers['logger'] = {
  // graphile-worker's Logger interface has scope/level helpers; the bare
  // minimum that tests need is the four log methods.
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  // Required helpers — typed loosely; tests rarely call them.
  scope: () => noopLogger,
} as unknown as Helpers['logger']

function buildHelpers(taskName: string, payload: unknown, opts: InlineHarnessOpts): InlineHelpers {
  const helpers: InlineHelpers = {
    logger: opts.logger ?? noopLogger,
    job: {
      id: '00000000-0000-0000-0000-000000000000',
      queue_name: null,
      task_identifier: taskName,
      payload,
      priority: 0,
      run_at: new Date(),
      attempts: 0,
      max_attempts: 1,
      last_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      key: null,
      locked_at: null,
      locked_by: null,
      revision: 0,
      flags: null,
    } as unknown as JobHelpers['job'],
    addJob: ((task: string, p: unknown) => {
      opts.capturedJobs?.push({ taskName: task, payload: p })
      return Promise.resolve({} as never)
    }) as JobHelpers['addJob'],
  }
  return helpers
}

export async function runTaskInline<T = unknown>(
  taskName: string,
  payload: T,
  opts: InlineHarnessOpts = {},
): Promise<void> {
  let taskList = opts.taskList
  if (!taskList) {
    // Lazy import the production taskList. If it does not exist yet
    // (Plans 02-03+ create it), throw a clear test-time error.
    const mod = (await import('@/jobs/tasks/index').catch(() => null)) as {
      taskList?: TaskList
    } | null
    if (!mod?.taskList) {
      throw new Error(
        `runTaskInline: src/jobs/tasks/index.ts has no exported taskList yet — Plan 02-03 introduces it.`,
      )
    }
    taskList = mod.taskList
  }

  const task = taskList[taskName]
  if (!task) {
    throw new Error(
      `runTaskInline: task "${taskName}" is not registered in taskList. Known: ${Object.keys(taskList).join(', ')}`,
    )
  }

  const helpers = buildHelpers(taskName, payload, opts)
  await task(payload, helpers as unknown as JobHelpers)
}
