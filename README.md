# MyQueue

Production backend platform for **MyQueue** — a SaaS application that will
eventually ship as a Slack Marketplace app.

It builds up in phases on a strictly-typed Node.js/TypeScript backend with
PostgreSQL (Prisma), Redis, BullMQ, structured logging, centralized error
handling, security middleware, health/readiness/version endpoints, OpenAPI docs,
Docker packaging, a full test suite, and CI/CD:

- **Phase 1** — the permanent infrastructure foundation.
- **Phase 2** — Slack Marketplace foundation: multi-tenant OAuth/install.
- **Phase 3A** — the queue engine: domain models, ranking & position engine, and
  an internal `/api/v1/queue` API (see
  [docs/queue-engine.md](docs/queue-engine.md)).

## Tech stack

- **Runtime:** Node.js 22 LTS, TypeScript (strict)
- **HTTP:** Express, Helmet, CORS, compression, rate limiting
- **Data:** PostgreSQL via Prisma
- **Cache / queues:** Redis (ioredis), BullMQ
- **Validation:** Zod
- **Logging:** Pino
- **Docs:** OpenAPI 3 (generated from Zod) + Swagger UI
- **Quality:** ESLint, Prettier, Jest, GitHub Actions

## Quick start (local)

```bash
# 1. Install dependencies (also generates the Prisma client)
npm install

# 2. Create your environment file and fill in values
cp .env.example .env

# 3. Start datastores (PostgreSQL + Redis) in Docker
docker compose -f docker-compose.dev.yml up -d

# 4. Run the API in watch mode
npm run dev
```

The API is then available at `http://localhost:3000`:

- `GET /health` — liveness
- `GET /ready` — readiness (checks PostgreSQL + Redis)
- `GET /version` — build/version info
- `GET /docs` — Swagger UI
- `GET /openapi.json` — OpenAPI document

## Full stack with Docker

```bash
docker compose up --build
```

This starts the API, a background worker, PostgreSQL, and Redis. See
[docs/docker.md](docs/docker.md).

## Common commands

| Command                 | Description                              |
| ----------------------- | ---------------------------------------- |
| `npm run dev`           | Run the API with hot reload              |
| `npm run dev:worker`    | Run the background worker with hot reload|
| `npm run build`         | Compile TypeScript to `dist/`            |
| `npm start`             | Run the compiled API                     |
| `npm run lint`          | ESLint (zero warnings allowed)           |
| `npm run typecheck`     | Type-check without emitting              |
| `npm test`              | Run the test suite                       |
| `npm run test:coverage` | Run tests with coverage                  |
| `npm run format`        | Format with Prettier                     |
| `npm run prisma:generate` | Regenerate the Prisma client           |

## Documentation

- [Getting Started](docs/getting-started.md)
- [Architecture Overview](docs/architecture.md)
- [Queue Engine (Phase 3A)](docs/queue-engine.md)
- [Local Development Guide](docs/local-development.md)
- [Docker Guide](docs/docker.md)
- [Environment Guide](docs/environment.md)
- [Testing Guide](docs/testing.md)
- [Folder Structure Guide](docs/folder-structure.md)

## License

Proprietary — © MyQueue. All rights reserved.
