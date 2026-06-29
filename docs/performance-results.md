# Performance Results & Methodology

How MyQueue's performance is measured, how to reproduce the benchmarks, and how
to record authoritative numbers. The benchmark is a gated integration test that
runs against a live PostgreSQL + Redis, so results depend on the host and are
captured as measurements rather than strict pass/fail thresholds.

## What is measured

The benchmark lives in `tests/integration/queue-performance.test.ts` and covers
the queue's hot paths:

### Claim / recovery / statistics at depth

Runs at two queue depths (**1,000** and **10,000** items) with **100 workers**
contending:

- **Seed time** — bulk insert of the queue depth.
- **Claim latency & throughput** — a bounded sample (100 workers × 5 = 500
  claims) under full contention, using `FOR UPDATE SKIP LOCKED`. Reported as
  total ms, average ms/claim, and claims/sec.
- **Recovery batch** — reclaiming expired locks, items/ms.
- **Statistics latency** — `queueStatisticsService` aggregate query (guarded to
  complete in < 5,000 ms).
- **Heap delta** — `heapUsed` before/after, in MB.

> Claims are round-trip-bound, so latency is sampled rather than draining the full
> pool (a 10k drain is O(N) round trips and unsuitable for a fast, portable run).
> Authoritative large-scale numbers should be captured on an isolated/staging DB.

### Orchestration hot paths (bounded)

A second case measures the Phase 3C/5 sweeps, each with loose sanity guards
(< 30,000 ms) so a pathological regression still fails the gate:

- **Activation** sweep — wake due-snoozed items (1,000 seeded).
- **Recurrence** sweep — spawn one item per due rule (200 seeded).
- **Rate-limit** checks — 500 samples, average ms/check.
- **Dependency** claim — claim gated on dependencies (200 seeded).
- **Partition** claim — single-in-flight partition gate (200 seeded).

## How to run

The benchmark is gated behind `RUN_INTEGRATION=true` (skipped in the normal test
loop), and needs a reachable PostgreSQL and Redis with the schema migrated.

```bash
# 1. Ensure DATABASE_URL and REDIS_URL point at a test database, and migrate:
npx prisma migrate deploy

# 2. Run only the performance benchmark with integration gating on:
RUN_INTEGRATION=true npx jest tests/integration/queue-performance.test.ts --runInBand
```

On Windows PowerShell:

```powershell
$env:RUN_INTEGRATION = "true"
npx jest tests/integration/queue-performance.test.ts --runInBand
```

Results are emitted to the test console as `[perf]` and `[perf-orchestration]`
log lines (depth, worker count, sample size, seed/claim/recovery/statistics
timings, throughput, and heap delta).

## Recording results [BUSINESS]

Benchmark numbers are environment-specific, so this repo does not hard-code them.
To establish a baseline, run the benchmark on a representative
isolated/staging database and record the `[perf]` / `[perf-orchestration]` output
here:

| Date | Host / DB tier | Depth | Claim throughput | Stats ms | Heap Δ |
| --- | --- | --- | --- | --- | --- |
| `{{DATE}}` | `{{HOST}}` | 1,000 | `{{X}}/s` | `{{X}}` | `{{X}}MB` |
| `{{DATE}}` | `{{HOST}}` | 10,000 | `{{X}}/s` | `{{X}}` | `{{X}}MB` |

Re-run after significant changes to the claim path, indexes, or schema, and watch
for regressions against the recorded baseline.

## Interpreting & tuning

- **Claim throughput** is the headline number for worker scaling. If it is low,
  check DB connection pool size, latency to the database, and index health.
- **Statistics latency** climbing indicates the aggregate query needs attention
  at higher depths.
- **Heap delta** flags memory pressure in seed/claim loops.
- Tune the queue via [environment.md](./environment.md) (`QUEUE_*` variables) and
  scale API/worker per [disaster-recovery.md](./disaster-recovery.md)
  §Load-balancing review.

## See also

- [queue-engine.md](./queue-engine.md) — the claim/recovery/scheduler internals.
- [testing.md](./testing.md) — the CI gate and gated integration tests.
