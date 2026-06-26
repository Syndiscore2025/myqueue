/**
 * Unit tests for QueueRateLimitRepository.checkAndConsume.
 * Uses a stub Prisma client so no database is required.
 */
import { QueueRateLimitRepository } from '../../src/infrastructure/repositories/queue-rate-limit-repository';

const WORKSPACE = 'w1';
const KEY = 'send-email';
const now = new Date('2026-06-01T12:00:00Z');

interface BucketOverrides {
  currentCount?: number;
  maxItems?: number;
  windowSeconds?: number;
  windowStartedAt?: Date;
}

interface FakeBucket {
  id: string;
  workspaceId: string;
  rateLimitKey: string;
  windowSeconds: number;
  maxItems: number;
  currentCount: number;
  windowStartedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function makeBucket(overrides: BucketOverrides = {}): FakeBucket {
  return {
    id: 'b1',
    workspaceId: WORKSPACE,
    rateLimitKey: KEY,
    windowSeconds: overrides.windowSeconds ?? 60,
    maxItems: overrides.maxItems ?? 5,
    currentCount: overrides.currentCount ?? 0,
    windowStartedAt: overrides.windowStartedAt ?? new Date(now.getTime() - 10_000),
    createdAt: now,
    updatedAt: now,
  };
}

interface RepoHandle {
  repo: QueueRateLimitRepository;
  updateMock: jest.Mock;
}

function makeRepo(bucket: FakeBucket | null): RepoHandle {
  const prisma = {
    queueRateLimitBucket: {
      upsert: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(bucket),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn().mockResolvedValue(bucket),
    },
  };
  return {
    repo: new QueueRateLimitRepository(prisma as never),
    updateMock: prisma.queueRateLimitBucket.update,
  };
}

describe('QueueRateLimitRepository.checkAndConsume', () => {
  it('returns null when no bucket is configured for the key', async () => {
    const { repo } = makeRepo(null);
    const result = await repo.checkAndConsume(WORKSPACE, KEY, now);
    expect(result).toBeNull();
  });

  it('allows a claim when count is under the limit', async () => {
    const { repo, updateMock } = makeRepo(makeBucket({ currentCount: 2, maxItems: 5 }));
    const result = await repo.checkAndConsume(WORKSPACE, KEY, now);
    expect(result?.allowed).toBe(true);
    expect(result?.currentCount).toBe(3);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentCount: { increment: 1 } } }),
    );
  });

  it('denies a claim when count equals the limit', async () => {
    const { repo, updateMock } = makeRepo(makeBucket({ currentCount: 5, maxItems: 5 }));
    const result = await repo.checkAndConsume(WORKSPACE, KEY, now);
    expect(result?.allowed).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('resets the window and allows a claim when window has expired', async () => {
    const expiredStart = new Date(now.getTime() - 120_000); // 2 minutes ago, window=60s
    const { repo, updateMock } = makeRepo(
      makeBucket({ currentCount: 5, maxItems: 5, windowStartedAt: expiredStart }),
    );
    const result = await repo.checkAndConsume(WORKSPACE, KEY, now);
    expect(result?.allowed).toBe(true);
    expect(result?.currentCount).toBe(1);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentCount: 1, windowStartedAt: now }),
      }),
    );
  });
});
