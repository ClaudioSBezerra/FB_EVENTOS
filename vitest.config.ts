// FB_EVENTOS — Vitest configuration (Phase 0, Plan 03).
//
// Runs Node-environment unit + integration tests. DB tests in tests/db/ are
// serialized via singleFork because they share the local Postgres state
// (TRUNCATE between tests, no per-test schema isolation in Phase 0).
//
// In Phase 1+ when test count grows, switch to pg-mem or testcontainers for
// per-suite isolation. The single-fork approach is fine for Phase 0's 3 RLS
// contract tests + Plan 04's auth tests.

import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30000,
    // Serialize DB tests on a single worker. Different test files run
    // sequentially, so TRUNCATE in afterEach cleans up before the next
    // file starts — no cross-file race conditions. Vitest 4 dropped the
    // poolOptions key from the InlineConfig type but still honors the
    // CLI/positional equivalent via fileParallelism: false.
    fileParallelism: false,
    // Limit which files run as tests (avoid scanning node_modules).
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
