# Queue Engine (Phase 3A)

The queue engine is the backend "brain" that tracks work items, ranks them into
per-owner queues, and records an auditable history of everything that happens to
them. Phase 3A delivers this engine end to end — domain logic, tenant-scoped
persistence, an application service, and an internal HTTP API — with **no** Slack
UI, notifications, billing, or AI on top of it yet (see
[Limitations](#phase-3a-limitations)).

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

## Phase 3A limitations

Phase 3A is the backend queue brain **only**. Intentionally out of scope:

- No Slack message/command ingestion or interactive UI (items arrive via the
  internal API for now).
- No notifications, reminders, or scheduled snooze/follow-up wake-ups — due dates
  are stored but nothing acts on them automatically.
- No billing, plans, or usage limits.
- No AI-based prioritization beyond the deterministic keyword classifier.
- No production user/session authentication — tenant context is header-supplied
  and development-safe only.
