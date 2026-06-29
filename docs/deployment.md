# Deployment & Operations Guide

How to deploy MyQueue, apply schema changes safely, roll back a bad release, and
respond to the most common operational incidents.

## Topology

One image produces two long-running processes (see
[architecture.md](./architecture.md)):

- **API** (`node dist/server.js`) — serves HTTP; liveness `/health`, readiness
  `/ready`.
- **Worker** (`node dist/workers/index.js`) — runs the recovery, scheduler
  activation, recurrence, follow-up reminder, and daily digest loops.

Both depend on **PostgreSQL** and **Redis**. Schema changes are applied by a
one-shot **migrate** step (`prisma migrate deploy`) that must complete before
either process starts. See [docker.md](./docker.md) for the image stages and the
Compose `migrate` service.

## Required production configuration

Set these before deploying (full reference in [environment.md](./environment.md)):

- `NODE_ENV=production`, `APP_BASE_URL`, `DATABASE_URL`, `REDIS_URL`
- `ENCRYPTION_KEY` (64 hex chars), `AUTH_TOKEN_SECRET` (>= 32 chars)
- `CORS_ORIGINS` (explicit origins — never `*`), `TRUST_PROXY=true` behind a proxy
- Slack: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`,
  `SLACK_STATE_SECRET`
- Stripe (only if billing is enabled): `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET` (+ price/return URLs)

The process exits at startup if any required variable is missing or invalid.

## Deploy procedure

1. **Build & tag** the image at the target commit:
   `docker build -t myqueue:<sha> --target runtime .`
2. **Apply migrations** against the production database with the same commit:
   run the `migrate` image (`docker build ... --target migrate`) or
   `npm run prisma:migrate`. Migrations are forward-only and must be backward
   compatible with the currently-running release (expand/contract — add columns
   nullable first; drop only after the old version is gone).
3. **Roll out the API** behind the readiness gate: orchestrators must route
   traffic only when `GET /ready` returns `200` (it checks PostgreSQL + Redis).
4. **Roll out the worker.** It serves no HTTP; health is a Redis-reachability
   probe (see the Compose `worker.healthcheck`).
5. **Verify:** `GET /version` reports the expected version; `GET /ready` is `200`;
   logs show "worker runtime started ..."; `GET /api/v1/queue/scheduler` returns
   sane gated-item counts.

### Compose (single host)

```bash
docker compose up --build -d   # migrate runs first, then api + worker
docker compose ps              # confirm all healthy / migrate Exited (0)
```

## Rollback procedure

Rollback is **redeploy the previous image tag**, not a code revert.

1. **Identify** the last-known-good tag (the previous `myqueue:<sha>`).
2. **Re-point** the API and worker to that tag and restart them.
3. **Do not auto-run `migrate` on rollback.** Application rollback is safe only
   when the schema is backward compatible (the expand/contract rule above). If
   the bad release shipped a destructive migration, restore from backup instead —
   forward-only migrations have no automatic down step.
4. **Drain first if needed:** scale the worker to zero before rollback if a
   migration changed columns the in-flight loops read, then scale back up on the
   good tag.
5. **Verify** as in the deploy procedure (`/version`, `/ready`, scheduler stats).

> Keep the previous two image tags available at all times so rollback is a tag
> swap, never a rebuild.

## Backups & recovery

- Take **automated PostgreSQL backups** (managed-provider snapshots or
  `pg_dump`); verify restores periodically.
- Redis holds queue runtime state, rate-limit buckets, and idempotency keys. It
  is recoverable but not the source of truth; losing it re-opens dedupe windows
  (a notification may resend) and resets rate-limit buckets — acceptable, not
  catastrophic. Enable AOF persistence (the Compose Redis uses `--appendonly`).
- The encryption key (`ENCRYPTION_KEY`) decrypts stored Slack tokens. **Back it
  up securely and never rotate it without a token re-encryption plan** — losing
  it makes every stored installation unusable.

## Operational runbooks

### Worker stalls / items stuck Processing

Symptom: items remain `Processing`; `GET /api/v1/queue/scheduler` shows a growing
oldest-pending age.

- Confirm the worker process is up and connected to Redis (worker healthcheck).
- The recovery loop reclaims expired locks (`Processing -> New`) every
  `QUEUE_RECOVERY_INTERVAL`s once `QUEUE_LOCK_MINUTES` elapses. If items are stuck
  longer than the lock window, restart the worker and watch the recovery logs.
- Persistent stalls: check DB connectivity/latency and Redis health.

### Recurring-rule failures

Symptom: expected recurring items are not appearing.

- Check worker logs for recurrence-sweep errors and verify the rule is enabled.
- Inspect the recurrence summary in `GET /api/v1/queue/scheduler` (enabled rules
  + next run). A malformed cron disables generation for that rule only.

### Dead Letter Queue (DLQ) growth

Symptom: items moved to the DLQ after `QUEUE_MAX_RETRIES`.

- DLQ is the intended terminal state for repeatedly-failing work — investigate
  the failure cause before requeueing. Do not blindly raise `QUEUE_MAX_RETRIES`.
- Triage in batches; requeue only after the root cause is fixed.

### Migration failures

Symptom: the `migrate` step exits non-zero; API/worker never start (they gate on
its success).

- Read the migrate logs — a failed migration leaves the DB at the prior version.
- Fix the migration forward (never edit an already-applied migration). Re-run the
  migrate step. Do not start the app against a partially-migrated schema.

### Slack API outages / DM failures

Symptom: notifications not delivered; DM-failure counts rise.

- Every delivery path fails safe: a Slack outage never breaks a use case or sweep.
- Check the `notifications.dmFailures` counters in
  `GET /api/v1/queue/scheduler` (grouped by reason — e.g. missing/revoked token,
  Slack API error). A revoked token requires the workspace to reinstall.
- Transient Slack errors clear on the next sweep; idempotency keys prevent
  double-sends within the dedupe window.

## See also

- [docker.md](./docker.md) — image stages, Compose stack, the migrate service.
- [environment.md](./environment.md) — every configuration variable.
- [queue-engine.md](./queue-engine.md) — leases, recovery, retries, DLQ, scheduler.
- [testing.md](./testing.md) — the CI gate and gated integration tests.
