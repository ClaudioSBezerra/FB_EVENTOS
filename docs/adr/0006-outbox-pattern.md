# ADR-0006: Transactional outbox pattern + polling drain

**Status:** Accepted (Phase 2, 2026-06-17)

**Context.**
Phase 1 wrote business state + side effects in the same Server Action: the
checkout flow committed the order, then enqueued the confirmation email job,
then synced ZapSign, then emitted SSE. Any crash between the COMMIT and the
side-effect ENQUEUE left an inconsistent state — order paid but no email,
contract approved but no signature dispatched, lot sold but no SSE refresh.

Phase 2 adds the marketplace + Pagar.me webhook ingest, which 10× the
number of side-effect cascades and makes "crash between commit and enqueue"
a daily event in production. We need atomic side-effect persistence.

**Decision.**
Adopt the transactional outbox pattern with a single `outbox_events` table
+ polling drain at ~60 s:

1. **Same-tx outbox INSERT.** Every business write that wants downstream
   effects also INSERTs an `outbox_events` row in the same transaction.
   `emitOutboxEvent(db, eventType, aggregateId, payload)` is the canonical
   helper. RLS scopes rows per tenant.
2. **Polling drain.** `outbox.drain` task scans pending rows under
   `FOR UPDATE SKIP LOCKED LIMIT 100`, enqueues the per-event-type handler
   task in the SAME transaction, and marks `processed_at = now()`. Concurrent
   drains don't conflict (SKIP LOCKED).
3. **Handler dispatch.** `src/jobs/outbox/handlers/index.ts::handlerForEventType`
   maps each event type to a Graphile-Worker task identifier. Unknown types
   are flagged `processing_status='failed'` so they don't loop forever.
4. **SSE-tier latency.** Lot status changes that originate inside a
   `withTenant` block use `emitOutboxEventAndNotify` — the outbox INSERT
   AND the `pg_notify` happen in the same tx. SSE consumers see the update
   in ≤500 ms instead of waiting for the next drain tick. The drain is the
   safety net for status changes that emerge from outside that path
   (e.g. webhook handler tx → outbox row, then drain → SSE refresh).
5. **Poison-row recovery.** Per drain row, `attempt_count` increments.
   At `attempt_count >= MAX_DRAIN_ATTEMPTS` (default 5) the row flips to
   `processing_status='failed'` with a Sentry warning. The partial index
   `outbox_events_unprocessed_idx` excludes failed + processed rows from
   the hot path.

**Comparison.**

| Approach | Latency | Atomicity | Multi-instance safe | Ops cost |
|---|---|---|---|---|
| **Outbox + polling drain (chosen)** | ≤60 s (drain) / ≤500 ms (notify) | Strong (same-tx INSERT) | SKIP LOCKED handles it | Single Postgres |
| LISTEN/NOTIFY only | ≤500 ms | Same-tx | One worker per channel; reconnect storms | Single Postgres |
| Per-event-type table | Per type | Strong | OK | N schemas, N indexes |
| Debezium CDC → Kafka | Sub-second | Eventual | Yes | New infra (Zookeeper, Connect, Kafka brokers) |
| Webhook → external queue | Variable | None | Yes | External vendor cost |

Outbox + drain is the minimum-infra option that keeps atomicity. SSE
latency stays sub-second via the same-tx pg_notify path (load-bearing
for the floor-plan live colors).

**Consequences.**
- Email / PDF / refund effects have ~60 s upper-bound latency. SSE
  status changes have ≤500 ms latency for the same-tx case; the drain is
  the fallback for cross-tx emissions.
- `outbox_events` grows unbounded until Phase 4 adds a retention job.
  Piloto Trindade volume estimate: ≤100k rows / week — non-issue.
- Cross-tenant SELECT in the drain requires the migrator role; per-row
  work re-enters `withTenant(payload.tenant_id)` so RLS still gates
  business reads. Pitfall 8 enforced by `tests/jobs/worker-without-with-tenant.test.ts`.
- Refund-after-sold race: payment-paid handler uses
  `pg_try_advisory_xact_lock(hashtext('lot:event_id:lot_id'))` — same key
  as the reservation lock. Pitfall 8 in 02-RESEARCH.

**Scheduling note.**
`graphile-worker`'s crontab parser rejects dotted task names. `outbox.drain`
and `reservation.expire` are scheduled via `setInterval` at the runner boot
instead — see `src/jobs/runner.ts` SCHEDULED_TASKS.

**References.**
- 02-PATTERNS.md §outbox-drain (lines 941-985)
- 02-RESEARCH.md Pitfall 11 (poison-row recovery)
- src/lib/outbox/emit.ts (emitOutboxEvent / emitOutboxEventAndNotify)
- src/jobs/tasks/outbox-drain.ts (drain body)
- src/jobs/outbox/handlers/ (4 handlers + index map)
- docs/adr/0001-queue-backend.md (Graphile-Worker base)
