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
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Phase 1, Plan 01-05: Adds @vitejs/plugin-react so .tsx templates used
  // server-side by @react-pdf/renderer (src/contracts/templates/*.tsx)
  // transform under Vitest. Without this plugin Vitest can't parse JSX
  // because tsconfig.json sets `"jsx": "preserve"` for Next.js's compiler.
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // Force NODE_ENV=test BEFORE any user module is imported. This is
      // load-bearing for src/lib/email.ts which checks env.NODE_ENV at
      // parse time to choose the in-memory capture transport.
      NODE_ENV: 'test',
      // Pagar.me test credentials (dummy values — MSW intercepts real HTTP calls).
      // Overrides: individual tests that need a specific key can do process.env.X = Y.
      PAGARME_SECRET_KEY: 'sk_test_dummy',
      PAGARME_ENV: 'sandbox',
    },
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
