<!--
FB_EVENTOS PR template. Keep the body short; the CI gates do the heavy lifting.
Replace the example sections below with what this PR actually changes.
-->

## Summary

<!-- 1–3 bullets. The "why", not the "what". -->

-

## Linked Plan / Issue

<!-- Plan ID (e.g. 00-02), issue, or roadmap entry this PR realizes. -->

- Plan:
- Issue:

## Test Plan

<!-- What you ran locally and what CI should run. -->

- [ ] `pnpm run check:all` passes locally
- [ ] `pnpm lint && pnpm typecheck && pnpm build` pass locally
- [ ] Manual smoke (if user-facing change):

## Anti-Pitfall Checklist (contractual)

> CI enforces every box below. Tick to confirm you read them before opening
> the PR.

- [ ] No embedded DB introduced (no `sqlite3` / `better-sqlite3` / `@libsql/*`
      package; no `*.db` / `*.sqlite` / `tracker-*.db` file). See
      `CLAUDE.md` "Embedded-DB Anti-Pattern".
- [ ] No `drizzle-kit push` invocation added (always
      `drizzle-kit generate` + `drizzle-kit migrate`).
- [ ] No `:latest` tag in any workflow, Dockerfile, or compose file.
- [ ] No `fb_apu0[1-9]` legacy module name (this project is `fb-eventos`).
- [ ] Next.js stays pinned to `~15.5.x` (no `next@16`).
- [ ] No secrets committed (gitleaks runs in CI; pre-commit also scans).
- [ ] If touching PII / personal data: LGPD impact considered (consent
      version? retention? audit log entry?).

## Local Verification (paste evidence)

<!-- Useful when changes touch the floor plan, payments, or auth flows. -->

```
# example: pnpm run check:all output
```

## Notes for Reviewer

<!-- Anything the diff doesn't show: trade-offs, follow-ups, deferred items. -->
