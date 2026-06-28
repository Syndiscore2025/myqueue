import {
  connectDatabase,
  disconnectDatabase,
  getPrisma,
} from '../../src/infrastructure/database/prisma';
import { queueClaimService, queueRecoveryService } from '../../src/application/queue';
import { formatPermanentQueueId } from '../../src/infrastructure/repositories/queue-item-repository';
import { QueueStatus } from '../../src/domain/queue';

// Real-Postgres concurrency tests. They exercise the FOR UPDATE SKIP LOCKED
// claim/recovery paths under genuine parallelism, so they need a live database
// and are skipped unless RUN_INTEGRATION=true (CI / local dev datastores).
const describeIntegration = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

const WS = 'ws-concurrency-test';
const USER = 'wu-concurrency-test';
const prisma = getPrisma();

/** Create the tenant + owner the seeded items belong to (idempotent). */
async function seedWorkspace(): Promise<void> {
  await prisma.workspace.upsert({ where: { id: WS }, create: { id: WS }, update: {} });
  await prisma.workspaceUser.upsert({
    where: { id: USER },
    create: { id: USER, workspaceId: WS, slackUserId: 'U-concurrency' },
    update: {},
  });
}

/** Remove all queue rows for the test workspace so each case starts clean. */
async function cleanQueue(): Promise<void> {
  await prisma.queueEvent.deleteMany({ where: { workspaceId: WS } });
  await prisma.queueItem.deleteMany({ where: { workspaceId: WS } });
  await prisma.queueRateLimitBucket.deleteMany({ where: { workspaceId: WS } });
  await prisma.workerRegistration.deleteMany({ where: { workspaceId: WS } });
  await prisma.workspaceQueueSettings.deleteMany({ where: { workspaceId: WS } });
}

/** Bulk-insert `n` New items sharing a partition and/or rate-limit key. */
async function seedKeyed(opts: {
  n: number;
  partitionKey?: string;
  rateLimitKey?: string;
}): Promise<void> {
  const base = Date.now();
  const rows = Array.from({ length: opts.n }, (_, i) => ({
    workspaceId: WS,
    ownerWorkspaceUserId: USER,
    permanentQueueId: formatPermanentQueueId(i + 1),
    title: `keyed-${i + 1}`,
    rankingTimestamp: new Date(base + i),
    partitionKey: opts.partitionKey ?? null,
    rateLimitKey: opts.rateLimitKey ?? null,
  }));
  await prisma.queueItem.createMany({ data: rows });
}

/** Bulk-insert `n` New items with deterministic, monotonically ranked ids. */
async function bulkSeed(n: number): Promise<void> {
  const base = Date.now();
  const rows = Array.from({ length: n }, (_, i) => ({
    workspaceId: WS,
    ownerWorkspaceUserId: USER,
    permanentQueueId: formatPermanentQueueId(i + 1),
    title: `item-${i + 1}`,
    rankingTimestamp: new Date(base + i),
  }));
  await prisma.queueItem.createMany({ data: rows });
}

/** A single worker claims until the queue is drained; returns claimed ids. */
async function drain(workerId: string): Promise<string[]> {
  const claimed: string[] = [];
  for (;;) {
    const item = await queueClaimService.claim({ workspaceId: WS, workerId });
    if (item === null) break;
    claimed.push(item.permanentQueueId);
  }
  return claimed;
}

async function countByStatus(status: QueueStatus): Promise<number> {
  return prisma.queueItem.count({ where: { workspaceId: WS, status } });
}

describeIntegration('queue concurrency', () => {
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

  beforeEach(async () => {
    await cleanQueue();
  });

  // Core guarantee: under N concurrent workers draining a shared pool, every
  // item is claimed exactly once (no duplicate processing, no lost items).
  describe.each([2, 5, 20, 100])('with %i concurrent workers', (workerCount) => {
    const itemCount = workerCount * 4;

    it(`claims every item exactly once`, async () => {
      await bulkSeed(itemCount);

      const workerIds = Array.from({ length: workerCount }, (_, i) => `worker-${i + 1}`);
      const results = await Promise.all(workerIds.map((id) => drain(id)));
      const claimed = results.flat();
      const unique = new Set(claimed);

      // No duplicate processing: each id appears once across all workers.
      expect(unique.size).toBe(claimed.length);
      // No lost items: the union of claims covers the whole seeded pool.
      expect(unique.size).toBe(itemCount);
      // Every item ended up Processing; none left New or otherwise stranded.
      expect(await countByStatus(QueueStatus.Processing)).toBe(itemCount);
      expect(await countByStatus(QueueStatus.New)).toBe(0);
    });
  });

  // Recovery sweeps run concurrently and must reclaim each expired lock exactly
  // once. Driving `recoverExpired` with a future clock makes every live lease
  // appear expired without waiting out QUEUE_LOCK_MINUTES.
  describe('recovery under load', () => {
    it('reclaims every expired lock exactly once across concurrent sweeps', async () => {
      const itemCount = 80;
      await bulkSeed(itemCount);
      // One worker claims the whole pool, so all 80 hold a live lease.
      expect((await drain('claimer')).length).toBe(itemCount);
      expect(await countByStatus(QueueStatus.Processing)).toBe(itemCount);

      // Five sweeps race against the same expired set; SKIP LOCKED keeps them
      // from double-recovering any row. Each sweep batch is bounded, so loop
      // until the queue is fully drained back to New.
      const future = new Date(Date.now() + 60 * 60_000);
      let totalRecovered = 0;
      for (let pass = 0; pass < itemCount; pass++) {
        const counts = await Promise.all(
          Array.from({ length: 5 }, () => queueRecoveryService.recoverExpired(future)),
        );
        totalRecovered += counts.reduce((a, b) => a + b, 0);
        if ((await countByStatus(QueueStatus.Processing)) === 0) break;
      }

      // Each item recovered once → total equals the pool and every attemptCount is 1.
      expect(totalRecovered).toBe(itemCount);
      expect(await countByStatus(QueueStatus.New)).toBe(itemCount);
      expect(await countByStatus(QueueStatus.Processing)).toBe(0);
      const attempts = await prisma.queueItem.findMany({
        where: { workspaceId: WS },
        select: { attemptCount: true },
      });
      expect(attempts.every((a) => a.attemptCount === 1)).toBe(true);
    });
  });

  // Concurrent failures must apply the retry policy correctly: items with budget
  // remaining return to New, while exhausted items move to the Dead Letter Queue.
  describe('retry / DLQ under load', () => {
    it('retries items with budget and dead-letters exhausted ones concurrently', async () => {
      const retryCount = 15;
      const dlqCount = 15;
      const total = retryCount + dlqCount;
      await bulkSeed(total);

      // Each worker claims exactly one item; capture the worker→item lease map.
      const workers = Array.from({ length: total }, (_, i) => `worker-${i + 1}`);
      const leases = await Promise.all(
        workers.map(async (workerId) => {
          const item = await queueClaimService.claim({ workspaceId: WS, workerId });
          return { workerId, permanentQueueId: item?.permanentQueueId ?? '' };
        }),
      );
      expect(leases.every((l) => l.permanentQueueId !== '')).toBe(true);

      // Pre-age the first `dlqCount` items to one attempt below the cap so a
      // single failure exhausts them (QUEUE_MAX_RETRIES default = 3 → set 2).
      const dlqIds = leases.slice(0, dlqCount).map((l) => l.permanentQueueId);
      await prisma.queueItem.updateMany({
        where: { workspaceId: WS, permanentQueueId: { in: dlqIds } },
        data: { attemptCount: 2 },
      });

      // Fail all leases at once; the service decides retry vs dead-letter per item.
      await Promise.all(
        leases.map((l) =>
          queueClaimService.fail({ workspaceId: WS, workerId: l.workerId }, l.permanentQueueId, {
            error: 'boom',
          }),
        ),
      );

      expect(await countByStatus(QueueStatus.DeadLetter)).toBe(dlqCount);
      expect(await countByStatus(QueueStatus.New)).toBe(retryCount);
      expect(await countByStatus(QueueStatus.Processing)).toBe(0);
    });
  });

  // A partition admits at most one in-flight item: while one item in the
  // partition is Processing, no other item in that partition is claimable, even
  // under concurrent claimers. The gate reopens once the in-flight item resolves.
  describe('partition single-in-flight gate', () => {
    it('blocks concurrent claims while one partition item is processing', async () => {
      await seedKeyed({ n: 5, partitionKey: 'P1' });
      const first = await queueClaimService.claim({ workspaceId: WS, workerId: 'w-part-1' });
      if (first === null) throw new Error('expected the first claim to succeed');
      expect(await countByStatus(QueueStatus.Processing)).toBe(1);

      // Four workers race for the same partition; all are gated out by the live
      // in-flight item, so each gets null and nothing else moves to Processing.
      const racers = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          queueClaimService.claim({ workspaceId: WS, workerId: `w-part-${i + 2}` }),
        ),
      );
      expect(racers.every((r) => r === null)).toBe(true);
      expect(await countByStatus(QueueStatus.Processing)).toBe(1);
      expect(await countByStatus(QueueStatus.New)).toBe(4);

      // Resolving the in-flight item reopens the partition for the next claim.
      await prisma.queueItem.update({
        where: { id: first.id },
        data: { status: QueueStatus.Done },
      });
      const next = await queueClaimService.claim({ workspaceId: WS, workerId: 'w-part-next' });
      expect(next).not.toBeNull();
    });
  });

  // A full rate-limit bucket inside a live window gates every item sharing its
  // key: concurrent claims all return null until capacity frees up (or the
  // window expires), at which point the next claim succeeds.
  describe('rate-limit bucket gate', () => {
    it('blocks concurrent claims at capacity, then reopens when freed', async () => {
      await seedKeyed({ n: 5, rateLimitKey: 'R1' });
      await prisma.queueRateLimitBucket.create({
        data: {
          workspaceId: WS,
          rateLimitKey: 'R1',
          windowSeconds: 3600,
          maxItems: 1,
          currentCount: 1,
          windowStartedAt: new Date(),
        },
      });

      const racers = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          queueClaimService.claim({ workspaceId: WS, workerId: `w-rl-${i + 1}` }),
        ),
      );
      expect(racers.every((r) => r === null)).toBe(true);
      expect(await countByStatus(QueueStatus.New)).toBe(5);

      // Freeing capacity reopens the gate and the next claim succeeds.
      await prisma.queueRateLimitBucket.update({
        where: { workspaceId_rateLimitKey: { workspaceId: WS, rateLimitKey: 'R1' } },
        data: { currentCount: 0 },
      });
      const next = await queueClaimService.claim({ workspaceId: WS, workerId: 'w-rl-next' });
      expect(next).not.toBeNull();
    });
  });
});
