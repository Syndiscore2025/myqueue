# Queue Engine

The queue engine is the backend "brain" that tracks work items, ranks them into
per-owner queues, and records an auditable history of everything that happens to
them. It is delivered in two phases:

- **Phase 3A** — the passive scheduling engine: domain logic, tenant-scoped
  persistence, an application service, and an internal HTTP API.
- **Phase 3B** — the active [processing engine](#processing-engine-phase-3b):
  worker infrastructure that claims, locks, heartbeats, recovers, retries, and
  dead-letters items so many workers can process the queue concurrently with no
  duplicate execution.

There is still **no** Slack UI, notifications, billing, or AI on top of it yet
(see [Limitations](#limitations)).

## Layered design

The engine follows the same inward-pointing layering as the rest of the platform
(see [architecture.md](./architecture.md)):

| Layer            | Module                                          | Responsibility                                          |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `domain/queue`   | enums, ranking engine, status machine, priority | Pure, framework-free rules. No I/O.                     |
| `infrastructure` | `repositories/queue-*`                           | Tenant-scoped Prisma access; mints permanent ids.       |
| `application`    | `queue/queue-service.ts`                         | Orchestrates repositories + domain; records audit trail.|
| `interfaces/http`| `routes/queue.ts`, `middleware/workspace-context`| `/api/v1/queue` surface + the tenant guard.            |

## Permanent ids vs. dynamic positions

Two different notions of "identity" coexist, and keeping them separate is central
to the design:

- **Permanent queue id** — a stable, human-friendly label minted once per item in
  the form `MQ-000001` (prefix `MQ-` + a zero-padded, per-workspace sequence). It
  is generated atomically inside a transaction that increments the workspace's
  `lastQueueSeq` counter, so ids are unique and monotonic **within a workspace**.
  This id never changes and is what the API and users refer to.
- **Position** — a 1-based rank computed **on read** from the current set of
  active items and the workspace ranking settings. Positions are **never stored
  as identity**; completing or removing any item (even out of order) and
  re-ranking the remainder always yields a correct, gap-free sequence.

## Ranking modes

Each owner's active queue is ordered by one of two modes (a per-workspace
setting). Both modes use the item's `permanentQueueId` as a final, deterministic
tiebreaker so equal timestamps never produce an unstable order.

| Mode       | Ordering                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `FIFO`     | Oldest `rankingTimestamp` first.                                         |
| `PRIORITY` | Priority tier first (Red → Yellow → Green), then oldest-first within a tier. |

## Active-queue membership

Ranking only applies to items that count as "active". Membership is decided per
status and is partly configurable via workspace settings:

| Status     | In active queue?                                  |
| ---------- | ------------------------------------------------- |
| `New`      | Always.                                           |
| `Working`  | When `includeWorkingInActive` is true (default).  |
| `Waiting`  | When `includeWaitingInActive` is true (default off).|
| others     | Never (they have their own views).                |

`Waiting`, `FollowUp`, and `Done`/completed-today items are read through their own
dedicated list endpoints rather than the ranked active queue.

## Priority rules

Priority has three tiers — **Red** (urgent), **Yellow** (needs attention), and
**Green** (low). When an item is created without an explicit priority, the
`PriorityClassificationService` assigns one deterministically:

1. **Red** wins if any urgent signal is present — whole-word, case-insensitive
   keyword matches (e.g. `urgent`, `asap`, `outage`, `p0`, `blocker`) or a known
   imminent deadline.
2. Otherwise **Yellow** if any attention signal is present — attention keywords
   (e.g. `today`, `review`, `deadline`), a question (the text contains `?` or is
   flagged as a question), or the owner being @-mentioned.
3. Otherwise **Green**.

Classification is explainable: every result carries the `matchedSignals` and a
human-readable `reason`, and auto-classifications are recorded in the priority
history with `automatic: true`. Matching is token-based, so `down` never matches
`download`.

## Status lifecycle

Every item starts in `New`. Transitions are governed by a strict state machine;
any move not listed below is rejected with an invalid-transition error. A no-op
(`from === to`) is never allowed.

| From       | Allowed to                                                  |
| ---------- | ---------------------------------------------------------- |
| `New`      | Working, Waiting, FollowUp, Snoozed, Done, Archived        |
| `Working`  | Waiting, FollowUp, Snoozed, Done, Archived                 |
| `Waiting`  | Working, FollowUp, Snoozed, Done, Archived                 |
| `FollowUp` | Working, Waiting, Snoozed, Done, Archived                  |
| `Snoozed`  | New, Working, Waiting, FollowUp, Done, Archived            |
| `Done`     | Working (re-open), Archived                                |
| `Archived` | — (terminal)                                               |

Entering certain statuses has timestamp side effects: `Done` sets `completedAt`,
`Archived` sets `archivedAt`, `Snoozed` sets `snoozedUntil`, and `FollowUp` sets
`followUpDueAt`. Un-snoozing returns an item to `New` and clears `snoozedUntil`.

## Tenant isolation

Multi-tenancy is enforced at every layer, not just the edge:

- Every repository method takes a `workspaceId` and scopes all reads/writes by
  it; cross-tenant access returns "not found" rather than another tenant's data.
- The permanent-id sequence counter and the `@@unique([workspaceId,
  permanentQueueId])` constraint are per workspace, so ids never collide or leak
  across tenants.
- Every `QueueService` method requires an explicit `QueueContext`
  (`workspaceId` + `workspaceUserId`); there is no ambient/global tenant.

## Audit trail

Two append-only logs capture history for every mutation:

- **Queue events** (`QueueEvent`) — a chronological action log
  (`CREATED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `ASSIGNED`/`REASSIGNED`,
  `SNOOZED`/`UNSNOOZED`, `COMPLETED`, `ARCHIVED`, `RECALCULATED`, …), including
  queue-wide events with no specific item.
- **History tables** — status, priority, and assignment changes each record the
  before/after values and the acting user, with priority changes flagged
  `automatic` vs. manual.

## Processing engine (Phase 3B)

Phase 3B turns the passive queue into an active processing platform. Multiple
workers pull work concurrently with a hard guarantee of **no duplicate
execution**, abandoned work is recovered automatically, failures are retried with
a budget, and exhausted items land in a Dead Letter Queue.

### Worker process & lifecycle

The background worker (`src/workers/index.ts`) is a separate long-running process
built from the same image as the API. On boot it connects to PostgreSQL and Redis
and starts the **recovery loop**; on graceful shutdown it stops the loop and
closes its connections. Application workers (the processes that actually claim and
process items) identify themselves with an `X-Worker-ID` header on every
worker-facing call and cannot operate without one. A worker **auto-registers** in
the [worker registry](#worker-registry) on its first claim or heartbeat.

### Processing lifecycle

A single item moves through claim → heartbeat → terminal outcome:

1. **Claim** — `POST /claim` atomically moves the highest-ranked `New` item to
   `Processing`, assigns `claimedByWorkerId`, and stamps `claimedAt`,
   `processingStartedAt`, `heartbeatAt`, and `lockExpiresAt`
   (`now + QUEUE_LOCK_MINUTES`). Returns the item, or nothing when the queue is
   empty. Ranking honors the workspace mode (FIFO or PRIORITY).
2. **Heartbeat** — `POST /heartbeat` extends the lease, refreshing `heartbeatAt`
   and `lockExpiresAt`. A worker should heartbeat every `QUEUE_HEARTBEAT_SECONDS`
   while it holds an item.
3. **Outcome** — the worker calls exactly one of:
   - `POST /complete` → `Processing → Done`, stamps `processingCompletedAt`,
     clears the lease.
   - `POST /release` → `Processing → New`, clears the lease **without**
     incrementing the attempt count (a graceful give-back).
   - `POST /fail` → runs the [retry engine](#retry-flow).

Every worker outcome verifies the caller still holds the lease; if the item was
reclaimed or changed concurrently the call fails with a conflict rather than
corrupting state.

### Claiming & locking

`claimNext` selects the candidate row with `FOR UPDATE SKIP LOCKED` inside a
transaction, so concurrent workers **skip** rows already locked by an in-flight
claim instead of blocking or receiving the same item. This is the core mechanism
that makes duplicate execution impossible.

### Recovery flow

A worker that crashes or stalls stops sending heartbeats, so its lease expires.
The recovery loop (`QueueRecoveryService`) sweeps on a `QUEUE_RECOVERY_INTERVAL`
cadence: it reclaims `Processing` items whose `lockExpiresAt < now()` in batches
of `QUEUE_RECOVERY_BATCH_SIZE`, returns them to `New`, increments
`attemptCount`, and audits each one (`QueueRecovered`). The sweep also uses
`FOR UPDATE SKIP LOCKED`, so concurrent sweeps never double-recover a row.

### Retry flow

On `POST /fail` the attempt count is incremented and the next state is decided
purely from the budget:

- **Retries remain** (`attemptCount < QUEUE_MAX_RETRIES`) → `Processing → New`,
  the item is re-queued (`RetryScheduled`).
- **Budget exhausted** (`attemptCount >= QUEUE_MAX_RETRIES`) → `Processing →
  DeadLetter`, recording the failure reason, optional stack trace, owning worker,
  attempt count, and `deadLetteredAt`.

### Dead Letter Queue

Dead-lettered items are parked, never re-attempted automatically, and surfaced via
`GET /dead-letter`. An operator can revive one with
`POST /dead-letter/requeue`, which moves it `DeadLetter → New` and **resets** the
attempt count and all failure/lease state so it gets a fresh processing budget.

### Worker registry

`worker_registrations` tracks each `workerId` with its `hostname`, `startedAt`,
`lastSeenAt`, `status`, and processing count. Workers auto-register on first
contact and refresh `lastSeenAt` on every claim/heartbeat. `GET /api/v1/workers`
lists the workspace's workers, each with a live count of items currently
`Processing`.

### Statistics

`QueueStatisticsService` (`GET /statistics`) reports per-status counts (`New`,
`Processing`, `Done`, `DeadLetter`, …), average wait and processing time, total
and average retries, oldest/newest queued item, average queue age, the longest
in-flight job, and **worker utilization** (busy vs. total registered workers).

### Processing events

Worker outcomes publish internal domain events through an `EventPublisher`
abstraction (currently a structured-logging publisher — no external messaging
yet): `QueueItemClaimed`, `QueueItemReleased`, `QueueItemCompleted`,
`QueueItemFailed`, `QueueRecovered`, `RetryScheduled`, and `DeadLetterCreated`.

### Concurrency guarantees

Verified by the concurrency suite (2 / 5 / 20 / 100 workers, see
[testing.md](./testing.md)):

- **No duplicate processing** — `FOR UPDATE SKIP LOCKED` on claim means an item is
  handed to at most one worker.
- **No lost items** — every seeded item reaches a terminal state; releases and
  recoveries return work to the queue rather than dropping it.
- **No double recovery** — `FOR UPDATE SKIP LOCKED` on the recovery CTE keeps
  concurrent sweeps from reclaiming the same row twice.
- **No torn writes** — outcomes are lease-checked, scoped updates, so a stale
  worker cannot overwrite an item another worker has taken over.

### Performance characteristics

Claims and outcomes are round-trip-bound (a short transaction each), so end-to-end
throughput scales with database round-trip latency and connection-pool width
rather than CPU. Statistics are computed with aggregate queries that stay fast at
depth (sub-20 ms for 10k items in local sampling), and recovery is bounded per
sweep by `QUEUE_RECOVERY_BATCH_SIZE`. The performance suite measures claim,
recovery, and statistics latency over a bounded sample at 1k/10k depth;
authoritative large-scale numbers are captured on an isolated/staging database.

### Configuration reference

Processing behavior is tuned by five environment variables (full descriptions in
[environment.md](./environment.md)):

| Variable                    | Default | Controls                                          |
| --------------------------- | ------- | ------------------------------------------------- |
| `QUEUE_LOCK_MINUTES`        | `5`     | Lease lifetime set on claim before it expires.    |
| `QUEUE_HEARTBEAT_SECONDS`   | `30`    | How often workers should refresh the lease.       |
| `QUEUE_RECOVERY_BATCH_SIZE` | `100`   | Max expired locks reclaimed per recovery sweep.   |
| `QUEUE_MAX_RETRIES`         | `3`     | Total attempts before an item is dead-lettered.   |
| `QUEUE_RECOVERY_INTERVAL`   | `60`    | Seconds between background recovery sweeps.        |

## HTTP API

All routes are mounted under `/api/v1/queue` and are documented in the generated
OpenAPI document (`GET /openapi.json`, Swagger UI at `/docs`).

> **Internal / development-safe only.** Until production session auth exists, the
> acting tenant is supplied explicitly via two request headers rather than a real
> login. A caller can assert any identity, so **do not expose these routes to
> untrusted clients as-is.** The guard only enforces that both headers are present
> so every downstream query and audit record is tenant-scoped.

| Header               | Meaning                          |
| -------------------- | -------------------------------- |
| `x-workspace-id`      | The tenant (workspace) to act in.|
| `x-workspace-user-id` | The acting user within it.      |

Requests missing either header are rejected with `401`.

### Endpoints

| Method & path                                  | Purpose                                  |
| ---------------------------------------------- | ---------------------------------------- |
| `POST /items`                                   | Create an item (priority auto-classified if omitted). |
| `GET /items/:permanentQueueId`                  | Fetch an item with its computed position.|
| `GET /active`                                    | Ranked active queue for an owner.        |
| `GET /waiting`                                   | Waiting items for an owner.              |
| `GET /follow-up`                                 | Follow-up items for an owner.            |
| `GET /completed-today`                           | Items completed since local midnight.   |
| `POST /recalculate`                              | Recompute positions; logs `RECALCULATED`.|
| `GET /settings` / `PATCH /settings`              | Read / update workspace queue settings.  |
| `POST /items/:id/status`                         | Transition status (state-machine checked).|
| `POST /items/:id/complete` / `.../archive`       | Shortcuts to `Done` / `Archived`.        |
| `POST /items/:id/waiting` / `.../follow-up`      | Move to Waiting / FollowUp.              |
| `POST /items/:id/snooze` / `.../unsnooze`        | Snooze until a time / wake back to `New`.|
| `POST /items/:id/priority`                       | Change priority (manual).               |
| `POST /items/:id/assign`                         | Reassign to a new owner.                |

`GET` list endpoints accept an optional `ownerWorkspaceUserId` query parameter and
default to the acting user. All request bodies and params are Zod-validated;
invalid input returns `400`.

### Processing endpoints (Phase 3B)

Worker-facing endpoints additionally require an `X-Worker-ID` header identifying
the calling worker; requests without it are rejected. Operator endpoints use the
standard workspace headers above.

| Method & path                  | Caller   | Purpose                                            |
| ------------------------------ | -------- | -------------------------------------------------- |
| `POST /claim`                  | worker   | Atomically claim the next item (`New → Processing`).|
| `POST /heartbeat`              | worker   | Extend the lease on the claimed item.              |
| `POST /complete`               | worker   | Mark the item done (`Processing → Done`).          |
| `POST /release`                | worker   | Give the item back (`Processing → New`, no retry). |
| `POST /fail`                   | worker   | Report failure → retry or dead-letter.             |
| `GET /dead-letter`             | operator | List dead-lettered items.                          |
| `POST /dead-letter/requeue`    | operator | Revive an item (`DeadLetter → New`, fresh budget). |
| `GET /statistics`              | operator | Aggregate queue + worker statistics.               |
| `GET /api/v1/workers`          | operator | List registered workers with live processing counts.|

### Example

```bash
# Create an item, letting the engine classify priority
curl -X POST http://localhost:3000/api/v1/queue/items \
  -H 'content-type: application/json' \
  -H 'x-workspace-id: ws_123' \
  -H 'x-workspace-user-id: usr_456' \
  -d '{ "title": "Production outage in checkout", "summary": "ASAP" }'

# Read the acting user's ranked active queue
curl http://localhost:3000/api/v1/queue/active \
  -H 'x-workspace-id: ws_123' \
  -H 'x-workspace-user-id: usr_456'
```

## Testing

The engine is covered by unit and integration suites (run with `npm test`; see
[testing.md](./testing.md)):

- `tests/unit/queue-ranking-engine.test.ts` — ranking modes, active filtering,
  position assignment, out-of-order completion, status-machine rules.
- `tests/unit/repositories.test.ts` — permanent-id format, `workspaceId`
  scoping, status filtering, event/history recording.
- `tests/unit/queue-service.test.ts` — application use cases and audit-trail
  side effects with mocked repositories.
- `tests/integration/queue-routes.test.ts` — the HTTP surface: the tenant guard,
  validation rejections, create/read, mutations, and OpenAPI registration.
- `tests/integration/queue-concurrency.test.ts` — 2 / 5 / 20 / 100 workers draining
  a shared pool with no duplicate processing or lost items, plus recovery and
  retry/DLQ under load (gated by `RUN_INTEGRATION`).
- `tests/integration/queue-performance.test.ts` — bounded claim/recovery/statistics
  latency benchmarks at 1k/10k depth (gated by `RUN_INTEGRATION`).

## Limitations

The queue engine is the backend processing brain **only**. Intentionally out of
scope:

- No Slack message/command ingestion or interactive UI (items arrive via the
  internal API for now).
- No AI execution of work — workers claim, lock, and report outcomes, but the
  actual task logic is not part of this phase.
- No notifications, reminders, or scheduled snooze/follow-up wake-ups — due dates
  are stored but nothing acts on them automatically.
- No billing, plans, or usage limits.
- No AI-based prioritization beyond the deterministic keyword classifier.
- No production user/session authentication — tenant **and worker** identity are
  header-supplied and development-safe only.
