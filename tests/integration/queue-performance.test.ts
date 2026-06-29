import {
  connectDatabase,
  disconnectDatabase,
  getPrisma,
} from '../../src/infrastructure/database/prisma';
import {
  queueActivationService,
  queueClaimService,
  queueRecoveryService,
  queueRecurrenceService,
  queueStatisticsService,
} from '../../src/application/queue';
import { formatPermanentQueueId } from '../../src/infrastructure/repositories/queue-item-repository';
import { queueRateLimitRepository } from '../../src/infrastructure/repositories';
import { QueueStatus } from '../../src/domain/queue';
import { QueueStatus as DbStatus, QueueDependencyType } from '@prisma/client';

// Performance benchmarks against a live database. Gated by RUN_INTEGRATION; the
// findings (claim/recovery/statistics latency + memory) are logged for the
// docs. These are measurements, not strict assertions, so thresholds stay loose.
const describeIntegration = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

const WS = 'ws-performance-test';
const USER = 'wu-performance-test';
const WORKERS = 100;
// Claims are round-trip-bound, so we measure latency over a bounded sample at
// each queue depth rather than draining the whole pool (a full 10k drain is
// O(N) round trips and unsuitable for a fast, portable test). Authoritative
// large-scale numbers are captured separately on an isolated/staging database.
const CLAIM_PER_WORKER = 5;
const CLAIM_SAMPLE = WORKERS * CLAIM_PER_WORKER;
const SEED_CHUNK = 2_000;
// Orchestration hot-path sizes — bounded for a fast, portable run. Authoritative
// large-scale numbers are captured separately on an isolated/staging database.
const ACT_SEED = 1_000;
const REC_SEED = 200;
const RL_SAMPLE = 500;
const DEP_SEED = 200;
const PART_SEED = 200;
const CLAIMERS = 50;
const prisma = getPrisma();

async function seedWorkspace(): Promise<void> {
  await prisma.workspace.upsert({ where: { id: WS }, create: { id: WS }, update: {} });
  await prisma.workspaceUser.upsert({
    where: { id: USER },
    create: { id: USER, workspaceId: WS, slackUserId: 'U-performance' },
    update: {},
  });
}

async function cleanQueue(): Promise<void> {
  await prisma.queueEvent.deleteMany({ where: { workspaceId: WS } });
  await prisma.queueDependency.deleteMany({ where: { workspaceId: WS } });
  await prisma.queueItem.deleteMany({ where: { workspaceId: WS } });
  await prisma.queueRecurrenceRule.deleteMany({ where: { workspaceId: WS } });
  await prisma.queueRateLimitBucket.deleteMany({ where: { workspaceId: WS } });
  await prisma.workerRegistration.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspaceQueueSettings.deleteMany({ where: { workspaceId: WS } });
}

async function bulkSeed(n: number): Promise<void> {
  const base = Date.now();
  // Chunk inserts to stay well under Postgres' bind-parameter limit at 10k rows.
  for (let start = 0; start < n; start += SEED_CHUNK) {
    const end = Math.min(start + SEED_CHUNK, n);
    const rows = Array.from({ length: end - start }, (_, j) => {
      const i = start + j;
      return {
        workspaceId: WS,
        ownerWorkspaceUserId: USER,
        permanentQueueId: formatPermanentQueueId(i + 1),
        title: `item-${i + 1}`,
        rankingTimestamp: new Date(base + i),
      };
    });
    await prisma.queueItem.createMany({ data: rows });
  }
}

/** WORKERS workers each claim CLAIM_PER_WORKER items; returns total claimed. */
async function claimSample(): Promise<number> {
  let claimed = 0;
  const worker = async (workerId: string): Promise<void> => {
    for (let i = 0; i < CLAIM_PER_WORKER; i++) {
      const item = await queueClaimService.claim({ workspaceId: WS, workerId });
      if (item === null) break;
      claimed++;
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(`perf-worker-${i + 1}`)));
  return claimed;
}

/** Seed n Snoozed items whose available_at is already past (activation fodder). */
async function seedSnoozedDue(n: number): Promise<void> {
  const past = new Date(Date.now() - 60_000);
  for (let start = 0; start < n; start += SEED_CHUNK) {
    const end = Math.min(start + SEED_CHUNK, n);
    const rows = Array.from({ length: end - start }, (_, j) => {
      const i = start + j;
      return {
        workspaceId: WS,
        ownerWorkspaceUserId: USER,
        permanentQueueId: formatPermanentQueueId(i + 1),
        title: `snoozed-${i + 1}`,
        status: DbStatus.Snoozed,
        availableAt: past,
        snoozedUntil: past,
        rankingTimestamp: new Date(past.getTime() + i),
      };
    });
    await prisma.queueItem.createMany({ data: rows });
  }
}

/** Seed n enabled recurrence rules already due to spawn (next_run_at in the past). */
async function seedRecurrenceDue(n: number): Promise<void> {
  const past = new Date(Date.now() - 60_000);
  for (let start = 0; start < n; start += SEED_CHUNK) {
    const end = Math.min(start + SEED_CHUNK, n);
    const rows = Array.from({ length: end - start }, (_, j) => {
      const i = start + j;
      return {
        workspaceId: WS,
        ownerWorkspaceUserId: USER,
        createdByWorkspaceUserId: USER,
        name: `rule-${i + 1}`,
        cronExpression: '*/5 * * * *',
        timezone: 'UTC',
        isEnabled: true,
        nextRunAt: past,
      };
    });
    await prisma.queueRecurrenceRule.createMany({ data: rows });
  }
}

/** Seed n claimable items, each carrying a resolved (Done) dependency edge. */
async function seedDependencyClaimable(n: number): Promise<void> {
  const base = Date.now();
  const upstream = Array.from({ length: n }, (_, i) => ({
    workspaceId: WS,
    ownerWorkspaceUserId: USER,
    permanentQueueId: formatPermanentQueueId(i + 1),
    title: `upstream-${i + 1}`,
    status: DbStatus.Done,
    completedAt: new Date(base),
    rankingTimestamp: new Date(base + i),
  }));
  const dependent = Array.from({ length: n }, (_, i) => ({
    workspaceId: WS,
    ownerWorkspaceUserId: USER,
    permanentQueueId: formatPermanentQueueId(n + i + 1),
    title: `dependent-${i + 1}`,
    status: DbStatus.New,
    rankingTimestamp: new Date(base + n + i),
  }));
  await prisma.queueItem.createMany({ data: [...upstream, ...dependent] });

  const items = await prisma.queueItem.findMany({
    where: { workspaceId: WS },
    select: { id: true, permanentQueueId: true },
  });
  const idByPid = new Map(items.map((it) => [it.permanentQueueId, it.id]));
  const edges = Array.from({ length: n }, (_, i) => ({
    workspaceId: WS,
    queueItemId: idByPid.get(formatPermanentQueueId(n + i + 1)) as string,
    dependsOnQueueItemId: idByPid.get(formatPermanentQueueId(i + 1)) as string,
    dependencyType: QueueDependencyType.COMPLETE_REQUIRED,
  }));
  await prisma.queueDependency.createMany({ data: edges });
}

/** Seed n New items, each in its own partition (all immediately claimable). */
async function seedPartitioned(n: number): Promise<void> {
  const base = Date.now();
  const rows = Array.from({ length: n }, (_, i) => ({
    workspaceId: WS,
    ownerWorkspaceUserId: USER,
    permanentQueueId: formatPermanentQueueId(i + 1),
    title: `part-${i + 1}`,
    partitionKey: `partition-${i + 1}`,
    rankingTimestamp: new Date(base + i),
  }));
  await prisma.queueItem.createMany({ data: rows });
}

/** Drain up to `target` items across `workerCount` concurrent workers. */
async function claimCount(target: number, workerCount: number): Promise<number> {
  let claimed = 0;
  const worker = async (workerId: string): Promise<void> => {
    while (claimed < target) {
      const item = await queueClaimService.claim({ workspaceId: WS, workerId });
      if (item === null) break;
      claimed++;
    }
  };
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(`perf-claimer-${i + 1}`)));
  return claimed;
}

describeIntegration('queue performance', () => {
  jest.setTimeout(120_000);

  beforeAll(async () => {
    await connectDatabase();
    await seedWorkspace();
  });

  afterAll(async () => {
    await cleanQueue();
    await prisma.workspaceUser.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await disconnectDatabase();
  });

  describe.each([1_000, 10_000])('with %i items and 100 workers', (itemCount) => {
    it('benchmarks claim, recovery, and statistics latency at depth', async () => {
      await cleanQueue();
      const heapBefore = process.memoryUsage().heapUsed;

      const seedStart = Date.now();
      await bulkSeed(itemCount);
      const seedMs = Date.now() - seedStart;

      // Claim a bounded sample under full 100-worker contention at this depth.
      const claimStart = Date.now();
      const claimed = await claimSample();
      const claimMs = Date.now() - claimStart;
      expect(claimed).toBe(CLAIM_SAMPLE);

      // Latency of a single recovery batch (future clock => all leases expired).
      const future = new Date(Date.now() + 60 * 60_000);
      const recoverStart = Date.now();
      const recovered = await queueRecoveryService.recoverExpired(future);
      const recoverMs = Date.now() - recoverStart;
      expect(recovered).toBeGreaterThan(0);

      // Statistics latency with the full pool present (the scalability metric).
      const statsStart = Date.now();
      const stats = await queueStatisticsService.get(WS);
      const statsMs = Date.now() - statsStart;
      expect(stats.counts[QueueStatus.New] + stats.counts[QueueStatus.Processing]).toBe(itemCount);

      const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;

      // eslint-disable-next-line no-console
      console.log(
        `[perf] depth=${itemCount} workers=${WORKERS} sample=${CLAIM_SAMPLE} ` +
          `seed=${seedMs}ms claim_total=${claimMs}ms ` +
          `claim_avg=${(claimMs / CLAIM_SAMPLE).toFixed(2)}ms ` +
          `claim_throughput=${Math.round((CLAIM_SAMPLE / claimMs) * 1000)}/s ` +
          `recovery_batch=${recovered}items/${recoverMs}ms statistics=${statsMs}ms ` +
          `heap_delta=${heapDeltaMb.toFixed(1)}MB`,
      );

      // Loose sanity guards so a pathological regression still fails the gate.
      expect(statsMs).toBeLessThan(5_000);
      expect(claimed).toBeGreaterThan(0);
    });
  });

  describe('orchestration hot paths (bounded)', () => {
    it('benchmarks activation, recurrence, rate-limit, dependency, and partition paths', async () => {
      // Activation sweep: wake a batch of due-snoozed items.
      await cleanQueue();
      await seedSnoozedDue(ACT_SEED);
      const actStart = Date.now();
      const activated = await queueActivationService.activateBatch(new Date());
      const actMs = Date.now() - actStart;
      expect(activated).toBeGreaterThan(0);

      // Recurrence sweep: spawn one item per due rule.
      await cleanQueue();
      await seedRecurrenceDue(REC_SEED);
      const recStart = Date.now();
      const spawned = await queueRecurrenceService.processDueRules(new Date());
      const recMs = Date.now() - recStart;
      expect(spawned).toBe(REC_SEED);

      // Rate-limit checks: consume a bounded sample from one bucket.
      await cleanQueue();
      await queueRateLimitRepository.upsert({
        workspaceId: WS,
        rateLimitKey: 'perf-bucket',
        windowSeconds: 3_600,
        maxItems: RL_SAMPLE + 1,
      });
      const rlStart = Date.now();
      for (let i = 0; i < RL_SAMPLE; i++) {
        await queueRateLimitRepository.checkAndConsume(WS, 'perf-bucket', new Date());
      }
      const rlMs = Date.now() - rlStart;

      // Dependency-heavy claims: items each gated by a resolved upstream edge.
      await cleanQueue();
      await seedDependencyClaimable(DEP_SEED);
      const depStart = Date.now();
      const depClaimed = await claimCount(DEP_SEED, CLAIMERS);
      const depMs = Date.now() - depStart;
      expect(depClaimed).toBe(DEP_SEED);

      // Partition claims: one claimable item per partition key.
      await cleanQueue();
      await seedPartitioned(PART_SEED);
      const partStart = Date.now();
      const partClaimed = await claimCount(PART_SEED, CLAIMERS);
      const partMs = Date.now() - partStart;
      expect(partClaimed).toBe(PART_SEED);

      // eslint-disable-next-line no-console
      console.log(
        `[perf-orchestration] ` +
          `activation=${activated}items/${actMs}ms ` +
          `recurrence=${spawned}rules/${recMs}ms ` +
          `rate_limit=${RL_SAMPLE}checks/${rlMs}ms avg=${(rlMs / RL_SAMPLE).toFixed(2)}ms ` +
          `dependency_claim=${depClaimed}/${depMs}ms avg=${(depMs / depClaimed).toFixed(2)}ms ` +
          `partition_claim=${partClaimed}/${partMs}ms avg=${(partMs / partClaimed).toFixed(2)}ms`,
      );

      // Loose sanity guards so a pathological regression still fails the gate.
      expect(actMs).toBeLessThan(30_000);
      expect(recMs).toBeLessThan(30_000);
      expect(depMs).toBeLessThan(30_000);
      expect(partMs).toBeLessThan(30_000);
    });
  });
});
