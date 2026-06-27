# Architecture Overview

MyQueue follows a **clean / layered architecture** designed so individual
concerns stay decoupled and the platform can later be split into independent
services without rewrites.

## Layers

```
interfaces/      Delivery: HTTP (Express, routes, OpenAPI) and Slack (Bolt adapters)
application/      Use cases / orchestration (e.g. the queue service)
domain/           Pure business model: entities, errors, value objects
infrastructure/   External systems: Prisma (DB), Redis, integrations
```

Supporting modules:

```
config/    Validated environment + app metadata
queues/    BullMQ queue/worker management
workers/   Background worker process entrypoint
utils/     Cross-cutting helpers (logger, lifecycle, async handler)
```

### Dependency direction

Dependencies point **inward**: `interfaces` and `infrastructure` depend on
`application` and `domain`; the `domain` depends on nothing external. This keeps
business logic testable and framework-agnostic.

## Runtime processes

The codebase produces two long-running processes from one image:

- **API** (`src/server.ts`) — serves HTTP traffic.
- **Worker** (`src/workers/index.ts`) — runs the queue **recovery loop** (Phase
  3B), the **scheduler/recurrence sweeps** (Phase 3C), and the **follow-up
  reminder** and **daily digest** notification sweeps (Phase 5), alongside the
  BullMQ worker registry. The recovery loop reclaims expired-lock items so
  abandoned work re-enters the queue.

Both share configuration, logging, datastore clients, and the graceful-shutdown
lifecycle, so they behave consistently and scale independently.

## Configuration & validation

All configuration flows through `src/config/env.ts`, a single Zod schema. The
process **refuses to start** with invalid configuration, eliminating an entire
class of production incidents.

## Error handling

A small hierarchy of `ApplicationError` subclasses carries an HTTP status code
and a stable machine-readable `code`. A centralized Express error middleware
converts any thrown error (including Zod errors) into a consistent JSON envelope
and logs it with the request id.

## Observability

- **Structured logging** via Pino, with per-request child loggers and a stable
  `x-request-id` propagated on every response.
- **Health endpoints** (`/health`, `/ready`) suitable for load balancers and
  container orchestrators.
- **OpenAPI** document generated from Zod schemas and served via Swagger UI.

## Data & queues

- **PostgreSQL** is accessed exclusively through a single Prisma client
  instance to protect the connection pool.
- **Redis** backs both the application cache client and BullMQ. BullMQ requires
  dedicated connections (`maxRetriesPerRequest: null`), which the
  infrastructure layer provides via `createBullConnection`.

## Queue engine

The queue engine is the first full vertical slice through these layers: pure
ranking/lifecycle rules in `domain/queue`, tenant-scoped persistence in
`infrastructure/repositories`, orchestration in the `application` queue services,
and an internal `/api/v1/queue` surface in `interfaces/http`.

Phase 3A delivers the passive scheduling engine; **Phase 3B** adds an active
processing layer — claim/heartbeat/recovery/retry/DLQ services, a worker registry,
and statistics — so multiple workers process the queue concurrently with no
duplicate execution. Concurrency is enforced in the data layer via
`FOR UPDATE SKIP LOCKED` rather than application locks. See
[queue-engine.md](./queue-engine.md) for its mechanics, API, concurrency
guarantees, and limitations.

## Slack experience

Phase 4 adds a second delivery surface alongside HTTP: `interfaces/slack`. These
are **thin Bolt adapters** — App Home, the `/myqueue` slash command, the "Add to
MyQueue" message shortcut, and Block Kit item actions. Each handler verifies the
Slack request (via the Bolt receiver), resolves the Slack identity to a
tenant-scoped `QueueContext` through `application/slack/SlackIdentityService`,
and delegates to the same queue application services the HTTP API uses. Block Kit
presenters are pure and depend only on the domain (the lifecycle state machine
gates which item buttons render), so no business logic leaks into the Slack layer.

Side-effecting interactions are protected by `SlackIdempotencyService`, a
Redis-backed one-time guard keyed on the Slack payload id, so Slack retries never
double-process. See [slack.md](./slack.md) for setup and the surface catalogue.

## Notifications & automation

Phase 5 adds proactive Slack DMs (assignment, snooze wake-up, follow-up due,
daily digest) without coupling the queue to Slack. A `Notifier` **port** lives in
`application/notifications`; the `SlackNotifier` in `infrastructure/slack`
implements it. `NotificationService` orchestrates each notification — gate on the
per-workspace preference, resolve the target user, send, and record a `NOTIFIED`
audit event — and pure Block Kit builders keep message construction
framework-free.

Delivery is triggered two ways: inline (assignment fires from `assign()`;
snooze-wake from the activation sweep's `onActivated` callback) and via two
background sweeps (`FollowUpReminderService`, `DigestService`) that mirror the
Phase 3C scheduler — overlap-guarded `tick`, bounded batches, idempotent
start/stop. Both sweeps dedupe with the Redis-backed `SlackIdempotencyService`
and every delivery path fails safe, so a notification can never break the use
case or sweep that requested it. See [slack.md](./slack.md) §7.

## Billing & entitlements

Phase 6 turns MyQueue into a tiered SaaS (Free / Pro / Business) as another
vertical slice. The plan model is pure: `domain/billing` defines the tiers, their
`entitlements` (feature flags + resource limits), and limit-check helpers, plus a
`BillingProvider` **port**. `infrastructure/billing` implements that port with a
**native Stripe adapter** — form-encoded `fetch` for Checkout/portal/API calls
and `HMAC-SHA256` for webhook verification — so the heavy Stripe SDK is avoided.

`application/billing` orchestrates three use cases: `BillingService` (Checkout /
portal sessions and webhook processing that maps Stripe subscription state onto a
workspace's plan), `EntitlementService` (resolves and enforces a workspace's
effective entitlements), and `UsageService` (workspace-scoped usage reporting,
gated by the analytics entitlement). Enforcement lives in the application layer:
resource limits (active items, workers, recurrence rules) are checked before
mutation and gated features raise `PaymentRequiredError` (HTTP 402).

The HTTP surface adds `/api/v1/billing`, `/api/v1/workspace`, `/api/v1/admin`,
and `/api/v1/analytics`, all behind `workspaceContext` so every read and write is
scoped by `workspaceId`. Like Slack, billing is **optional**: when the core
`STRIPE_*` credentials are absent the billing surface is not mounted and the app
runs Free-only. Raw Stripe identifiers are never echoed to clients. The Stripe
webhook receiver uses `express.raw()` to preserve the exact payload for signature
verification before processing.

## Future service extraction

Because delivery (`interfaces`), orchestration (`application`), and
infrastructure are separated, a feature can later be extracted into its own
deployable by moving its slice plus the shared `domain`/`config`/`utils`
packages — no entanglement with HTTP or framework code.
