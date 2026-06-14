// FB_EVENTOS — Task registry for Graphile-Worker (Phase 0, Plan 06).
//
// The runner consumes this `taskList` and dispatches `add_job` rows whose
// `identifier` matches one of the keys here. Every task added to the
// codebase must be registered here AND its file must carry the Pitfall 8
// withTenant() reminder header.

import type { TaskList } from 'graphile-worker'

import { echo } from './echo'
import { PDF_GENERATE_CONTRACT_TASK, pdfGenerateContract } from './pdf-generate-contract'

export const taskList: TaskList = {
  echo,
  [PDF_GENERATE_CONTRACT_TASK]: pdfGenerateContract,
}
