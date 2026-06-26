import {
  connectDatabase,
  disconnectDatabase,
  getPrisma,
} from '../../src/infrastructure/database/prisma';
import {
  queueClaimService,
  queueRecoveryService,
  queueStatisticsService,
} from '../../src/application/queue';
import { formatPermanentQueueId } from '../../src/infrastructure/repositories/queue-item-repository';
import { QueueStatus } from '../../src/domain/queue';

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
  await prisma.queueItem.deleteMany({ where: { workspaceId: WS } });
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
});
