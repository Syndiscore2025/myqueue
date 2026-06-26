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
| `SLACK_CLIENT_ID`      | no       | `""`                       | Slack OAuth client id (used in later phases).                     |
| `SLACK_CLIENT_SECRET`  | no       | `""`                       | Slack OAuth client secret.                                        |
| `SLACK_SIGNING_SECRET` | no       | `""`                       | Slack request-signing secret.                                     |
| `SLACK_STATE_SECRET`   | no       | `""`                       | Slack OAuth state secret.                                         |
| `SLACK_APP_TOKEN`      | no       | `""`                       | Slack app-level token (Socket Mode).                             |
| `STRIPE_SECRET_KEY`    | no       | `""`                       | Stripe secret key (billing, later phases).                       |
| `STRIPE_WEBHOOK_SECRET`| no       | `""`                       | Stripe webhook signing secret.                                   |

## Generating secrets

```bash
# ENCRYPTION_KEY (32 bytes, hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Credentials required for later phases

The Slack and Stripe variables are declared now but are **not used** in Phase 1.
They will be required when the corresponding features are implemented:

- **Slack** (`SLACK_*`) — created in the Slack app configuration at
  https://api.slack.com/apps when Slack functionality is added.
- **Stripe** (`STRIPE_*`) — created in the Stripe dashboard when billing is
  added.

Leaving them blank in Phase 1 is fully supported.
