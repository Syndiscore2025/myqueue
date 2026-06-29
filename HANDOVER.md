# MyQueue Handover Report

> Onboarding document for the next engineer/agent. It captures the current state
> through Phase 6 and the in-progress Phase 7, the rules that must be followed,
> the branch model, validation commands, what remains for Phases 7–8, and
> recommended gaps to close before a public launch.

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
- Current Phase 6 branch: `feat/phase-6-saas-features`.
- Phase 6 was branched from `feat/phase-5-automation-notifications` and should
  target that branch if a PR is opened.
- Use conventional commits and commit completed slices separately.
- **Ask before:** commit, push, PR creation, merge, rebase, dependency install,
  deploy, production data changes, or long/expensive staging-scale tests.

---

## 3. Current phase status

| Phase | Scope | Status |
| --- | --- | --- |
| ~~Phase 1~~ | ~~Infrastructure foundation~~ | ✅ Complete |
| ~~Phase 2~~ | ~~Slack Marketplace foundation / multi-tenant install~~ | ✅ Complete |
| ~~Phase 3A~~ | ~~Queue domain, ranking, positions, internal queue API~~ | ✅ Complete |
| ~~Phase 3B~~ | ~~Worker processing, leases, recovery, retries, DLQ, stats~~ | ✅ Complete |
| ~~Phase 3C~~ | ~~Scheduling, delay, snooze, recurrence, rate limits, dependencies, partitions~~ | ✅ Core complete |
| ~~Phase 4~~ | ~~Slack Experience~~ | ✅ Complete (on branch) |
| ~~Phase 5~~ | ~~Automation & Notifications~~ | ✅ Complete (on branch) |
| ~~Phase 6~~ | ~~SaaS Features~~ | ✅ Complete (on branch) |
| ~~Phase 7~~ | ~~Production Hardening~~ | ✅ Complete (Slices 1–10; see §11) |
| Phase 8 | Marketplace Readiness | 🔒 Future |

**Important note:** Phase 3C's core orchestration work is implemented and tests
are passing. A few recommended follow-ups remain before treating the scheduler as
fully production-hardened; see §12.

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

## 10. Phase 6 — SaaS Features (complete on branch)

**Goal achieved:** MyQueue is now a tiered SaaS (Free / Pro / Business) with a
native Stripe billing integration, application-layer entitlement enforcement,
workspace-scoped usage analytics, and an admin overview — all behind the existing
per-`workspaceId` tenant boundary. Billing is optional: with the core `STRIPE_*`
credentials absent the app boots Free-only and the billing surface is not mounted
(mirroring the Slack-optional pattern). See
[docs/architecture.md](docs/architecture.md) §"Billing & entitlements" and
[docs/environment.md](docs/environment.md).

Delivered:

- **Plan domain** (`src/domain/billing`): `WorkspacePlan` (Free/Pro/Business) and
  `WorkspacePlanStatus`, per-plan `PlanEntitlements` (feature flags + resource
  limits), pure limit-check helpers (`isWithinLimit`, `effectiveEntitlements`),
  `PURCHASABLE_PLANS`, and the provider-agnostic `BillingProvider` port.
- **Schema + migration**: `WorkspacePlan` / `WorkspacePlanStatus` enums, the
  `PLAN_CHANGED` audit action, and billing columns on `Workspace` (`plan`,
  `planStatus`, `stripeCustomerId`, `stripeSubscriptionId`, `planUpdatedAt`).
- **Repositories**: `WorkspaceRepository.findByStripeCustomerId` / `updateBilling`
  and `QueueItemRepository.countActive`, all tenant-scoped.
- **Native Stripe adapter** (`src/infrastructure/billing`): form-encoded `fetch`
  for Checkout / portal / API calls and `HMAC-SHA256` webhook verification with a
  timestamp-tolerance window — no Stripe SDK dependency — plus event/status/price
  mappers that translate Stripe vocabulary into the domain enums.
- **Application services** (`src/application/billing`): `BillingService` (checkout
  / portal sessions and webhook processing that maps subscription state onto a
  workspace's plan with a `PLAN_CHANGED` audit), `EntitlementService` (resolve +
  enforce effective entitlements), and `UsageService` (analytics-gated usage
  report). Resource limits are enforced in `QueueService` before mutation; gated
  features raise `PaymentRequiredError` (HTTP 402).
- **HTTP surface**: `/api/v1/billing` (plan, checkout, portal, webhook),
  `/api/v1/workspace/settings` (GET/PATCH incl. notification preferences),
  `/api/v1/admin/overview`, and `/api/v1/analytics/usage` — all behind
  `workspaceContext` and documented in the generated OpenAPI. Raw Stripe
  identifiers are never echoed to clients; the webhook uses `express.raw()` to
  preserve the exact payload for signature verification.
- **Config**: seven `STRIPE_*` variables and `isBillingConfigured` / the
  `billingConfigured` flag, documented in `environment.md` and `.env.example`.

### Phase 6 slices

| Slice | Scope |
| --- | --- |
| 1–2 | Plan domain model, entitlement enums, schema + migration, config |
| 3 | Tenant-scoped billing repository methods + active-item counting |
| 4 | Entitlement enforcement in `QueueService` (active items, workers, recurrence) |
| 5 | Native Stripe provider + event/status/price mappers |
| 6 | `BillingService` / `EntitlementService` / `UsageService` |
| 7 | HTTP routes (billing / workspace / admin / analytics) + OpenAPI |
| 8–9 | Usage analytics + OpenAPI documentation |
| 10 | Tests (61 new: unit + integration + explicit tenant isolation) |
| 11 | Docs (`architecture` / `folder-structure` / `environment` / `.env.example`) + this handover |

No new Slack scopes are required for Phase 6.

Latest validation run after Phase 6 completion:

- `npm run format:check` ✅
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm test` ✅ — 373 passed, 10 gated/skipped
- `npm run build` ✅

The Phase 6 work is **committed on `feat/phase-6-saas-features`** (Phase 7 is
stacked on top of it).

---

## 11. Remaining phases

### Phase 7 — Production Hardening (complete)

**Goal:** Make it reliable and operationally safe.

Work is on `feat/phase-7-production-hardening`, stacked on
`feat/phase-6-saas-features`. Each slice was committed separately after a green
full quality gate.

#### Slice commit table

| Commit | Slice | What it delivered |
| --- | --- | --- |
| `c6e35e8` | 1 — Redis-backed rate limiting | Replaced the in-memory `express-rate-limit` store with a Redis-backed `Store` (atomic Lua INCR + self-expiring sliding window) reusing the shared ioredis client, so limits are shared across instances and survive restarts; `passOnStoreError` fails open on a Redis outage. Tests use the in-memory store; new unit suite covers the Redis store via an injected client. |
| `2e9f43e` | 2 — Provider-agnostic auth seam | Added a stateless HS256 signed bearer-token system anchored in Slack identity. New `AuthVerifier`/`AuthTokenMinter` ports (`src/application/auth`) + `SignedTokenService` (`src/infrastructure/auth`, `node:crypto`, constant-time verify). `workspaceContext`/`workerContext` refactored into factories that prefer `Authorization: Bearer <token>` and gate the legacy `x-workspace-id`/`x-worker-id` headers to non-production (fails closed in prod). New `/myqueue token` slash command mints a token from the verified Slack request. `AUTH_TOKEN_SECRET` (required ≥32 chars in prod) + `AUTH_TOKEN_TTL_SECONDS` added to the env schema. |
| `6298f0c` | 3 — Slack signature review & security headers | Confirmed Bolt's `ExpressReceiver` enforces signature verification by default (not overridden), mounted ahead of the body parser, with built-in 5-min replay window — covered by existing tests. Tightened Helmet CSP into a strict global policy (no inline scripts/styles) plus a relaxed `docsSecurityHeaders` scoped only to `/docs` and `/openapi.json`. Refreshed the stale tenant-context comment in `app.ts`. |
| `250eb62` | 4 — Observability (health/readiness + scheduler stats) | Added a scheduler-statistics endpoint (`GET /api/v1/queue/scheduler`) aggregating delayed/scheduled/snoozed/recurring/rate-limited/dependency-blocked/partition-blocked counts, next activation, and oldest pending item; added Redis-backed, cross-process DM-failure metrics wired into `SlackNotifier`'s failure paths. |
| `c15d869` | 5 — Error-handling & logging review | Added a fail-safe `AlertSink` port + `alertError` helper fired on non-operational errors in the HTTP handler and on `uncaughtException`/`unhandledRejection`; widened Pino redaction for secret fields and nested headers; confirmed the `ApplicationError` envelope masks correctly in production. |
| `d08c299` | 6 — Performance benchmarks | Added bounded `RUN_INTEGRATION` benchmarks for the orchestration hot paths (activation sweep, recurrence sweep, rate-limit checks, dependency-heavy claims, partition claims) and documented the expanded suite in `queue-engine.md`. |
| `bfa1aa4` | 7 — Notification & concurrency integration coverage | New `tests/integration/notifications.test.ts` covers the Phase 5 DM paths (assignment, snooze-wake, follow-up with dedupe re-sweep, digest grouping + same-day dedupe), asserting `NOTIFIED` audit events and preference gating; extended `queue-concurrency.test.ts` with deterministic partition single-in-flight and rate-limit bucket gate tests under concurrent claimers. |
| `ddf4d38` | 8 — CI/CD | Hardened the GitHub Actions pipeline: applies Prisma migrations (`prisma migrate deploy`) before the gate so the `RUN_INTEGRATION=true` suites run against a real schema; added `AUTH_TOKEN_SECRET` to the job env and `workflow_dispatch`; the `docker` job builds the `runtime` image with GHA cache after `verify`. |
| `73537ec` | 9 — Docker optimization | Added a thin `migrate` Dockerfile stage (ships the Prisma CLI + schema + migrations, non-root) and a one-shot Compose `migrate` service; the API and worker now gate on `service_completed_successfully` so they never start against an unmigrated database. Runtime image stays lean (no Prisma CLI / dev deps). |
| `d4dfa28` | 10 — Deployment & operations docs | New `docs/deployment.md`: topology, required prod config, deploy procedure, expand/contract migration rule, tag-swap rollback, backups/recovery, and operational runbooks (worker stalls, recurring-rule failures, DLQ growth, migration failures, Slack outages). Linked from the README. |

Latest validation run (after Slice 10): format ✅ · lint ✅ · typecheck ✅ ·
test ✅ (420 passed, 18 gated/skipped) · build ✅; Docker `runtime` + `migrate`
targets build clean.

#### Slices 4–10 (delivered this phase)

4. ✅ ~~**Observability — health/readiness + scheduler stats.**~~ Done (`250eb62`).
5. ✅ ~~**Error-handling & structured-logging review.**~~ Done (`c15d869`).
6. ✅ ~~**Performance improvements.**~~ Done (`d08c299`).
7. ✅ ~~**Notification & concurrency integration coverage.**~~ Done (`bfa1aa4`).
8. ✅ ~~**CI/CD.**~~ Done (`ddf4d38`).
9. ✅ ~~**Docker optimization.**~~ Done (`73537ec`).
10. ✅ ~~**Deployment guides & rollback procedures.**~~ Done (`d4dfa28`).

**Phase 7 is complete.** Phase 8 (Marketplace Readiness) is the documentation
and launch-readiness phase — branch `feat/phase-8-marketplace-readiness`, stacked
on Phase 7.

### Phase 8 — Marketplace Readiness 🔄 In progress (docs complete)

**Goal:** Be ready to ship.

All deliverables are grounded in the codebase; items needing business/legal input
are flagged inside each doc with `[BUSINESS]` / `[COUNSEL]` placeholders.

| Commit | Slice | Deliverables |
| --- | --- | --- |
| `9a1e2d5` | 1 — Product report | `docs/myqueue-report.md` |
| `78a1b23` | 2 — Guides | `docs/installation.md`, `docs/user-guide.md`, `docs/admin-guide.md` |
| `c0ed34f` | 3 — Marketplace | `docs/marketplace-readiness.md` (OAuth + scope + branding) |
| `73e08b3` | 4 — Legal | `docs/privacy-policy.md`, `docs/terms-of-service.md`, `docs/compliance-checklist.md` |
| `0d60f22` | 5 — Deploy/ops | `docs/digitalocean-deployment.md`, `docs/monitoring-and-alerting.md`, `docs/disaster-recovery.md` |
| `5009eab` | 6 — Audits | `docs/security-audit.md`, `docs/performance-results.md`, `docs/api-review.md`, `docs/accessibility-audit.md` |
| (this slice) | 7 — Release | `docs/release-checklist.md`, README doc list, this update |

Deliverables (struck through = delivered):

- ✅ ~~Comprehensive MyQueue report.~~ `docs/myqueue-report.md`
- ✅ ~~Installation docs.~~ `docs/installation.md`
- ✅ ~~User guide.~~ `docs/user-guide.md`
- ✅ ~~Admin guide.~~ `docs/admin-guide.md`
- ✅ ~~Slack Marketplace checklist.~~ `docs/marketplace-readiness.md`
- ✅ ~~OAuth review.~~ `docs/marketplace-readiness.md` §1
- ✅ ~~Slack scope review.~~ `docs/marketplace-readiness.md` §2
- ✅ ~~Branding assets checklist.~~ `docs/marketplace-readiness.md` §4 **[BUSINESS]**
- ✅ ~~Privacy policy checklist.~~ `docs/privacy-policy.md` **[COUNSEL]**
- ✅ ~~Terms of service checklist.~~ `docs/terms-of-service.md` **[COUNSEL]**
- ✅ ~~Final legal compliance check.~~ `docs/compliance-checklist.md` **[COUNSEL]**
- ✅ ~~Digital Ocean Deployment Guide (Webapp or droplet?).~~
  `docs/digitalocean-deployment.md` — both options documented; **[DECISION]** which.
- ✅ ~~Monitoring and alerting setup guide.~~ `docs/monitoring-and-alerting.md`
- ✅ ~~Backup and recovery plan documentation.~~ `docs/disaster-recovery.md`
- ✅ ~~Disaster recovery plan.~~ `docs/disaster-recovery.md`
- ✅ ~~Load balancing configuration review.~~ `docs/disaster-recovery.md` §Load-balancing
- ✅ ~~Security audit report.~~ `docs/security-audit.md`
- ✅ ~~Performance testing results.~~ `docs/performance-results.md`
- ✅ ~~API documentation review.~~ `docs/api-review.md`
- ✅ ~~Accessibility compliance audit.~~ `docs/accessibility-audit.md`
- ✅ ~~Release checklist.~~ `docs/release-checklist.md`
- ✅ ~~README updates.~~ Documentation list expanded with all Phase 8 docs.
- Architecture docs — existing `docs/architecture.md` (current; no change needed).

**Remaining before public launch (business/legal, not engineering):** fill the
`[BUSINESS]`/`[COUNSEL]` placeholders (legal entity/contact/jurisdiction, branding
assets, production domain, DigitalOcean target), then work the go/no-go gate in
`docs/release-checklist.md`.

---

## 12. Missing / recommended follow-ups

These are the main items worth addressing before public production launch:

1. ✅ **Real authentication and authorization.** _Addressed in Phase 7 Slice 2
   (`2e9f43e`)._ HS256 signed bearer tokens anchored in Slack identity now guard
   the queue APIs; the dev-only header path is disabled in production. Remaining
   nuance: tokens are stateless (no server-side revocation list) — add revocation
   only if a use case requires it.
2. ✅ **Slack security hardening.** _Reviewed in Phase 7 Slice 3 (`6298f0c`)._
   Bolt enforces request-signature verification + a 5-min timestamp window by
   default (confirmed, tested); retry idempotency is handled by
   `SlackIdempotencyService`. OAuth token scoping review remains for Phase 8.
3. ✅ ~~**Scheduler observability.**~~ _Addressed in Phase 7 Slice 4 (`250eb62`)._ A
   `GET /api/v1/queue/scheduler` endpoint reports the delayed/scheduled/snoozed/
   recurring/rate-limited/dependency-blocked/partition-blocked counts, next run, and
   oldest pending item.
4. ✅ ~~**Gated integration coverage.**~~ _Addressed in Phase 7 Slice 7 (`bfa1aa4`)._
   `RUN_INTEGRATION=true` suites now cover the Phase 5 notification paths (assignment,
   snooze-wake, follow-up sweep, digest sweep) and the rate-limit/partition concurrency
   gates against real Postgres.
5. ✅ ~~**Performance benchmarks.**~~ _Addressed in Phase 7 Slice 6 (`d08c299`)._ Bounded
   benchmarks capture activation, recurrence processing, rate-limit checks,
   dependency-heavy claims, and partition claims under `RUN_INTEGRATION`.
6. ✅ ~~**Documentation refresh.**~~ _Addressed across Phases 6–7._ `queue-engine`
   and `testing` were refreshed with the Phase 3B/3C APIs and the CI gate;
   operational guidance now lives in `docs/deployment.md` (Phase 7 Slice 10,
   `d4dfa28`).
7. ✅ ~~**Circular dependency protection.**~~ _Addressed in Phase 8._
   `QueueDependencyRepository.addEdge()` now rejects self-dependencies and any edge
   that would close a cycle — it walks the existing workspace-scoped depends-on
   graph from the upstream item and throws `DependencyCycleError` (409,
   `DEPENDENCY_CYCLE`) if the dependent is reachable. Missing items now raise a
   proper `NotFoundError` (404). Covered by unit tests in
   `tests/unit/repositories.test.ts` (happy path, self-dependency, direct cycle,
   transitive multi-hop cycle, not-found).
8. ✅ ~~**Rate-limit behavior under concurrency.**~~ _Addressed in Phase 7 Slice 7
   (`bfa1aa4`)._ A concurrent integration test proves a full bucket gates parallel
   claims and reopens once capacity frees.
9. ✅ ~~**Operational runbooks.**~~ _Addressed in Phase 7 Slice 10 (`d4dfa28`)._
   `docs/deployment.md` adds runbooks for worker stalls, recurring-rule failures,
   DLQ growth, migration failures, and Slack API outages, plus deploy/rollback.
10. ✅ ~~**Secrets management.**~~ _Addressed across Phases 7–8._ Pino redacts
    `Authorization`/`cookie`/`x-slack-signature` headers and `token`/`secret`/
    `botToken`/`clientSecret`/`signingSecret`/`encryptionKey` fields
    (`src/utils/logger.ts`); Slack tokens are AES-256-GCM at rest, config is
    validated at boot, and no raw tokens or Stripe ids are echoed to clients.
    Documented in `docs/security-audit.md` and `docs/compliance-checklist.md`.
    _Remaining (business): define a secret-rotation procedure/cadence._
11. ✅ ~~**Marketplace legal/docs.**~~ _Addressed in Phase 8 Slice 4._
    `docs/privacy-policy.md`, `docs/terms-of-service.md`, and
    `docs/compliance-checklist.md` cover data collection, retention, deletion, and
    support flows. _Remaining (counsel): fill the `[COUNSEL]` placeholders._
12. 🟡 **Notification preference management.** _Partially addressed (Phase 6)._
    `PATCH /api/v1/workspace/settings` now exposes every preference
    (`notifyOnAssignment`, `notifyOnSnoozeWake`, `notifyOnFollowUpDue`,
    `dailyDigestEnabled`, `dailyDigestHourUtc`) via
    `updateWorkspaceSettingsSchema`. _Remaining: an in-Slack **App Home** toggle
    UI; today it is API-only._
13. 🟡 **Digest scheduling robustness.** _Partially addressed._ The idempotency
    half is done: a gated integration test (`tests/integration/notifications.test.ts`)
    plus unit tests prove the per-workspace/owner/day key holds across sweeps.
    _Remaining: `DigestService.digestBatch` still fires on
    `dailyDigestHourUtc === now.getUTCHours()` (UTC-only) — add per-user
    timezone/DST handling._
14. ✅ ~~**Notification delivery observability.**~~ _Addressed in Phase 7 Slice 4
    (`250eb62`)._ Redis-backed DM-failure metrics record per-reason counters wired into
    `SlackNotifier`'s failure paths.

---

## 13. Suggested immediate next step

1. ✅ Done — Phase 6 (SaaS Features) is complete on `feat/phase-6-saas-features`.
2. ✅ Done — Phase 7 (Production Hardening) is complete on
   `feat/phase-7-production-hardening`, stacked on the Phase 6 branch. All ten
   slices (Redis rate limiting, signed bearer-token auth, CSP/Slack-signature
   hardening, observability, error/logging review, performance benchmarks,
   notification/concurrency integration coverage, CI/CD, Docker optimization, and
   deployment/rollback docs) are committed and gate-green; see §11 for the commit
   table.
3. **Next: Phase 8 — Marketplace Readiness.** Open the Phase 7 → Phase 6 PR (and
   the Phase 6 → main chain) for review, then begin the Phase 8 checklist: privacy
   policy, terms, data retention/deletion, OAuth/scope review, branding, user/admin
   guides, and the release checklist — gating a public Slack Marketplace listing.
   The remaining §12 items (#7 circular-dependency tests, #11 legal/docs, #12
   notification-preference UI, #13 digest timezones) feed into Phase 8.
4. **Verify the Phase 6 PR state** before relying on the §14 prompts: check
   `git ls-remote --heads origin` and the repo's open PRs to confirm whether the
   Phase 6 branch was pushed and a PR opened. The §14.1 commit/push/PR prompt is
   only relevant if that has not yet happened.

The §14 prompts predate Phase 7 starting; treat them as historical context and
follow §13 above for the current next action.

---

## 14. Next-agent execution prompts

Two copy-paste prompts for the next agent: §14.1 drives the Phase 6 commit + push
+ PR; §14.2 lets it continue into Phase 7 on a stacked branch. Together they
implement §13 steps 2–5.

### 14.1 — Commit, push, and open the Phase 6 PR

```text
Approved — proceed. Stop asking and execute in this order. Answers to your questions are baked in below; where something is checkable, verify it with git yourself rather than asking me.

## Decisions (don't re-litigate these)
- Skip the gated RUN_INTEGRATION run. It only re-covers queue concurrency/perf (unchanged here) and does NOT exercise billing or notification paths. No new signal, not worth standing up Postgres+Redis.
- Defer notification integration coverage (HANDOVER §12.4) to Phase 7 as its own slice. It must NOT block this PR.
- Quality gate is green (format/lint/typecheck/test 373/build). Good to ship.

## Do this now
1. Verify local state before anything else:
   - `git status` (the Phase 6 changes are uncommitted on the working tree),
   - `git rev-parse --abbrev-ref HEAD` (must be `feat/phase-6-saas-features`),
   - `git branch -r` and `git ls-remote --heads origin` to determine what already exists on the remote.
2. Commit the Phase 6 work slice by slice using the slice table in HANDOVER §10, with conventional messages (e.g. `feat(billing): plan domain model and entitlement enums`, `feat(billing): native Stripe provider`, `feat(http): billing/workspace/admin/analytics routes`, `test(billing): unit + integration + tenant-isolation`, `docs: phase 6 billing architecture + handover`). Re-run the full gate before the final commit.
3. Determine the base branch state yourself:
   - If `feat/phase-5-automation-notifications` is NOT on origin, push it first so the PR has a valid base, THEN push the Phase 6 branch.
   - If it IS on origin, just push the Phase 6 branch.
   - Report what you found and what you pushed.
4. Push `feat/phase-6-saas-features` to origin.
5. Open the PR: base = `feat/phase-5-automation-notifications`, head = `feat/phase-6-saas-features` (NOT main).
6. Draft the PR description yourself from the Phase 6 commit history. Include:
   - a short summary of what Phase 6 delivers (tiered Free/Pro/Business plans, native Stripe billing, entitlement enforcement, usage analytics, admin overview, workspace settings),
   - the native-Stripe note (fetch + HMAC-SHA256 webhook verification, no Stripe SDK dependency),
   - the validation results (format/lint/typecheck/test 373/build all green),
   - an explicit "Deferred" note pointing to §12.4 notification integration tests for Phase 7,
   - a "Config" note listing the new STRIPE_* variables and that billing is optional (Free-only when absent).

## Guardrails
- Committing, pushing, and PR creation are the only actions approved here. Do NOT merge, rebase, or force-push.
- After the PR is open, report the PR URL, the final commit list, the base/head branches, and anything you had to push to make the base valid — then proceed to the Phase 7 continuation prompt (§14.2).
```

### 14.2 — Continue into Phase 7 after the PR

```text
## After the PR is open — continue into Phase 7
Once the Phase 6 PR is open and you've reported the PR URL + branch state, you ARE cleared to begin Phase 7 without waiting for the PR to merge. Do it like this:

1. Create a NEW stacked branch off the Phase 6 branch:
   `git checkout feat/phase-6-saas-features` then
   `git checkout -b feat/phase-7-production-hardening`
   (Phase 7 stacks on Phase 6 — do NOT branch from main.)
2. Before writing code, post a Phase 7 plan: break it into small, independently-committable slices from HANDOVER §11 (security review, production-grade rate limiting, error-handling review, structured logging/alerting, performance, CI/CD, Docker optimization) and fold in the relevant §12 follow-ups (real auth/authz, Slack security hardening, notification integration coverage, scheduler observability). Wait for my go-ahead on the slice order.
3. Build slice by slice. After each slice: run the full quality gate (format/lint/typecheck/test/build) and commit with a conventional message. Keep Clean Architecture and per-`workspaceId` tenant scoping throughout.

## Still ask-first (unchanged)
- Commit, push, PR, merge, rebase, dependency installs, deploy, and any production/long-running test runs.
```

Do not begin Phase 7 work in the current branch unless explicitly instructed.