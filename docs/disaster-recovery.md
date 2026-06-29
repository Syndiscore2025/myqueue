# Disaster Recovery Plan

Backups, restore procedures, recovery objectives, and the load-balancing review
for MyQueue. Engineering facts below reflect the codebase; targets marked
**[BUSINESS]** must be set by the business.

## What must be recovered

| Asset | Source of truth? | Impact if lost |
| --- | --- | --- |
| **PostgreSQL** | **Yes** | All tenant data: installations, users, queue items, recurrence/rate-limit rules, audit, billing columns. Critical. |
| **`ENCRYPTION_KEY`** | **Yes (separate)** | Decrypts stored Slack tokens. Losing it makes every installation unusable even with a DB restore. |
| **Redis** | No | Runtime queue state, rate-limit buckets, idempotency keys. Recoverable; loss re-opens dedupe windows and resets buckets. |
| **App image/config** | Reproducible | Rebuildable from the tagged image + env. |

## Backups

- **PostgreSQL:** enable automated managed backups (DigitalOcean Managed
  Databases snapshots) and/or scheduled `pg_dump`. **[BUSINESS]** Set frequency
  and retention (e.g. daily snapshots + PITR window). Verify restores
  periodically — an untested backup is not a backup.
- **Redis:** enable persistence (AOF; the Compose Redis uses `--appendonly`).
  Redis is not the source of truth, so backups are best-effort.
- **`ENCRYPTION_KEY`:** store securely in a secrets manager **separate from the
  database backups**, with its own backup. Never rotate without a token
  re-encryption plan (rotating invalidates all stored Slack tokens).
- **Configuration:** keep env/secrets in a secrets manager; keep the last two
  image tags available for rollback.

## Restore procedures

### Database restore

1. Provision/identify the target PostgreSQL instance.
2. Restore from the latest verified snapshot or `pg_dump` (or PITR to the chosen
   timestamp).
3. Point `DATABASE_URL` at the restored instance.
4. Ensure the **same `ENCRYPTION_KEY`** is configured, or stored Slack tokens
   cannot be decrypted.
5. Start the `migrate` step, then API + worker; verify with `/ready`,
   `/version`, and `GET /api/v1/queue/scheduler`.

### Redis loss

1. Stand up a fresh Redis and set `REDIS_URL`.
2. Restart API + worker. Expect: rate-limit buckets reset and dedupe windows
   re-open (a notification may resend once) — acceptable, not catastrophic.

### Full region/host loss

1. Recreate infra in a healthy region (DB restore + new Redis + app).
2. Repoint DNS (`APP_BASE_URL` domain) to the new endpoint.
3. Re-verify the Slack portal Redirect/Request URLs still resolve.
4. Verify end-to-end (install check, `/ready`, scheduler stats).

## Recovery objectives [BUSINESS]

| Objective | Target | Notes |
| --- | --- | --- |
| **RPO** (max data loss) | `{{RPO}}` | Bounded by DB backup frequency / PITR window. |
| **RTO** (max downtime) | `{{RTO}}` | Time to restore DB + redeploy app. |

Set these against the backup schedule; e.g. hourly snapshots ⇒ RPO ≈ 1h. Document
who is on call and the escalation path. **[BUSINESS]**

## Load-balancing review

- **API:** stateless and horizontally scalable. Rate limiting is Redis-backed and
  shared across instances, so adding API replicas behind a load balancer is safe.
  Route only to instances passing `GET /ready`. Set `TRUST_PROXY=true` behind the
  balancer so client IPs/rate limiting are correct.
- **Worker:** runs overlap-guarded background sweeps. **[DECISION]** Default to a
  **single worker instance**; the queue claim uses `FOR UPDATE SKIP LOCKED` so
  BullMQ item processing is safe to scale, but validate the periodic sweep loops
  (recovery, recurrence, follow-up, digest) before running multiple workers, to
  avoid redundant sweep passes.
- **Sticky sessions:** not required — the API holds no per-instance session state
  (auth is stateless bearer tokens).

## Testing the plan

- **[BUSINESS]** Schedule periodic restore drills (e.g. quarterly): restore a
  backup to a scratch environment, confirm decryption with the backed-up key, and
  time the RTO. Record results and adjust targets.

## See also

- [deployment.md](./deployment.md) — deploy/rollback and incident runbooks.
- [monitoring-and-alerting.md](./monitoring-and-alerting.md) — the signals that
  trigger a recovery.
