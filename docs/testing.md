# Testing Guide

Tests run on **Jest** with **ts-jest**. A global setup file
(`tests/jest.setup.ts`) provides a deterministic, non-secret test environment so
modules that validate configuration at import time work without a real `.env`.

## Running tests

```bash
npm test               # run all suites
npm run test:coverage  # run with a coverage report
```

Coverage is written to `coverage/`.

## Test layout

```
tests/
  jest.setup.ts                     # global env setup
  unit/
    env.test.ts                     # environment validation
    errors.test.ts                  # ApplicationError hierarchy
    queue-ranking-engine.test.ts    # ranking, status machine, priority rules
    repositories.test.ts            # tenant-scoped queue repositories
    queue-service.test.ts           # queue application use cases
  integration/
    http.test.ts                    # /health, /ready, /version, error envelope
    queue-routes.test.ts            # /api/v1/queue surface + tenant guard
    redis.connection.test.ts        # live Redis PING (gated)
    prisma.connection.test.ts       # live PostgreSQL query (gated)
```

## Unit vs. integration tests

- **Unit tests** never touch external systems and always run.
- **HTTP tests** use `supertest` against the real Express app, with the
  datastore health checks mocked, so they run anywhere.
- **Connectivity tests** (`*.connection.test.ts`) require a live PostgreSQL and
  Redis. They are **skipped by default** and only run when
  `RUN_INTEGRATION=true`.

Run the connectivity tests locally against the dev datastores:

```bash
docker compose -f docker-compose.dev.yml up -d
RUN_INTEGRATION=true npm test
```

On Windows PowerShell:

```powershell
$env:RUN_INTEGRATION = 'true'; npm test
```

## In CI

The GitHub Actions `verify` job starts PostgreSQL and Redis as service
containers and runs the full suite with `RUN_INTEGRATION=true`, so the
connectivity tests execute on every push and pull request.

## Writing new tests

- Place pure logic tests under `tests/unit/`.
- Place tests that exercise HTTP or external systems under `tests/integration/`.
- Gate anything requiring live infrastructure behind the `RUN_INTEGRATION` flag.
