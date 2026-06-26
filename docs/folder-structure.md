# Folder Structure Guide

```
.
├── .github/workflows/ci.yml      # CI: lint, typecheck, test, build, docker
├── docs/                         # Project documentation
├── prisma/
│   ├── schema.prisma             # Datasource + multi-tenant Slack & queue models
│   └── migrations/               # SQL migrations
├── scripts/
│   └── clean.mjs                 # Build/coverage cleanup
├── src/
│   ├── config/
│   │   ├── env.ts                # Zod environment schema + parser
│   │   ├── index.ts              # Validated, frozen config singleton
│   │   └── app-info.ts           # Name/version from package.json
│   ├── domain/
│   │   ├── errors/               # ApplicationError hierarchy
│   │   └── queue/                # Pure queue rules: ranking, status machine, priority
│   ├── application/
│   │   └── queue/                # QueueService use-case orchestration
│   ├── infrastructure/
│   │   ├── database/prisma.ts    # Prisma client + health
│   │   ├── redis/redis.ts        # Redis connections + health
│   │   ├── crypto/               # AES-256-GCM TokenService (token encryption)
│   │   ├── repositories/         # Tenant-scoped Prisma repositories (incl. queue)
│   │   └── slack/                # Bolt app, InstallationStore, StateStore
│   ├── interfaces/
│   │   └── http/
│   │       ├── app.ts            # Express app assembly (+ Slack receiver mount)
│   │       ├── openapi.ts        # OpenAPI document (from Zod)
│   │       ├── middleware/       # security, logging, rate limit, errors, workspace context
│   │       └── routes/           # health (/health,/ready,/version) + /api/v1/queue
│   ├── queues/
│   │   └── queue-manager.ts      # BullMQ queue/worker registry
│   ├── workers/
│   │   └── index.ts              # Worker process entrypoint
│   ├── utils/
│   │   ├── logger.ts             # Pino logger
│   │   ├── async-handler.ts      # Express async wrapper
│   │   └── process-lifecycle.ts  # Graceful shutdown
│   └── server.ts                 # API process entrypoint
├── tests/
│   ├── jest.setup.ts
│   ├── unit/
│   └── integration/
├── Dockerfile                    # Multi-stage production image
├── docker-compose.yml            # Full stack: api, worker, postgres, redis
├── docker-compose.dev.yml        # Dev datastores only
├── eslint.config.mjs             # ESLint flat config (type-aware)
├── jest.config.js                # Jest + ts-jest config
├── tsconfig.json                 # Strict TypeScript config
├── tsconfig.build.json           # Build config (excludes tests)
└── .env.example                  # Environment template
```

## Layer responsibilities

| Directory          | Responsibility                                             |
| ------------------ | --------------------------------------------------------- |
| `config/`          | Environment validation and application metadata.          |
| `domain/`          | Framework-free business model and errors (queue rules).   |
| `application/`     | Use-case orchestration (e.g. the queue service).          |
| `infrastructure/`  | Adapters to external systems (DB, Redis, integrations).   |
| `interfaces/http/` | HTTP delivery: Express app, routes, middleware, OpenAPI.  |
| `queues/`          | BullMQ queue and worker management.                       |
| `workers/`         | Background worker process bootstrap.                      |
| `utils/`           | Cross-cutting helpers shared across layers.               |

## Conventions

- New features add a vertical slice across `domain` → `application` →
  `infrastructure`/`interfaces`, keeping dependencies pointing inward.
- Each directory exposes its public surface via an `index.ts` where helpful.
- Tests mirror the runtime layout under `tests/unit` and `tests/integration`.
