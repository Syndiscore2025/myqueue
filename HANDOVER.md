# MyQueue — Agent Handover Report

> Onboarding document for the next engineer/agent. It captures what exists today,
> the rules and testing policies that must be followed, where and how we commit,
> and the full plan for the next phase (Phase 3B). Read this before touching code.

---

## 1. Project overview

**MyQueue** is a production backend platform (a SaaS that will eventually ship as
a Slack Marketplace app). It is built in strictly-typed TypeScript on a clean,
layered architecture and is delivered in **phases**, each as a stacked branch.

**Tech stack**

- **Runtime:** Node.js 22 LTS (`engines.node >= 22`), TypeScript (strict).
- **HTTP:** Express + Helmet, CORS, compression, rate limiting.
- **Data:** PostgreSQL via Prisma (`prisma ^6`).
- **Cache / queues:** Redis (ioredis), BullMQ.
- **Validation:** Zod (and `zod-to-openapi` for the OpenAPI doc).
- **Logging:** Pino (structured, per-request child loggers, `x-request-id`).
- **Docs:** OpenAPI 3 generated from Zod + Swagger UI at `/docs`.
- **Quality:** ESLint (flat, type-aware), Prettier, Jest (ts-jest), GitHub Actions.
- **Packaging:** Multi-stage Dockerfile; two processes (API + worker) from one image.

---

## 2. Repository & branch model — **where we commit**

- **Repo:** `github.com/Syndiscore2025/myqueue`.
- **Stacked branches per phase.** We never commit phase work directly to `main`.
  - Phase 2 lives on `feat/phase-2-slack-oauth`.
  - **Phase 3A lives on `feat/phase-3a-queue-engine`, branched off
    `feat/phase-2-slack-oauth`.** Its PR targets `feat/phase-2-slack-oauth`
    (NOT `main`) to keep each phase clean and dependent on the previous one.
- **Phase 3B** should follow the same pattern: branch
  `feat/phase-3b-queue-processing` off `feat/phase-3a-queue-engine`, PR targeting
  `feat/phase-3a-queue-engine`.
- **Conventional commits**, one per completed slice. Examples used in 3A:
  `feat(queue): ...`, `docs(queue): ...`.
- **Permission gates:** committing per slice is expected. **Pushing, opening PRs,
  merging, rebasing, installing deps, and deploying require explicit user
  approval** — do not do them unprompted.

### Current git state (at handover)

Branch `feat/phase-3a-queue-engine`, all six slices committed, working tree clean,
full quality gate green. **Not yet pushed; no PR opened** (awaiting approval).

| Commit    | Slice                                                            |
| --------- | --------------------------------------------------------------- |
| `ff18b9f` | Phase 3A queue domain **schema + migration**                    |
| `48193d0` | **Domain layer** (ranking, status rules, priority)              |
| `b204671` | Tenant-scoped **repositories** + unit tests                     |
| `5af9905` | **QueueService** application layer + unit tests                 |
| `c6c7cfc` | **`/api/v1/queue` HTTP API** behind workspace guard + OpenAPI + tests |
| `d68dd59` | **Documentation** (queue engine guide + doc updates)            |

---

## 3. Phase status

| Phase    | Scope                                                        | Status        |
| -------- | ----------------------------------------------------------- | ------------- |
| Phase 1  | Infrastructure foundation                                   | ✅ Complete   |
| Phase 2  | Slack Marketplace foundation (multi-tenant OAuth/install)   | ✅ Complete   |
| Phase 3A | Queue domain, ranking & position engine, internal API       | ✅ Complete   |
| **3B**   | **Queue processing engine & worker infrastructure**         | ⏭️ **Next**   |
| 3C       | Scheduled jobs / cron / delayed exec / partitions           | 🔒 Future     |
| 4        | Slack execution engine, AI agents, approvals, automation    | 🔒 Future     |

**Phase 3A is to be treated as production-ready. Do NOT modify or refactor it in
Phase 3B unless absolutely necessary.**

---

## 4. What Phase 3A delivered (architecture summary)

Clean architecture with dependencies pointing **inward**
(`interfaces`/`infrastructure` → `application` → `domain`):

| Layer             | Location                                          | Responsibility                                          |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `domain/queue`    | enums, ranking engine, status machine, priority   | Pure, framework-free rules. No I/O.                     |
| `infrastructure`  | `repositories/queue-*`                             | Tenant-scoped Prisma access; mints permanent ids.       |
| `application`     | `application/queue/queue-service.ts`              | Orchestrates repositories + domain; writes audit trail. |
| `interfaces/http` | `routes/queue.ts`, `middleware/workspace-context` | `/api/v1/queue` surface + the tenant guard.            |

**Key concepts (do not break these in 3B):**

- **Permanent ids vs. dynamic positions.** Each item gets a stable `MQ-000001`
  id (prefix `MQ-` + zero-padded per-workspace sequence, minted atomically via a
  transaction that increments `WorkspaceQueueSettings.lastQueueSeq`). **Positions
  are computed on read**, never stored as identity.
- **Ranking modes.** `FIFO` (oldest first) and `PRIORITY` (Red→Yellow→Green, then
  oldest-first), with `permanentQueueId` as a deterministic tiebreaker.
- **Active membership.** `New` always active; `Working`/`Waiting` configurable via
  `includeWorkingInActive` (default true) / `includeWaitingInActive` (default off).
- **Priority auto-classification.** Deterministic keyword classifier
  (Red→Yellow→Green) with explainable `matchedSignals` + `reason`.
- **Status lifecycle.** Strict state machine; initial state `New`; `Archived`
  terminal; `Done` may re-open to `Working`. Illegal transitions are rejected.
- **Tenant isolation.** Every repo method and service call is scoped by
  `workspaceId`; cross-tenant access returns "not found".
- **Audit trail.** Append-only `QueueEvent` log + status/priority/assignment
  history tables, each recording before/after and the acting user.
- **Auth caveat.** No real session auth yet. The `/api/v1/queue` routes are
  **internal/development-safe only**: the acting tenant is supplied via
  `x-workspace-id` and `x-workspace-user-id` headers and must not be exposed to
  untrusted clients as-is.

**Reference docs:** `docs/queue-engine.md` (engine + API), `docs/architecture.md`,
`docs/folder-structure.md`, `docs/testing.md`, `docs/environment.md`.

---

## 5. Engineering rules (must follow)

These are hard rules established across the project. Violating them is a defect.

1. **Clean architecture, strictly.** No business logic in controllers, routes, or
   repositories. All logic lives in **application services**. Repositories are
   **persistence-only**. Controllers/routes stay **thin** (parse → call service →
   serialize). `domain` depends on nothing external.
2. **No mock code, stubs, or placeholders in production paths.** Real
   implementations only. Mocks belong in tests.
3. **Every database query must be scoped by `workspaceId`.** No ambient/global
   tenant. Cross-tenant reads must return "not found", never another tenant's data.
4. **Permanent ids must be unique per workspace** and minted atomically.
5. **Validate all input with Zod** at the HTTP edge; invalid input → `400`.
   Keep the OpenAPI document in sync with the Zod schemas.
6. **No faked authentication.** Tenant/worker identity is supplied explicitly and
   documented as development-safe until real session auth exists.
7. **Run the full quality gate after every slice** (see §7) — zero regressions.
8. **Commit after every completed slice** with a conventional-commit message.
9. **Respect phase boundaries.** Do the requested phase only; **stop at the end of
   the phase and do not start the next one.** Get approval before push/PR/merge/
   rebase/dependency-install/deploy.
10. **Use the package manager** for dependency changes (never hand-edit
    `package.json`/lockfiles). For schema changes use Prisma migrations.
11. **Don't refactor completed phases** unless absolutely necessary; treat them as
    production-ready and keep them backward compatible.

---

## 6. Testing policy

- **Framework:** Jest + ts-jest, run serially (`jest --runInBand`). A global
  setup (`tests/jest.setup.ts`) provides a deterministic, non-secret env so
  config-validating modules import cleanly without a real `.env`.
- **Layout mirrors runtime:** `tests/unit/` for pure logic, `tests/integration/`
  for HTTP/external behavior.
- **Unit tests never touch external systems** and always run. Repository/service
  unit tests use **mocked Prisma**.
- **Integration/HTTP tests** use `supertest` against the real Express app with
  datastore health checks mocked, so they run anywhere.
- **Connectivity tests** (`*.connection.test.ts`) need live Postgres/Redis and are
  **skipped unless `RUN_INTEGRATION=true`**. CI runs them via service containers.
- **Every slice ships with tests.** Prefer updating existing tests over creating
  new files unless a new area genuinely warrants a new suite.
- **Current baseline:** 12 suites, **117 passed / 2 skipped** (skips are the gated
  connectivity tests). Phase 3B must keep this green and add concurrency +
  performance tests (see §9).

Existing queue suites: `tests/unit/queue-ranking-engine.test.ts`,
`tests/unit/repositories.test.ts`, `tests/unit/queue-service.test.ts`,
`tests/integration/queue-routes.test.ts`.

---

## 7. Quality gate (run after every slice; all must pass)

```bash
npm run format:check   # Prettier — code style
npm run lint           # ESLint — zero warnings allowed
npm run typecheck      # tsc --noEmit
npm test               # Jest (unit + integration)
npm run build          # tsc -p tsconfig.build.json
docker compose build   # api + worker images
```

On Windows PowerShell, gate the connectivity tests with
`$env:RUN_INTEGRATION = 'true'; npm test`.

---

## 8. Build / run commands

| Command                   | Description                                |
| ------------------------- | ------------------------------------------ |
| `npm run dev`             | API with hot reload (`tsx watch`)          |
| `npm run dev:worker`      | Background worker with hot reload          |
| `npm run build` / `start` | Compile to `dist/` / run compiled API      |
| `npm run start:worker`    | Run the compiled worker                    |
| `npm run prisma:generate` | Regenerate the Prisma client               |
| `npm run prisma:migrate`  | Apply migrations (`prisma migrate deploy`) |
| `docker compose -f docker-compose.dev.yml up -d` | Local Postgres + Redis |

---

## 9. Next phase — Phase 3B: Queue Processing Engine & Worker Infrastructure

> This is the authoritative spec for the next work. Phase 3A is complete and must
> be treated as production-ready — **do not modify or refactor it unless
> absolutely necessary.**

### Objective

Transform the queue from a passive scheduling engine into an **active processing
platform**. By the end of 3B, multiple workers must process queue items
simultaneously with **zero possibility of duplicate execution**. This phase adds:
worker infrastructure, queue locking, claiming, heartbeats, automatic recovery,
queue metrics, a processing pipeline, a retry engine, a Dead Letter Queue, and
processing events. **This is NOT Slack integration and NOT AI execution** — those
come later.

### Guiding principles

Maintain strict Clean Architecture. No business logic in controllers, routes, or
repositories — everything in application services. Repositories stay
persistence-only; controllers stay thin.

### Slices

1. **Worker locking.** One active owner per item. Add fields: `claimed_by_worker`,
   `claimed_at`, `heartbeat_at`, `lock_expires_at`, `attempt_count`,
   `processing_started_at`, `processing_completed_at`. Worker id supplied via
   `X-Worker-ID`; workers cannot operate without one.
2. **Queue claim engine (`QueueClaimService`).** `POST /api/v1/queue/claim`:
   begin tx → select highest-ranked queued item `FOR UPDATE SKIP LOCKED` → assign
   worker → mark Processing → save timestamps → commit. Guarantee: no two workers
   ever receive the same item.
3. **Worker heartbeats.** `POST /api/v1/queue/heartbeat` extends the lease,
   refreshing `heartbeat_at` and `lock_expires_at`. Workers that stop sending
   heartbeats become recoverable.
4. **Queue recovery (`QueueRecoveryService`).** Recover when `lock_expires_at <
   now()`: clear ownership, increment `attempt_count`, return status to Queued,
   write audit log. Must support batch processing.
5. **Retry engine.** Config `MAX_RETRY_ATTEMPTS`. On failure: `attempt++`; if
   attempts remain, return to queue; otherwise move to the Dead Letter Queue.
6. **Dead Letter Queue.** Items exceeding the retry limit become `DeadLetter`,
   storing failure reason, optional stack trace, worker, attempt count,
   timestamps. APIs: `GET /api/v1/queue/dead-letter`,
   `POST /api/v1/queue/dead-letter/requeue`.
7. **Queue metrics (`QueueStatisticsService`).** Expose counts (Queued,
   Processing, Completed, Failed, Cancelled, DeadLetter), average wait/processing
   time, retry count, worker utilization, oldest/newest queued item, average queue
   age, longest processing job, via `GET /api/v1/queue/statistics`.
8. **Worker registry.** Track `worker_id`, `hostname`, `started_at`, `last_seen`,
   `status`, `processing_count`. `GET /api/v1/workers`. Workers auto-register on
   first heartbeat.
9. **Processing events.** Internal domain events via an event-publisher
   abstraction (no external messaging yet): `QueueItemClaimed`,
   `QueueItemReleased`, `QueueItemCompleted`, `QueueItemFailed`, `QueueRecovered`,
   `RetryScheduled`, `DeadLetterCreated`.
10. **Concurrency testing.** Extensive concurrent tests with 2 / 5 / 20 / 100
    workers verifying: no duplicate processing, no lost items, no race conditions,
    no deadlocks, recovery works, retries work, DLQ works.

### Performance testing

Benchmark 1,000 and 10,000 queue items with 100 concurrent workers. Measure claim
latency, recovery latency, statistics latency, and memory usage. Document findings.

### Documentation to update

`README.md`, `docs/architecture.md`, `docs/testing.md`, `docs/queue-engine.md`,
`docs/folder-structure.md` — adding worker lifecycle, processing lifecycle, retry
flow, recovery flow, Dead Letter Queue, concurrency guarantees, performance
characteristics, and a configuration reference.

### New environment variables

`QUEUE_LOCK_MINUTES`, `QUEUE_HEARTBEAT_SECONDS`, `QUEUE_RECOVERY_BATCH_SIZE`,
`QUEUE_MAX_RETRIES`, `QUEUE_RECOVERY_INTERVAL` (add to the Zod env schema,
`.env.example`, and `docs/environment.md`).

### Commit strategy

Commit after each completed slice, in order: (1) locking schema, (2) claim
service, (3) heartbeats, (4) recovery, (5) retry engine, (6) DLQ, (7) worker
registry, (8) statistics, (9) concurrency tests, (10) documentation,
(11) final quality gate.

### Final deliverables

Architecture summary, new APIs, DB schema changes, concurrency guarantees,
performance benchmark results, test-coverage summary, commit list, and
confirmation that **Phase 3A behavior remains 100% backward compatible**.

**Stop after Phase 3B. Do not begin Phase 3C.**

---

## 10. Future roadmap (do not start)

- **Phase 3C:** Scheduled jobs, cron engine, delayed execution, recurring tasks,
  rate limiting, dependency graphs, queue partitions.
- **Phase 4:** Slack execution engine, AI agents, tool execution, approvals,
  human-in-the-loop workflows, multi-step automation.
