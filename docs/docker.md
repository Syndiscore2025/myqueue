# Docker Guide

MyQueue ships a multi-stage production `Dockerfile` and two Compose files.

## Images

The `Dockerfile` has these stages:

- **base** — Debian-slim Node 22 with OpenSSL (required by Prisma).
- **deps** — installs all dependencies and generates the Prisma client.
- **build** — compiles TypeScript to `dist/`.
- **runtime** — production-only dependencies, the compiled `dist/`, and the
  generated Prisma client. Runs as the non-root `node` user with a container
  `HEALTHCHECK` hitting `/health`.

Build the production image directly:

```bash
docker build -t myqueue:latest --target runtime .
```

## Compose: full stack

`docker-compose.yml` runs the API, a worker, PostgreSQL, and Redis:

```bash
docker compose up --build
```

- API: http://localhost:3000
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

The API and worker wait for PostgreSQL and Redis to report **healthy** before
starting (`depends_on: condition: service_healthy`).

### Configuration

All settings have safe local defaults and can be overridden via a `.env` file in
the project root or via shell environment variables, e.g.:

```bash
APP_BASE_URL=https://myqueue.example.com \
ENCRYPTION_KEY=<64-hex> \
docker compose up --build
```

> **Production:** always override `ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, and
> `CORS_ORIGINS` with real, secret values. Never ship the defaults.

## Compose: dev datastores only

For host-based development you only need the datastores:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Then run `npm run dev` on the host.

## Common operations

```bash
docker compose ps                 # service status & health
docker compose logs -f api        # follow API logs
docker compose down               # stop the stack
docker compose down -v            # stop and remove volumes (data loss)
```

## Health & readiness

- The container `HEALTHCHECK` calls `/health` (liveness).
- Orchestrators should gate traffic on `/ready`, which verifies PostgreSQL and
  Redis connectivity.
