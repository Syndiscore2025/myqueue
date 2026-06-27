# MyQueue Handover Report

> Onboarding document for the next engineer/agent. It captures the current state
> through Phase 5, the rules that must be followed, the branch model, validation
> commands, what remains for Phases 6–8, and recommended gaps to close before a
> public launch.

---

## 1. Project overview

**MyQueue** is a production backend platform intended to ship as a Slack
Marketplace app. It is built in strictly typed TypeScript with a clean layered
architecture and delivered in stacked branches by phase.

**Tech stack**

- **Runtime:** Node.js 22 LTS, TypeScript strict mode.
- **HTTP:** Express, Helmet, CORS, compression, rate limiting.
- **Data:** PostgreSQL via Prisma.
- **Cache / workers:** Redis, BullMQ, API + worker processes.
- **Validation/docs:** Zod, generated OpenAPI 3, Swagger UI at `/docs`.
- **Logging:** Pino structured logging with request ids.
- **Quality:** ESLint, Prettier, Jest, GitHub Actions, Docker.

---

## 2. Branch and permission model

- **Repo:** `github.com/Syndiscore2025/myqueue`.
- Work is done as stacked branches. Do not commit phase work directly to `main`.
- Current Phase 5 branch: `feat/phase-5-automation-notifications`.
- Phase 5 was branched from `feat/phase-4-slack-experience` and should target
  that branch if a PR is opened.
- Use conventional commits and commit completed slices separately.
- **Ask before:** push, PR creation, merge, rebase, dependency install, deploy,
  production data changes, or long/expensive staging-scale tests.

---

## 3. Current phase status

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 1 | Infrastructure foundation | ✅ Complete |
| Phase 2 | Slack Marketplace foundation / multi-tenant install | ✅ Complete |
| Phase 3A | Queue domain, ranking, positions, internal queue API | ✅ Complete |
| Phase 3B | Worker processing, leases, recovery, retries, DLQ, stats | ✅ Complete |
| Phase 3C | Scheduling, delay, snooze, recurrence, rate limits, dependencies, partitions | ✅ Core complete |
| Phase 4 | Slack Experience | ✅ Complete (on branch) |
| Phase 5 | Automation & Notifications | ✅ Complete (on branch) |
| Phase 6 | SaaS Features | ⏭️ Next |
| Phase 7 | Production Hardening | 🔒 Future |
| Phase 8 | Marketplace Readiness | 🔒 Future |

**Important note:** Phase 3C's core orchestration work is implemented and tests
are passing. A few recommended follow-ups remain before treating the scheduler as
fully production-hardened; see §10.

---

## 4. What Phase 3 delivered

### Phase 3A — Queue domain and internal API

- Permanent queue ids per workspace, e.g. `MQ-000001`.
- FIFO and priority ranking modes.
- Queue item lifecycle and status transition validation.
- Active queue membership and computed positions.
- Priority auto-classification with explainable matched signals.
- Tenant-scoped repositories and audit trail.
- Internal `/api/v1/queue` API protected by development-safe workspace headers.

### Phase 3B — Processing engine and worker infrastructure

- Atomic claiming with `FOR UPDATE SKIP LOCKED`.
- Worker ids via `X-Worker-ID`.
- Processing leases, heartbeats, lock expiry, and worker registry.
- Automatic recovery of expired locks.
- Retry engine and Dead Letter Queue.
- Complete/fail/release/requeue flows and processing events.
- Queue statistics endpoint and worker visibility.
- Concurrency and performance test scaffolding.

### Phase 3C — Scheduled, delayed, and recurring orchestration

- `availableAt` is now the single claim gate for delayed, scheduled, snoozed,
  blocked, and recurring work.
- Scheduled item creation and scheduled listing APIs.
- Snooze integration updates `availableAt` and auto-wakes via activation.
- `QueueActivationService` promotes due work in batches.
- Recurring cron rules with timezone-safe next-run calculation, pause/resume,
  owner checks, max-run caps, and worker loop integration.
- Workspace-scoped rate-limit buckets with lazy sliding-window reset.
- Dependency edges that block claim until upstream requirements resolve.
- Partition gate: one active `Processing` item per `partitionKey` per workspace.

The `claimNext` path now enforces the main orchestration gates atomically:

1. item is due (`availableAt <= now`),
2. rate-limit bucket allows the claim,
3. dependencies are resolved,
4. no item in the same partition is already processing.

---

## 5. Phase 3C commit list

| Commit | Slice |
| --- | --- |
| `b69df4f` | Scheduling schema, enums, and config |
| `d8034a9` | Delayed items and availability-aware ranking/claiming |
| `8e73e59` | Scheduled items API |
| `21d2778` | Snooze sets/clears `availableAt` |
| `1a3db14` | Scheduler activation service and worker loop |
| `5169e1d` | Recurring cron rules and recurrence worker loop |
| `450e051` | Rate limiting and dependency gates in claimNext |
| `06c1fa1` | Partition gate isolation tests |

Latest validation run after Phase 3C core completion:

- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ — 207 passed, 10 gated/skipped
- `npm run build` ✅

---

## 6. Engineering rules that must continue

1. Keep Clean Architecture strict: routes parse and serialize; application
   services orchestrate; repositories persist; domain stays pure.
2. Every database query must be scoped by `workspaceId`.
3. Do not expose development-only workspace/worker headers to untrusted users.
4. Validate all HTTP input with Zod and keep OpenAPI in sync.
5. Do not add placeholders, fake production code, or untested stubs.
6. Run the quality gate after every slice.
7. Use Prisma migrations for schema changes.
8. Use the package manager for dependency changes; do not hand-edit lockfiles.
9. Do not push, PR, merge, rebase, install, or deploy without approval.
10. Respect phase boundaries and avoid refactoring completed phases unless needed.

---

## 7. Quality gate

Run after each meaningful slice:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
docker compose build
```

For gated integration tests on Windows PowerShell:

```powershell
$env:RUN_INTEGRATION = 'true'
npm test
```

Local data services:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Local Postgres used during development has been `localhost:55432`.

---

## 8. Phase 4 — Slack Experience (complete on branch)

**Goal achieved:** the queue is fully manageable inside Slack. The Slack layer
(`src/interfaces/slack`) is a set of thin Bolt adapters that resolve a verified
Slack identity to a tenant-scoped `QueueContext` and delegate to the existing
queue application services; presenters are pure and gated by the domain lifecycle
state machine. See [docs/slack.md](docs/slack.md) §6 for the surface catalogue.

Delivered:

- `SlackIdentityService` — maps a Slack tenant+user to `QueueContext`.
- Block Kit presenters for the queue, priority (Red/Yellow/Green) and
  status/action (Working/Follow Up/Waiting/Snooze/Archive) views.
- App Home dashboard published from `app_home_opened`.
- `/myqueue` slash command for navigation across the views.
- "Add to MyQueue" message shortcut — captures a privacy-safe reference
  (permalink + channel/message/thread ids) as a `SLACK_MESSAGE` item; it never
  stores message text. See the post-Phase 5 privacy refactor note in §9.
- Block Kit item actions: Start, Follow Up, Waiting, Snooze, Complete, Archive,
  Refresh — re-rendering the source surface in place.
- `SlackIdempotencyService` — Redis-backed one-time guard so Slack retries never
  double-process side-effecting handlers.

No new Slack scopes were required; Phase 4 needs only portal toggles (App Home
tab + `app_home_opened`, Interactivity, the message shortcut, and the slash
command) documented in [docs/slack.md](docs/slack.md).

### Phase 4 commit list

| Commit | Slice |
| --- | --- |
| `84df3b7` | Slack identity → tenant-scoped `QueueContext` |
| `9eec45a` | Block Kit presenters (queue/priority/status views) |
| `ee7b45d` | App Home dashboard from `app_home_opened` |
| `dbb19c2` | `/myqueue` slash command navigation |
| `62e2e96` | Add to MyQueue message shortcut |
| `b3abfc0` | Interactive queue actions |
| `81641d0` | Idempotency guard for Slack retries |
| `eef98d4` | Slack experience docs and final gate |

Latest validation run after Phase 4 completion:

- `npm run format:check` ✅
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ — 271 passed, 10 gated/skipped
- `npm run build` ✅

---

## 9. Phase 5 — Automation & Notifications (complete on branch)

**Goal achieved:** the queue proactively reaches out over Slack DM. A `Notifier`
port (`src/application/notifications`) keeps delivery behind an interface; the
`SlackNotifier` (`src/infrastructure/slack`) implements it. `NotificationService`
gates each notification on the relevant per-workspace preference, resolves the
target user, sends, and records a `NOTIFIED` audit event. See
[docs/slack.md](docs/slack.md) §7.

Delivered:

- Schema: notification preference columns on `WorkspaceQueueSettings`
  (`notifyOnAssignment`, `notifyOnSnoozeWake`, `notifyOnFollowUpDue` default on;
  `dailyDigestEnabled` default off; `dailyDigestHourUtc` default `13`), the
  `NOTIFIED` `QueueEventType`, and `WorkspaceRepository.findUserById`.
- `Notifier` port + `NotificationMessage`, with pure Block Kit message builders
  for assignment, snooze-wake, follow-up-due, and digest.
- `SlackNotifier` — resolves the encrypted bot token, opens a DM channel, posts;
  fails safe (logs + returns `false`, never throws).
- Assignment notification fired from `QueueService.assign()` (skips
  self-assignment), wired fire-and-forget via an optional dependency.
- Snooze wake-up via an optional `onActivated` callback on the activation sweep.
- `FollowUpReminderService` — sweeps due `FollowUp` items, deduped per item +
  due-time, and DMs each owner.
- `DigestService` — hourly sweep that ranks each due workspace's active items per
  owner and DMs a summary, deduped per workspace + owner + UTC date.
- New env vars (`QUEUE_FOLLOW_UP_INTERVAL_SECONDS`, `QUEUE_FOLLOW_UP_BATCH_SIZE`,
  `QUEUE_DIGEST_INTERVAL_SECONDS`) and both sweeps wired into the worker
  bootstrap.

Phase 5 adds the `im:write` bot scope so the notifier can open DM channels
(`conversations.open`); `chat:write` covers the message. No other portal changes
are required.

### Phase 5 commit list

| Commit | Slice |
| --- | --- |
| `a6b5f74` | Notification prefs schema + `Notifier` port / `SlackNotifier` |
| `17c7c41` | `NotificationService` + Block Kit message builders |
| `59b5f60` | Assignment notification wiring |
| `6eeb199` | Snooze wake-up notification wiring |
| `f625302` | Follow-up reminder sweep |
| `b496013` | Daily digest sweep |
| `bf5ceb4` | Phase 5 docs, `im:write` scope, and final gate |

Latest validation run after Phase 5 completion:

- `npm run format:check` ✅
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ — 314 passed, 10 gated/skipped
- `npm run build` ✅

### Post-Phase 5 privacy refactor — no message content stored (committed)

A privacy requirement was addressed after Phase 5: the "Add to MyQueue" message
shortcut must never persist anyone's message body. It now stores only a
privacy-safe reference plus a generic title, so capturing a message never saves
its words.

- `src/interfaces/slack/handlers/shortcuts.ts` — removed `deriveTitle` (which read
  the message body); added pure helpers `buildMessageTitle(channelName)` (generic
  label, e.g. `Slack message in #deploys`) and
  `buildMessagePermalink(teamDomain, channelId, messageTs)` (builds the archives
  permalink from payload metadata alone — no API call, no message text).
  `handleAddMessage` now passes only the channel id, message ts, thread ts, and
  permalink; it no longer reads `message.text` or sets `summary`.
- `src/application/queue/queue-service.ts` — `CreateItemInput` now carries the four
  `sourceSlack*` reference fields and `createItem` forwards them to the repository
  (the columns already existed). Priority auto-classification now sees only the
  generic title.
- `tests/unit/slack-handlers.test.ts` — dropped the `deriveTitle` suite; added
  `buildMessageTitle` / `buildMessagePermalink` suites and a thread-capture case;
  asserts `summary` is never passed and the reference fields are stored.
- `docs/slack.md` — added a "Privacy — no message content is stored" note.

Status: **committed** on `feat/phase-5-automation-notifications` as `3a3e6e5`
(`refactor(slack): store privacy-safe message references, never message text`).
Validation before the commit: `format:check` ✅ · `lint` ✅ · `typecheck` ✅ ·
`test` ✅ (316 passed, 10 gated/skipped).

Backfill migration (committed): `SLACK_MESSAGE` rows created before this change
may still hold message text in `summary`. A one-off data migration
(`prisma/migrations/20260627120000_privacy_null_slack_message_summary`) nulls
`summary` where `source_type = 'SLACK_MESSAGE'`. It is idempotent and a no-op on
a fresh database, and has **not** been applied to any database yet — it runs on
the next `prisma migrate deploy` (committed as `015ead3`).

---

## 10. Remaining phases

### Phase 6 — SaaS Features

**Goal:** Make it a manageable SaaS product.

Deliverables:

- Admin panel.
- Billing and Stripe integration.
- Subscription/plan enforcement.
- Workspace settings UI/API.
- Analytics and usage reporting.
- Tenant isolation tests.
- Public or partner API documentation, if needed.

### Phase 7 — Production Hardening

**Goal:** Make it reliable and operationally safe.

Deliverables:

- Security review.
- Production-grade rate limiting.
- Error handling review.
- Structured logging and alerting review.
- Performance improvements.
- CI/CD.
- Docker optimization.
- End-to-end testing.
- Deployment guides and rollback procedures.

### Phase 8 — Marketplace Readiness

**Goal:** Be ready to ship.

Deliverables:

- Slack Marketplace checklist.
- Privacy policy checklist.
- Terms of service checklist.
- OAuth review.
- Slack scope review.
- Branding assets checklist.
- README updates.
- Architecture docs.
- Installation docs.
- Admin guide.
- User guide.
- Release checklist.

---

## 11. Missing / recommended follow-ups

These are the main items worth addressing before public production launch:

1. **Real authentication and authorization.** Queue APIs still rely on explicit
   workspace/user/worker headers for development-safe internal use. Before public
   exposure, add real session/JWT auth and enforce workspace membership.
2. **Slack security hardening.** Phase 4 must verify Slack request signatures,
   timestamp freshness, retry idempotency, and OAuth token scoping.
3. **Scheduler observability.** Add a dedicated scheduler statistics endpoint or
   dashboard covering delayed/scheduled/snoozed/recurring/rate-limited/dependency-
   blocked/partition-blocked counts, next run, and oldest delayed item.
4. **Gated integration coverage.** Run and expand `RUN_INTEGRATION=true` suites for
   delayed/scheduled/recurring/rate-limit/dependency/partition concurrency paths,
   and add coverage for the Phase 5 notification paths (assignment, snooze-wake,
   follow-up sweep, digest sweep) against real Postgres/Redis.
5. **Performance benchmarks.** Capture bounded benchmark numbers for activation,
   recurrence processing, rate-limit checks, dependency-heavy claims, and partition
   claims. Avoid staging-scale runs without approval.
6. **Documentation refresh.** README, `architecture`, `environment`, `slack`, and
   `folder-structure` are current through Phase 5. Still pending: refresh
   `queue-engine` and `testing` with the final Phase 3B/3C APIs, worker loops, and
   operational guidance.
7. **Circular dependency protection.** Confirm dependency creation rejects cycles
   with tests; if missing, add it before exposing dependency APIs broadly.
8. **Rate-limit behavior under concurrency.** Ensure true concurrent integration
   tests prove bucket limits cannot be bypassed by parallel claims.
9. **Operational runbooks.** Add runbooks for worker stalls, recurring-rule failures,
   DLQ growth, migration failures, and Slack API outages.
10. **Secrets management.** Ensure no Slack, Stripe, database, or signing secrets are
    exposed to client code, logs, command arguments, or generated documentation.
11. **Marketplace legal/docs.** Privacy policy, terms, data retention, deletion, and
    customer support flows should be drafted before Phase 8 review.
12. **Notification preference management.** Phase 5 reads the per-workspace
    notification preferences but exposes no user-facing way to change them; add a
    settings surface (App Home/API) to toggle them and set `dailyDigestHourUtc`.
13. **Digest scheduling robustness.** The digest fires when `dailyDigestHourUtc`
    equals the current UTC hour; consider per-user timezones/DST and add gated
    integration tests proving the per-workspace/owner/day idempotency key holds
    across overlapping sweeps.
14. **Notification delivery observability.** Add metrics/alerting for DM send
    failures (missing/revoked bot token, Slack API errors) so silently dropped
    notifications surface operationally.

---

## 12. Suggested immediate next step

1. ✅ Done — the post-Phase 5 privacy refactor is committed (`3a3e6e5`) and the
   optional `summary` backfill migration is added (`015ead3`, not yet applied to
   any database). See §9.
2. Optionally run the full gated integration suite locally (`RUN_INTEGRATION=true`),
   exercising the assignment/snooze/follow-up/digest notification paths against
   local Postgres/Redis.
3. Open a PR for `feat/phase-5-automation-notifications` into
   `feat/phase-4-slack-experience` after approval.
4. Begin Phase 6 (SaaS Features) on a new stacked branch after Phase 5 is
   accepted.

Do not begin Phase 6 work in the current branch unless explicitly instructed.