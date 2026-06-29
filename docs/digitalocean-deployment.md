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
