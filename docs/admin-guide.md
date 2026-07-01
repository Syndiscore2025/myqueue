# MyQueue Admin Guide

For workspace administrators and operators. Covers workspace settings, plans and
billing, the admin/analytics surfaces, and the operational endpoints. Every API
here is tenant-scoped: a request only ever sees data for its own workspace.

## Authentication

The application APIs are guarded by workspace-context middleware. In production,
requests must carry `Authorization: Bearer <token>`; the token is a stateless
HS256 token anchored to a verified Slack identity (mint one with `/myqueue
token`). The dev-only tenant-header fallback (`x-workspace-id` /
`x-workspace-user-id`) is disabled in production.

Base path for all examples: `https://YOUR_DOMAIN/api/v1`.

## Workspace settings

Read and update the workspace's queue and notification settings.

- `GET /workspace/settings` → `{ settings, plan }` — the current settings plus
  the plan and entitlements in force.
- `PATCH /workspace/settings` → `{ settings }` — update any subset of the fields
  below (omitted fields are left unchanged).

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `rankingMode` | enum | — | How items are ranked in views. |
| `includeWaitingInActive` | boolean | — | Count Waiting items as active. |
| `includeWorkingInActive` | boolean | — | Count Working items as active. |
| `notifyOnAssignment` | boolean | `true` | DM the assignee on assignment. |
| `notifyOnSnoozeWake` | boolean | `true` | DM the owner when a snooze wakes. |
| `notifyOnFollowUpDue` | boolean | `true` | DM the owner when a follow-up is due. |
| `dailyDigestEnabled` | boolean | `false` | Send the opt-in daily digest. |
| `dailyDigestHourUtc` | int (0–23) | `13` | Hour (UTC) the digest is sent. |

> The daily digest also requires the plan's `dailyDigest` entitlement (Pro and
> Business). Enabling it on a Free plan has no effect until you upgrade.

## Plans, entitlements & billing

Plans are **Free**, **Pro**, and **Business**. Entitlements:

| Entitlement | Free | Pro | Business |
| --- | --- | --- | --- |
| Max active items | 50 | 1,000 | Unlimited |
| Max workers | 1 | 10 | Unlimited |
| Max recurrence rules | 3 | 50 | Unlimited |
| Daily digest | — | ✓ | ✓ |
| Analytics / usage | — | ✓ | ✓ |

When a limit is exceeded (e.g. creating a 51st active item on Free), the API
returns `402 PLAN_LIMIT_EXCEEDED`.

Billing endpoints (Stripe-backed; only mounted when Stripe is configured):

- `GET /billing/plan` → `{ plan }` — current plan and entitlements.
- `POST /billing/checkout` `{ plan: "PRO" | "BUSINESS" }` → `{ url }` — a hosted
  Stripe Checkout URL to redirect the admin to for upgrading.
- `POST /billing/portal` → `{ url }` — the self-serve billing portal to manage or
  cancel a subscription.

Plan changes arrive via HMAC-verified Stripe webhooks, which update the workspace
plan/status and write a `PLAN_CHANGED` audit entry. Raw Stripe identifiers are
never echoed by the API.

## Admin overview

- `GET /admin/overview` consolidates the workspace identity, billing posture,
  entitlements, and live queue statistics into one view:

```json
{
  "workspace": { "id", "slackTeamName", "isEnterpriseInstall", "status",
                 "installedAt", "createdAt" },
  "billing":   { "plan", "status", "hasActiveSubscription", "planUpdatedAt" },
  "entitlements": { ... },
  "statistics":   { ... }
}
```

`hasActiveSubscription` reports only whether a paid subscription is connected —
Stripe identifiers are intentionally withheld.

## Analytics / usage

- `GET /analytics/usage` → `{ usage }` — the plan plus usage of each countable
  entitlement with remaining headroom, for capacity and billing insight. This is
  a paid feature: it returns `402` for a plan without the `analytics`
  entitlement (Free).

## Operational endpoints

Health and queue operations for operators (the queue operator routes live under
`/api/v1/queue`; see [queue-engine.md](./queue-engine.md) for the full list):

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness. |
| `GET /ready` | Readiness — checks PostgreSQL and Redis. |
| `GET /version` | Build/version, node env. |
| `GET /api/v1/queue/scheduler` | Scheduler stats: gated counts, next activation, oldest pending, recurrence/rate-limit footprint, DM-failure metrics. |
| `GET /api/v1/queue/statistics` | Aggregate queue + worker statistics. |
| `GET /api/v1/queue/dead-letter` | List dead-lettered items. |
| `POST /api/v1/queue/dead-letter/requeue` | Revive a dead-lettered item with a fresh retry budget. |
| `GET /api/v1/workers` | Registered workers with live processing counts. |

## Auditing

Significant events are recorded as tenant-scoped audit entries, including
`APP_INSTALLED` / `APP_REINSTALLED`, `PLAN_CHANGED`, `NOTIFIED`, and queue
lifecycle events (e.g. `RECALCULATED`). Use these for support and compliance.

## Common admin tasks

- **Turn on the daily digest:** ensure the plan is Pro or Business, then
  `PATCH /workspace/settings { "dailyDigestEnabled": true, "dailyDigestHourUtc": 9 }`.
- **Upgrade a plan:** `POST /billing/checkout { "plan": "PRO" }`, send the admin
  to the returned URL.
- **Investigate stalled work:** check `GET /api/v1/queue/scheduler` and the
  operational runbooks in [deployment.md](./deployment.md).
