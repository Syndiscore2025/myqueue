# Monitoring & Alerting

What to watch in production and how to wire alerts. MyQueue exposes
HTTP probes, a scheduler-statistics endpoint, and structured logs; this maps each
signal to a recommended alert. Endpoint behaviour is grounded in the codebase.

## Signals

### Health & readiness

| Endpoint | Use | Healthy |
| --- | --- | --- |
| `GET /health` | Liveness probe | `{ "status": "ok" }` |
| `GET /ready` | Readiness / routing gate | `200` with `checks.database` and `checks.redis` both `true` |
| `GET /version` | Deploy verification | Expected version + node env |

Wire `/ready` as the load-balancer / orchestrator routing gate so instances only
receive traffic when PostgreSQL and Redis are reachable. The worker serves no
HTTP; probe it via Redis reachability (see the Compose `worker.healthcheck`).

### Scheduler & queue statistics

`GET /api/v1/queue/scheduler` is the primary queue-health signal. It reports:

- gated-item counts and the **next activation** time;
- the **oldest pending item** age;
- the recurrence and rate-limit footprint;
- `notifications.dmFailures` — DM-failure counts grouped by reason.

`GET /api/v1/queue/statistics` adds aggregate queue + worker statistics, and
`GET /api/v1/workers` lists registered workers with live processing counts.

### Structured logs

Pino emits structured JSON with a per-request child logger and stable request id.
Secret fields and authorization headers are redacted. Ship logs to your provider
(DigitalOcean log forwarding, or a sink like Logtail/Datadog) and alert on error
rates and specific messages.

## Recommended alerts

| Alert | Source | Condition (tune to your traffic) |
| --- | --- | --- |
| API down | `/health` | Fails for `> {{N}}` consecutive checks. |
| Not ready | `/ready` | `503` or a `checks.*` false for `> {{N}}`s. |
| DB/Redis dependency | `/ready` `checks` | Either dependency false. |
| Oldest-pending climbing | `/queue/scheduler` | Oldest pending age `> {{THRESHOLD}}` (worker stall). |
| DM failures rising | `/queue/scheduler` | `notifications.dmFailures` rate `> {{THRESHOLD}}` (often revoked tokens). |
| DLQ growth | `/queue/statistics` | Dead-letter count increasing steadily. |
| Worker absent | `/api/v1/workers` | Expected worker missing / zero processing. |
| Error-rate spike | Logs | `level>=error` rate `> {{THRESHOLD}}`. |
| 5xx / latency | Proxy/App metrics | 5xx rate or p95 latency `> {{THRESHOLD}}`. |
| Resource saturation | Host/App metrics | CPU/mem/connections `> {{THRESHOLD}}`. |

> `{{N}}` / `{{THRESHOLD}}` are **[BUSINESS]** decisions — set from a baseline
> after a period of normal operation.

## Suggested dashboard

- **Availability:** `/health` + `/ready` status, API 5xx rate, p95 latency.
- **Queue health:** oldest-pending age, gated-item counts, next activation,
  active vs dead-letter counts, worker count + processing.
- **Notifications:** `dmFailures` by reason over time.
- **Infrastructure:** CPU/memory, DB connections/latency, Redis memory/latency.

## Wiring on DigitalOcean

- **App Platform:** use the built-in component metrics + alert policies (CPU, mem,
  restart count) and add an external uptime check against `/ready`. Forward logs
  to your sink.
- **Droplet:** scrape host metrics (DO monitoring agent), put uptime checks on
  `/health` and `/ready`, and forward container logs from the reverse proxy and
  app containers.
- **Managed DB/Redis:** enable the provider's metrics and alerts (connections,
  disk, memory, replication lag).

## Synthetic checks

Run an external uptime monitor against `https://YOUR_DOMAIN/ready` and
`/version` from outside your network to catch DNS/TLS/proxy issues the internal
probes cannot see.

## See also

- [deployment.md](./deployment.md) — incident runbooks tied to these signals.
- [disaster-recovery.md](./disaster-recovery.md) — backups, restore, RTO/RPO.
