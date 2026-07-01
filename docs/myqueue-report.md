# MyQueue — Comprehensive Product Report

A single-source overview of what MyQueue is, how it is built, what it does
today, and where it stands on the path to a public Slack Marketplace launch.
Everything here reflects the current codebase; deeper guides are linked inline.

## 1. Executive summary

MyQueue is a multi-tenant SaaS work-queue platform that lives inside Slack. Each
Slack workspace installs the app via OAuth and manages a prioritized queue of
work items without leaving Slack — through an App Home dashboard, the `/myqueue`
slash command, message shortcuts, and proactive direct-message notifications. A
background worker fleet processes the queue concurrently and safely, with
scheduling, recurrence, rate limits, dependencies, retries, and a dead-letter
queue. Billing and plan entitlements are built in via Stripe.

The backend is a strictly-typed Node.js 22 / TypeScript application on
PostgreSQL (Prisma) and Redis, packaged in Docker with CI/CD. Phases 1–7
(infrastructure, Slack install, queue engine, Slack experience, notifications,
SaaS/billing, and production hardening) are complete. Phase 8 (this phase) is
the marketplace-readiness and launch-documentation effort.

## 2. Architecture

MyQueue follows a clean, layered architecture (see
[architecture.md](./architecture.md)). Dependencies point inward:

```
interfaces/      HTTP (Express, routes, OpenAPI) + Slack (Bolt) adapters
application/     Use cases / orchestration (queue, notifications, billing, …)
domain/          Pure business model: entities, errors, value objects
infrastructure/  Prisma (DB), Redis, Slack, Stripe, observability
```

The `domain` depends on nothing external, keeping business logic testable and
framework-agnostic. One image produces **two processes**:

- **API** (`src/server.ts`) — serves HTTP and the Slack surface.
- **Worker** (`src/workers/index.ts`) — runs the recovery, scheduler activation,
  recurrence, follow-up reminder, and daily-digest loops, plus the BullMQ
  registry.

All configuration flows through one Zod schema (`src/config/env.ts`); the process
refuses to start with invalid configuration.

## 3. Tech stack

- **Runtime:** Node.js 22 LTS, TypeScript (strict, `exactOptionalPropertyTypes`).
- **HTTP:** Express 5, Helmet (strict CSP), CORS, compression, Redis-backed rate
  limiting.
- **Data:** PostgreSQL via Prisma; **cache/queues:** Redis (ioredis) + BullMQ.
- **Slack:** Bolt (`ExpressReceiver`, signature verification).
- **Billing:** Stripe (native `fetch` + `node:crypto` HMAC — no SDK dependency).
- **Validation:** Zod; **logging:** Pino; **docs:** OpenAPI 3 + Swagger UI.
- **Quality:** ESLint (zero warnings), Prettier, Jest (ts-jest), GitHub Actions.

## 4. Capabilities by phase

| Phase | Capability |
| --- | --- |
| 1 | Infrastructure foundation: config, logging, error envelope, health/ready/version, security middleware, graceful shutdown. |
| 2 | Slack Marketplace foundation: multi-tenant OAuth v2 install; Slack tokens encrypted at rest (AES-256-GCM); every record tenant-scoped. |
| 3A | Queue engine: domain models, ranking & position engine, internal `/api/v1/queue` API. |
| 3B | Processing engine: worker claim/lock, heartbeats, automatic recovery, retries, dead-letter queue, worker registry, statistics. |
| 3C | Scheduling & orchestration: delay, snooze, recurrence (cron), rate limits, dependencies, partitions. |
| 4 | Slack experience: App Home dashboard, `/myqueue` command, "Add to MyQueue" shortcut, Block Kit item actions. |
| 5 | Automation & notifications: assignment, snooze-wake, follow-up reminder, and daily-digest DMs — preference-gated and deduped. |
| 6 | SaaS features: Stripe billing, plan tiers (Free/Pro/Business), entitlement enforcement, workspace settings, admin & analytics APIs. |
| 7 | Production hardening: Redis rate limiting, signed bearer-token auth, CSP, observability, error/logging review, performance benchmarks, integration coverage, CI/CD, Docker, deployment/ops docs. |

## 5. Multi-tenancy & data model

Every query is scoped by `workspaceId` — the tenant boundary. Slack OAuth tokens
are encrypted at rest. The Prisma schema (`prisma/schema.prisma`) carries the
workspace/install models, the queue item model with its scheduling/dependency/
partition fields, recurrence rules, rate-limit buckets, audit events, and the
billing columns (plan, status, Stripe identifiers).

## 6. Queue engine

The queue is a ranked, status-driven state machine (see
[queue-engine.md](./queue-engine.md)). Workers claim items atomically with
`FOR UPDATE SKIP LOCKED`, so many workers process concurrently with no duplicate
execution. Items can be delayed, scheduled, snoozed, made recurring, rate-limited
per bucket, blocked on dependencies, and constrained to single-in-flight
partitions. Expired locks are recovered automatically; items exceeding
`QUEUE_MAX_RETRIES` move to the dead-letter queue. A scheduler-statistics endpoint
(`GET /api/v1/queue/scheduler`) reports gated-item counts, the next activation,
the oldest pending item, recurrence/rate-limit footprint, and DM-failure metrics.

## 7. Slack experience & notifications

Users manage the queue entirely in Slack: an App Home dashboard, the `/myqueue`
slash command (including `/myqueue token` to mint an API bearer token), an "Add
to MyQueue" message shortcut, and Block Kit actions. Five DM paths keep owners
informed — assignment, snooze-wake, follow-up reminders, and the daily digest —
each gated by per-workspace preferences and deduped with Redis-backed idempotency
keys so retries never double-send. Every delivery path fails safe: a Slack outage
never breaks a use case or background sweep.

## 8. Billing & entitlements

Stripe Checkout and the billing portal drive plan changes; webhooks (HMAC-
verified) update the workspace plan/status and write a `PLAN_CHANGED` audit entry.
An entitlement service enforces plan limits (e.g. the active-item cap) at item
creation, returning a `402 PLAN_LIMIT_EXCEEDED` envelope when exceeded. Billing is
optional: with no Stripe credentials the surface is simply not mounted.

## 9. Security posture

- **Tenant isolation:** every record and query scoped by `workspaceId`.
- **Secrets:** Slack tokens encrypted at rest; `ENCRYPTION_KEY` and
  `AUTH_TOKEN_SECRET` required in production; broad Pino redaction of secret
  fields and headers.
- **API auth:** stateless HS256 bearer tokens anchored in verified Slack
  identity; dev-only header fallback disabled in production.
- **Slack trust boundary:** Bolt enforces request-signature verification with a
  5-minute replay window; retries are idempotent.
- **HTTP hardening:** strict Helmet CSP, CORS allowlist, Redis-backed rate
  limiting shared across instances.

Full control-by-control detail lives in the
[security audit](./security-audit.md).

## 10. Readiness status

Phases 1–7 are complete, committed, and gate-green (format, lint, typecheck,
test — 420 passed / 18 gated-skipped — and build). Docker `runtime` and `migrate`
images build clean.

Phase 8 (marketplace readiness) is the documentation and launch-readiness phase,
and its document set is complete:

- **Overview:** this report.
- **Guides:** [installation](./installation.md), [user](./user-guide.md), and
  [admin](./admin-guide.md) guides.
- **Marketplace:** [Slack Marketplace readiness](./marketplace-readiness.md)
  (OAuth flow + least-privilege scope review + branding specs).
- **Legal/compliance (templated):** [privacy policy](./privacy-policy.md),
  [terms of service](./terms-of-service.md), and
  [compliance checklist](./compliance-checklist.md).
- **Deployment & ops:** [DigitalOcean deployment](./digitalocean-deployment.md),
  [monitoring & alerting](./monitoring-and-alerting.md), and
  [disaster recovery](./disaster-recovery.md).
- **Audits & reports:** [security](./security-audit.md),
  [performance](./performance-results.md), [API](./api-review.md), and
  [accessibility](./accessibility-audit.md).
- **Gate:** the [release checklist](./release-checklist.md) go/no-go.

> What remains before a public launch is business/legal, not engineering: the
> legal entity/contact/jurisdiction for the privacy policy and terms, the
> branding image assets, the production domain, and the DigitalOcean deployment
> target (App Platform vs Droplet). These are flagged in-place with
> `[BUSINESS]` / `[COUNSEL]` / `[DECISION]` markers; work them through the
> [release checklist](./release-checklist.md).
