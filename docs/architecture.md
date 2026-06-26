# Architecture Overview

MyQueue follows a **clean / layered architecture** designed so individual
concerns stay decoupled and the platform can later be split into independent
services without rewrites.

## Layers

```
interfaces/      HTTP delivery: Express app, routes, middleware, OpenAPI
application/      Use cases / orchestration (added in later phases)
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
- **Worker** (`src/workers/index.ts`) — runs BullMQ workers (none in Phase 1).

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

## Future service extraction

Because delivery (`interfaces`), orchestration (`application`), and
infrastructure are separated, a feature can later be extracted into its own
deployable by moving its slice plus the shared `domain`/`config`/`utils`
packages — no entanglement with HTTP or framework code.
