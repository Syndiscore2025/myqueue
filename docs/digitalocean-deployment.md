# DigitalOcean Deployment Guide

How to host MyQueue on DigitalOcean. Two supported targets are described; pick
one. This builds on the provider-agnostic [deployment.md](./deployment.md) and
[environment.md](./environment.md) — read those first for the deploy/rollback
procedure and the full configuration reference.

> **[DECISION] App Platform vs Droplet.** Choose based on your operational
> appetite. App Platform is managed (less ops, higher per-unit cost); a Droplet
> with Docker Compose is cheaper and more flexible but you run the host. Both
> need managed PostgreSQL and Redis.

## Shared prerequisites

- A built runtime image (`docker build --target runtime -t myqueue:<sha> .`),
  pushed to a registry (DigitalOcean Container Registry or GHCR).
- **Managed PostgreSQL** (DigitalOcean Managed Databases) → `DATABASE_URL`.
- **Managed Redis / Valkey** (with persistence) → `REDIS_URL`.
- A domain with DNS pointed at the deployment → `APP_BASE_URL=https://YOUR_DOMAIN`.
- The required production config from [deployment.md](./deployment.md) §Required
  production configuration (secrets, CORS, `TRUST_PROXY=true`).
- Migrations applied with the same commit before app start (the `migrate` image
  / `prisma migrate deploy`).

## Environment variables (production)

Every variable is validated at boot by the Zod schema in `src/config/env.ts`. **If
anything required is missing or malformed, the process exits immediately** with a
list of problems — a bad config fails the deploy at the `/ready` gate rather than
booting in a broken state. Set these as **App-level secrets** (App Platform) or in
the host `.env` / Docker secrets (Droplet). Never commit real values.

### Required in production — the app will not boot without these

| Variable             | Example / format                                       | Notes                                                                                                  |
| -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`           | `production`                                           | Enables production behavior and disables the dev header-auth fallback.                                  |
| `APP_BASE_URL`       | `https://app.yourdomain.com`                          | Public HTTPS URL. Must be a valid URL and exactly match the Slack OAuth redirect host.                  |
| `DATABASE_URL`       | `postgresql://USER:PASS@HOST:25060/db?sslmode=require` | DO Managed PostgreSQL connection string; include `sslmode=require`.                                     |
| `REDIS_URL`          | `rediss://default:PASS@HOST:25061`                    | DO Managed Redis/Valkey. Use `rediss://` (TLS) for managed instances.                                   |
| `ENCRYPTION_KEY`     | 64 hex chars (32 bytes)                                | AES-256-GCM key for token-at-rest encryption. Rotating it invalidates stored Slack tokens.             |
| `AUTH_TOKEN_SECRET`  | ≥ 32 chars                                             | HS256 signing secret for API bearer tokens. **Mandatory in production** (the dev fallback is disabled). |
| `SLACK_CLIENT_ID`    | from Slack app                                         | Slack → Basic Information → App Credentials.                                                            |
| `SLACK_CLIENT_SECRET`| from Slack app                                         | Treat as a secret.                                                                                      |
| `SLACK_SIGNING_SECRET`| from Slack app                                        | Verifies inbound Slack request signatures.                                                              |
| `SLACK_STATE_SECRET` | ≥ 32 chars                                             | Signs the OAuth `state` parameter against CSRF.                                                         |

### Strongly recommended in production (defaults are dev-oriented)

| Variable       | Set to                       | Notes                                                                                          |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `CORS_ORIGINS` | `https://app.yourdomain.com` | Comma-separated. **Defaults to `*`** and is not enforced-against — set explicit origins.        |
| `TRUST_PROXY`  | `true`                       | Required behind App Platform / a reverse proxy / LB so client IPs and rate limiting work.       |
| `PORT`         | `3000`                       | API listen port. App Platform injects its own `PORT`; leave the default and bind to it.         |
| `LOG_LEVEL`    | `info`                       | One of `fatal`…`trace` \| `silent`.                                                             |

### Optional tunables (safe defaults — override only if needed)

`RATE_LIMIT_MAX` (100), `RATE_LIMIT_WINDOW_MS` (60000), `AUTH_TOKEN_TTL_SECONDS`
(3600), and the queue knobs `QUEUE_LOCK_MINUTES`, `QUEUE_HEARTBEAT_SECONDS`,
`QUEUE_RECOVERY_BATCH_SIZE`, `QUEUE_MAX_RETRIES`, `QUEUE_RECOVERY_INTERVAL`,
`QUEUE_SCHEDULER_INTERVAL_SECONDS`, `QUEUE_ACTIVATION_BATCH_SIZE`,
`QUEUE_RECURRENCE_BATCH_SIZE`, `QUEUE_FOLLOW_UP_INTERVAL_SECONDS`,
`QUEUE_FOLLOW_UP_BATCH_SIZE`, `QUEUE_DIGEST_INTERVAL_SECONDS`. Slack scope/socket
overrides: `SLACK_BOT_SCOPES` (default
`commands,chat:write,im:write,users:read,team:read`), `SLACK_USER_SCOPES`,
`SLACK_APP_TOKEN` (Socket Mode only — leave blank for HTTP).

### Billing (only if Stripe billing is enabled)

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both required to turn billing
on; `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, `STRIPE_CHECKOUT_SUCCESS_URL`,
`STRIPE_CHECKOUT_CANCEL_URL`, and `STRIPE_PORTAL_RETURN_URL` complete the surface.
Leave all blank to run with billing disabled (the surface is simply not mounted).

### Generate the secrets

```bash
# Run three times — once each for ENCRYPTION_KEY, AUTH_TOKEN_SECRET, SLACK_STATE_SECRET.
# Generate them INDEPENDENTLY; never reuse one value for multiple secrets.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Option A — App Platform (managed)

Recommended when you want DigitalOcean to manage TLS, scaling, and the host.

1. **Create the app** from your container image (or repo). Define **two
   components** from the same image:
   - a **Web Service** running `node dist/server.js` (HTTP, port `3000`);
   - a **Worker** running `node dist/workers/index.js` (no HTTP).
2. **Attach data:** add the Managed PostgreSQL and Redis, exposing their
   connection strings as `DATABASE_URL` and `REDIS_URL`.
3. **Run migrations:** add a **pre-deploy Job** running `npx prisma migrate
   deploy` (or use the `migrate` image) so the schema is applied before the new
   release receives traffic.
4. **Set env vars** as App-level secrets (per [environment.md](./environment.md)).
   App Platform terminates TLS and sets forwarded headers — keep
   `TRUST_PROXY=true`.
5. **Health checks:** point the Web Service health check at `GET /ready` (200 =
   ready; it verifies PostgreSQL + Redis). Use `GET /health` for liveness.
6. **Scaling:** scale the Web Service horizontally as needed (rate limiting is
   Redis-backed, so it is shared across instances). The Worker loops are
   overlap-guarded; **[DECISION]** keep the worker at a single instance unless you
   have validated multi-instance sweep behaviour.

### Declarative app spec (`doctl`)

You can define the whole app — web service, worker, pre-deploy migration job, and
attached managed databases — in one spec and apply it with `doctl`. Authenticate
first with `doctl auth init` (paste your DO token at the prompt; it never enters a
command argument). Sketch of `app.yaml`:

```yaml
name: myqueue
region: nyc
databases:
  - { name: db, engine: PG, production: true }
  - { name: cache, engine: REDIS, production: true }
jobs:
  - name: migrate
    kind: PRE_DEPLOY
    image: { registry_type: DOCR, repository: myqueue, tag: <sha> }
    run_command: npx prisma migrate deploy
    envs:
      - { key: DATABASE_URL, value: ${db.DATABASE_URL} }
services:
  - name: web
    image: { registry_type: DOCR, repository: myqueue, tag: <sha> }
    run_command: node dist/server.js
    http_port: 3000
    instance_count: 1
    instance_size_slug: basic-xs
    health_check: { http_path: /ready }
    envs:
      - { key: NODE_ENV, value: production }
      - { key: APP_BASE_URL, value: https://app.yourdomain.com }
      - { key: CORS_ORIGINS, value: https://app.yourdomain.com }
      - { key: TRUST_PROXY, value: "true" }
      - { key: DATABASE_URL, value: ${db.DATABASE_URL} }
      - { key: REDIS_URL, value: ${cache.DATABASE_URL} }
      - { key: ENCRYPTION_KEY, type: SECRET }
      - { key: AUTH_TOKEN_SECRET, type: SECRET }
      - { key: SLACK_CLIENT_ID, type: SECRET }
      - { key: SLACK_CLIENT_SECRET, type: SECRET }
      - { key: SLACK_SIGNING_SECRET, type: SECRET }
      - { key: SLACK_STATE_SECRET, type: SECRET }
workers:
  - name: worker
    image: { registry_type: DOCR, repository: myqueue, tag: <sha> }
    run_command: node dist/workers/index.js
    instance_count: 1
    instance_size_slug: basic-xs
    envs: # same DATABASE_URL/REDIS_URL bindings + the same SECRET keys as `web`
      - { key: NODE_ENV, value: production }
      - { key: DATABASE_URL, value: ${db.DATABASE_URL} }
      - { key: REDIS_URL, value: ${cache.DATABASE_URL} }
```

```bash
doctl apps create --spec app.yaml          # first deploy
doctl apps update <app-id> --spec app.yaml # subsequent deploys (tag bump)
```

- **Bound datastore vars:** attaching the managed `db`/`cache` lets App Platform
  inject `${db.DATABASE_URL}` and `${cache.DATABASE_URL}`, so you never hardcode
  connection strings.
- **Secret values:** set each `type: SECRET` key's value in the DO console (or an
  **untracked** copy of the spec). Never commit real secrets — once applied, DO
  stores them encrypted and the spec shows `EV[...]` ciphertext.
- **Env-var reference:** see the
  [Environment variables](#environment-variables-production) section above for what
  each key means and which are required.

## Option B — Droplet + Docker Compose

Recommended for cost/flexibility when you are comfortable managing a host.

1. **Provision a Droplet** (Ubuntu LTS, sized per expected load) and install
   Docker + the Compose plugin.
2. **Place a reverse proxy** in front (Caddy or Nginx) to terminate TLS for
   `YOUR_DOMAIN` and forward to the API on port `3000`. Set `TRUST_PROXY=true`.
3. **Provide config** via a `.env` file on the host (never committed) or Docker
   secrets, covering all required production variables.
4. **Use managed PostgreSQL/Redis** (recommended) rather than co-locating
   stateful services on the Droplet; point `DATABASE_URL`/`REDIS_URL` at them.
5. **Deploy with Compose** — the stack runs `migrate` first, then gates `api` and
   `worker` on its success (see [docker.md](./docker.md)):
   ```bash
   docker compose up -d        # migrate → api + worker
   docker compose ps           # api/worker healthy, migrate Exited (0)
   ```
6. **Verify:** `GET /version`, `GET /ready` (200), and
   `GET /api/v1/queue/scheduler` from the public domain.

## TLS & networking

- Terminate TLS at App Platform or the Droplet's reverse proxy; MyQueue speaks
  plain HTTP behind it. Always set `TRUST_PROXY=true` so client IPs and the
  rate limiter work correctly.
- Restrict the managed database/Redis to the app's private network / trusted
  sources only.
- Set `CORS_ORIGINS` to explicit origins — never `*` in production.

## Deploy & rollback

Follow [deployment.md](./deployment.md): build/tag, migrate (expand/contract),
roll out behind the `/ready` gate, then verify. Rollback is a **tag swap** to the
previous image — keep the last two tags available. On App Platform, redeploy the
prior image/version; on a Droplet, re-point the Compose image tag and
`docker compose up -d`.

## Cost & sizing notes [BUSINESS]

- **[BUSINESS]** Choose Droplet/App component sizes and the managed DB/Redis tiers
  for your expected workspace count and queue volume.
- Start small; the API scales horizontally and the worker is single-instance by
  default. Right-size from real metrics (see
  [monitoring-and-alerting.md](./monitoring-and-alerting.md)).

## Operations

- Monitoring/alerting: [monitoring-and-alerting.md](./monitoring-and-alerting.md).
- Backups, restore, RTO/RPO, load balancing:
  [disaster-recovery.md](./disaster-recovery.md).
- Incident runbooks: [deployment.md](./deployment.md) §Operational runbooks.
