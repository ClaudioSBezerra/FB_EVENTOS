-- FB_EVENTOS — two_factor.verified column (Phase 0, Plan 04 — Task 3 fix).
--
-- Better Auth's twoFactor plugin requires a `verified` boolean column on
-- the two_factor table. Plan 03 schema missed it; Rule 1 fix during
-- tests/auth/two-factor.test.ts execution.
--
ALTER TABLE "two_factor" ADD COLUMN "verified" boolean DEFAULT true;