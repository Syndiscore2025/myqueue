import type { Redis } from 'ioredis';
import { RedisNotificationMetrics } from '../../src/infrastructure/observability/notification-metrics';

/** A tiny in-memory stand-in for the slice of ioredis the metrics use. */
function fakeRedis(): { redis: Redis; store: Map<string, Record<string, string>> } {
  const store = new Map<string, Record<string, string>>();
  const redis = {
    hincrby: jest.fn((key: string, field: string, by: number) => {
      const hash = store.get(key) ?? {};
      const next = (Number.parseInt(hash[field] ?? '0', 10) || 0) + by;
      hash[field] = String(next);
      store.set(key, hash);
      return Promise.resolve(next);
    }),
    hgetall: jest.fn((key: string) => Promise.resolve(store.get(key) ?? {})),
  } as unknown as Redis;
  return { redis, store };
}

describe('RedisNotificationMetrics', () => {
  it('tallies DM failures per reason and totals them, scoped by workspace', async () => {
    const { redis } = fakeRedis();
    const metrics = new RedisNotificationMetrics(redis);

    await metrics.recordDmFailure('w1', 'no_token');
    await metrics.recordDmFailure('w1', 'no_token');
    await metrics.recordDmFailure('w1', 'no_channel');
    await metrics.recordDmFailure('w1', 'send_error');
    await metrics.recordDmFailure('w2', 'send_error');

    await expect(metrics.getDmFailureCounts('w1')).resolves.toEqual({
      noToken: 2,
      noChannel: 1,
      sendError: 1,
      total: 4,
    });
    await expect(metrics.getDmFailureCounts('w2')).resolves.toEqual({
      noToken: 0,
      noChannel: 0,
      sendError: 1,
      total: 1,
    });
  });

  it('returns zeroed counts for a workspace with no recorded failures', async () => {
    const { redis } = fakeRedis();
    const metrics = new RedisNotificationMetrics(redis);

    await expect(metrics.getDmFailureCounts('unknown')).resolves.toEqual({
      noToken: 0,
      noChannel: 0,
      sendError: 0,
      total: 0,
    });
  });

  it('never throws when Redis fails (degrades observability, not delivery)', async () => {
    const redis = {
      hincrby: jest.fn().mockRejectedValue(new Error('redis down')),
      hgetall: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as Redis;
    const metrics = new RedisNotificationMetrics(redis);

    await expect(metrics.recordDmFailure('w1', 'send_error')).resolves.toBeUndefined();
    await expect(metrics.getDmFailureCounts('w1')).resolves.toEqual({
      noToken: 0,
      noChannel: 0,
      sendError: 0,
      total: 0,
    });
  });
});
