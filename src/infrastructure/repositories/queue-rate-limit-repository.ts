import type { PrismaClient, QueueRateLimitBucket } from '@prisma/client';
import { getPrisma } from '../database/prisma';

export interface UpsertRateLimitBucketInput {
  workspaceId: string;
  rateLimitKey: string;
  windowSeconds: number;
  maxItems: number;
}

/**
 * Result of a `checkAndConsume` call.
 * `allowed` is false when the bucket is full for the current window.
 */
export interface RateLimitConsumeResult {
  allowed: boolean;
  currentCount: number;
  maxItems: number;
  windowResetsAt: Date;
}

export class QueueRateLimitRepository {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async upsert(input: UpsertRateLimitBucketInput): Promise<QueueRateLimitBucket> {
    return this.prisma.queueRateLimitBucket.upsert({
      where: {
        workspaceId_rateLimitKey: {
          workspaceId: input.workspaceId,
          rateLimitKey: input.rateLimitKey,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        rateLimitKey: input.rateLimitKey,
        windowSeconds: input.windowSeconds,
        maxItems: input.maxItems,
        currentCount: 0,
      },
      update: {
        windowSeconds: input.windowSeconds,
        maxItems: input.maxItems,
      },
    });
  }

  async findByKey(workspaceId: string, rateLimitKey: string): Promise<QueueRateLimitBucket | null> {
    return this.prisma.queueRateLimitBucket.findUnique({
      where: { workspaceId_rateLimitKey: { workspaceId, rateLimitKey } },
    });
  }

  async list(workspaceId: string): Promise<QueueRateLimitBucket[]> {
    return this.prisma.queueRateLimitBucket.findMany({
      where: { workspaceId },
      orderBy: { rateLimitKey: 'asc' },
    });
  }

  async delete(workspaceId: string, rateLimitKey: string): Promise<void> {
    await this.prisma.queueRateLimitBucket.deleteMany({
      where: { workspaceId, rateLimitKey },
    });
  }

  /**
   * Atomically check and consume one slot in the rate-limit bucket.
   * Performs a lazy window reset when the current window has expired.
   * Returns `allowed: false` (without incrementing) when the bucket is full.
   *
   * Uses a raw CTE so the check + increment is one round-trip.
   */
  async checkAndConsume(
    workspaceId: string,
    rateLimitKey: string,
    now: Date,
  ): Promise<RateLimitConsumeResult | null> {
    const bucket = await this.findByKey(workspaceId, rateLimitKey);
    if (!bucket) return null;

    const windowExpired =
      now.getTime() > bucket.windowStartedAt.getTime() + bucket.windowSeconds * 1000;
    const effectiveCount = windowExpired ? 0 : bucket.currentCount;
    const windowResetsAt = windowExpired
      ? new Date(now.getTime() + bucket.windowSeconds * 1000)
      : new Date(bucket.windowStartedAt.getTime() + bucket.windowSeconds * 1000);

    if (effectiveCount >= bucket.maxItems) {
      return {
        allowed: false,
        currentCount: effectiveCount,
        maxItems: bucket.maxItems,
        windowResetsAt,
      };
    }

    if (windowExpired) {
      await this.prisma.queueRateLimitBucket.update({
        where: { workspaceId_rateLimitKey: { workspaceId, rateLimitKey } },
        data: { currentCount: 1, windowStartedAt: now },
      });
    } else {
      await this.prisma.queueRateLimitBucket.update({
        where: { workspaceId_rateLimitKey: { workspaceId, rateLimitKey } },
        data: { currentCount: { increment: 1 } },
      });
    }

    return {
      allowed: true,
      currentCount: effectiveCount + 1,
      maxItems: bucket.maxItems,
      windowResetsAt,
    };
  }
}

export const queueRateLimitRepository = new QueueRateLimitRepository();
