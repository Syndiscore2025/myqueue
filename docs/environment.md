# Environment Guide

All configuration is validated at startup by a single Zod schema
(`src/config/env.ts`). If any variable is missing or invalid, the process exits
immediately with a message listing each problem. Copy `.env.example` to `.env`
to begin.

> **Never commit a real `.env` file.** Only `.env.example` is tracked.

## Variables

| Variable               | Required | Default                    | Description                                                        |
| ---------------------- | -------- | -------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`             | no       | `development`              | `development` \| `test` \| `production`.                           |
| `PORT`                 | no       | `3000`                     | HTTP port for the API.                                             |
| `APP_BASE_URL`         | **yes**  | —                          | Public base URL (used for OAuth callbacks, OpenAPI server, links). |
| `LOG_LEVEL`            | no       | `info`                     | `fatal`…`trace` \| `silent`.                                       |
| `DATABASE_URL`         | **yes**  | —                          | PostgreSQL connection string (Prisma).                            |
| `REDIS_URL`            | **yes**  | —                          | Redis connection string (BullMQ + cache).                         |
| `ENCRYPTION_KEY`       | **yes**  | —                          | 32-byte key, hex-encoded (64 hex chars).                          |
| `CORS_ORIGINS`         | no       | `*`                        | Comma-separated allowed origins. `*` allows all (dev only).       |
| `RATE_LIMIT_MAX`       | no       | `100`                      | Max requests per window per client.                               |
| `RATE_LIMIT_WINDOW_MS` | no       | `60000`                    | Rate-limit window in milliseconds.                                |
| `TRUST_PROXY`          | no       | `false`                    | Set `true` behind a reverse proxy/load balancer.                  |
| `AUTH_TOKEN_SECRET`    | prod³    | `""`                       | Secret signing HS256 API bearer tokens (>= 32 chars). Phase 7.    |
| `AUTH_TOKEN_TTL_SECONDS` | no     | `3600`                     | Lifetime of a minted API bearer token, in seconds.               |
| `QUEUE_LOCK_MINUTES`        | no   | `5`                        | Lifetime of a worker's lock on a claimed item before it expires.  |
| `QUEUE_HEARTBEAT_SECONDS`   | no   | `30`                       | How often workers refresh their lease via the heartbeat endpoint. |
| `QUEUE_RECOVERY_BATCH_SIZE` | no   | `100`                      | Max expired locks reclaimed per recovery batch.                   |
| `QUEUE_MAX_RETRIES`         | no   | `3`                        | Total attempts before an item moves to the Dead Letter Queue.     |
| `QUEUE_RECOVERY_INTERVAL`   | no   | `60`                       | Seconds between background recovery sweeps.                        |
| `QUEUE_FOLLOW_UP_INTERVAL_SECONDS` | no | `60`                  | Seconds between follow-up reminder sweeps (Phase 5).              |
| `QUEUE_FOLLOW_UP_BATCH_SIZE`       | no | `200`                 | Max due follow-ups DM'd per reminder sweep (Phase 5).            |
| `QUEUE_DIGEST_INTERVAL_SECONDS`    | no | `900`                 | Seconds between daily-digest sweeps (Phase 5).                   |
| `SLACK_CLIENT_ID`      | prod¹    | `""`                       | Slack OAuth client id (Phase 2 install flow).                     |
| `SLACK_CLIENT_SECRET`  | prod¹    | `""`                       | Slack OAuth client secret.                                        |
| `SLACK_SIGNING_SECRET` | prod¹    | `""`                       | Slack request-signing secret (verifies inbound requests).        |
| `SLACK_STATE_SECRET`   | prod¹    | `""`                       | Slack OAuth state secret.                                         |
| `SLACK_APP_TOKEN`      | no       | `""`                       | Slack app-level token (Socket Mode only).                        |
| `SLACK_BOT_SCOPES`     | no       | `commands,chat:write,im:write,im:read,users:read,team:read,...` | Comma-separated bot OAuth scopes requested on install. |
| `SLACK_USER_SCOPES`    | no       | `im:read,im:history`        | Comma-separated user OAuth scopes requested for authorized personal DM capture. |
| `STRIPE_SECRET_KEY`    | billing² | `""`                       | Stripe secret API key (Checkout, billing portal, API calls).     |
| `STRIPE_WEBHOOK_SECRET`| billing² | `""`                       | Stripe webhook signing secret (verifies inbound webhooks).       |
| `STRIPE_PRICE_PRO`     | no       | `""`                       | Stripe recurring price id mapped to the **Pro** plan.            |
| `STRIPE_PRICE_BUSINESS`| no       | `""`                       | Stripe recurring price id mapped to the **Business** plan.       |
| `STRIPE_CHECKOUT_SUCCESS_URL` | no | `""`                     | Return URL after a successful Checkout (defaults under `APP_BASE_URL`). |
| `STRIPE_CHECKOUT_CANCEL_URL`  | no | `""`                     | Return URL when Checkout is cancelled.                           |
| `STRIPE_PORTAL_RETURN_URL`    | no | `""`                     | Return URL from the Stripe billing portal.                      |

¹ The four required `SLACK_*` credentials are optional in development/test (the
Slack surface is simply not mounted) but **mandatory in production** — the
process refuses to boot without them.

² The two core `STRIPE_*` credentials are optional everywhere. When both are set
the billing surface (`/api/v1/billing/*` and the Stripe webhook receiver) is
mounted; when either is blank the app boots in **Free-only** mode with billing
disabled, mirroring the Slack-optional pattern.

³ `AUTH_TOKEN_SECRET` is optional in development/test, where the HTTP guards fall
back to explicit `x-workspace-id` / `x-worker-id` headers, but **mandatory in
production** (and at least 32 characters). In production that header fallback is
disabled, so every API request must carry a valid `Authorization: Bearer <token>`
minted from a verified Slack identity. See [`slack.md`](./slack.md) for how users
obtain a token with `/myqueue token`.

## Generating secrets

```bash
# ENCRYPTION_KEY (32 bytes, hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Credentials

- **Slack** (`SLACK_*`) — created in the Slack app configuration at
  https://api.slack.com/apps. Required for the Phase 2 OAuth/install surface;
  see [`slack.md`](./slack.md) for the full setup walkthrough (scopes, redirect
  URL, event subscriptions). Optional in development/test, required in
  production.
- **Stripe** (`STRIPE_*`) — created in the Stripe dashboard. `STRIPE_SECRET_KEY`
  and `STRIPE_WEBHOOK_SECRET` enable the billing surface; the `STRIPE_PRICE_*`
  ids map the Pro/Business plans to their recurring prices. Point a Stripe
  webhook endpoint at `{APP_BASE_URL}/api/v1/billing/webhook`. Leaving these
  blank runs the app in Free-only mode.
- **API tokens** (`AUTH_TOKEN_SECRET`) — a self-generated secret (not a
  third-party credential). It signs the HS256 bearer tokens that authenticate
  the HTTP API. Users mint a personal token with the `/myqueue token` Slack
  command; the token derives its workspace/user identity from the verified Slack
  request, so Slack remains the single source of truth. A host integrating their
  own identity provider can instead implement the `AuthVerifier` seam
  (`src/application/auth`) and issue tokens from their own flow.
